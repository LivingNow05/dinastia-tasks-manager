const express = require('express');
const cron = require('node-cron');
const path = require('path');
const { pool, initDb } = require('./db');
const { runWhatsAppFollowUps } = require('./taskRunner');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Objeto para llevar registro de los cron jobs activos cargados en memoria
const activeCronJobs = {};

// Inicializar y programar tareas
async function reloadScheduler() {
  console.log('Recargando planificador de tareas...');
  
  // 1. Cancelar cron jobs anteriores
  for (const taskId in activeCronJobs) {
    activeCronJobs[taskId].stop();
    delete activeCronJobs[taskId];
  }

  try {
    // 2. Obtener todas las tareas activas de la DB
    const res = await pool.query('SELECT * FROM cloud_tasks_config WHERE active = true;');
    const tasks = res.rows;

    appendSystemLog(`Cargando ${tasks.length} tareas activas en el cron...`);

    tasks.forEach(task => {
      // Validar expresión cron
      if (!cron.validate(task.cron_expr)) {
        appendSystemLog(`❌ Error: Expresión cron inválida para la tarea "${task.name}": ${task.cron_expr}`);
        return;
      }

      // Programar la tarea
      const job = cron.schedule(task.cron_expr, async () => {
        appendSystemLog(`[Cron Trigger] Iniciando ejecución programada de: "${task.name}"`);
        if (task.type === 'whatsapp_followup') {
          await runWhatsAppFollowUps(task.id);
        } else {
          appendSystemLog(`⚠️ Tipo de tarea desconocido: ${task.type}`);
        }
      });

      activeCronJobs[task.id] = job;
      appendSystemLog(`✓ Tarea "${task.name}" programada correctamente con cron: ${task.cron_expr}`);
    });
  } catch (err) {
    console.error('Error al recargar el planificador:', err.message);
  }
}

// Logger auxiliar para el servidor
function appendSystemLog(msg) {
  const timestamp = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  console.log(`[SYSTEM ${timestamp}] ${msg}`);
}

// ==========================================
// ENDPOINTS DE LA API REST
// ==========================================

// 1. Obtener todas las tareas
app.get('/api/tasks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM cloud_tasks_config ORDER BY id ASC;');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Alternar estado activo/inactivo de una tarea
app.post('/api/tasks/:id/toggle', async (req, res) => {
  const { id } = req.params;
  try {
    const taskRes = await pool.query('SELECT active FROM cloud_tasks_config WHERE id = $1;', [id]);
    if (taskRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }
    const newActiveState = !taskRes.rows[0].active;
    await pool.query('UPDATE cloud_tasks_config SET active = $1, updated_at = NOW() WHERE id = $2;', [newActiveState, id]);
    
    // Recargar el planificador de cron para aplicar el cambio en memoria
    await reloadScheduler();

    res.json({ success: true, active: newActiveState });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Ejecutar una tarea manualmente inmediatamente
app.post('/api/tasks/:id/run', async (req, res) => {
  const { id } = req.params;
  try {
    const taskRes = await pool.query('SELECT * FROM cloud_tasks_config WHERE id = $1;', [id]);
    if (taskRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }

    const task = taskRes.rows[0];
    
    // Ejecutar asíncronamente en segundo plano para no bloquear la respuesta HTTP
    if (task.type === 'whatsapp_followup') {
      runWhatsAppFollowUps(task.id).catch(err => {
        console.error('Error durante la ejecución manual:', err.message);
      });
      res.json({ success: true, message: 'Ejecución manual iniciada en segundo plano.' });
    } else {
      res.status(400).json({ error: `Tipo de tarea desconocido o no implementado: ${task.type}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3.5. Crear una nueva tarea manualmente
app.post('/api/tasks', async (req, res) => {
  const { name, type, prompt, cron_expr } = req.body;
  if (!name || !type || !cron_expr) {
    return res.status(400).json({ error: 'Faltan campos obligatorios (name, type, cron_expr)' });
  }
  if (!cron.validate(cron_expr)) {
    return res.status(400).json({ error: 'La expresión cron provista es inválida' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO cloud_tasks_config (name, type, prompt, cron_expr, active)
       VALUES ($1, $2, $3, $4, true) RETURNING *;`,
      [name, type, prompt, cron_expr]
    );
    
    // Recargar el planificador en memoria para registrar el nuevo cron job
    await reloadScheduler();

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Obtener el historial de ejecuciones y logs de una tarea
app.get('/api/tasks/:id/logs', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT * FROM cloud_tasks_logs 
       WHERE task_id = $1 
       ORDER BY executed_at DESC LIMIT 50;`,
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Inicialización del servidor
async function start() {
  await initDb();
  await reloadScheduler();
  
  app.listen(PORT, () => {
    appendSystemLog(`Servidor en la nube iniciado en el puerto: ${PORT}`);
    appendSystemLog(`Interfaz web accesible en: http://localhost:${PORT}`);
  });
}

start().catch(err => {
  console.error('Fallo al iniciar el servidor:', err.message);
});
