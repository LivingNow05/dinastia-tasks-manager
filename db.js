const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDb() {
  const client = await pool.connect();
  try {
    console.log('Inicializando base de datos de tareas programadas...');

    // 1. Crear tabla de configuración de tareas
    await client.query(`
      CREATE TABLE IF NOT EXISTS cloud_tasks_config (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(50) NOT NULL,
        prompt TEXT,
        cron_expr VARCHAR(100) NOT NULL,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 2. Crear tabla de logs de ejecuciones
    await client.query(`
      CREATE TABLE IF NOT EXISTS cloud_tasks_logs (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES cloud_tasks_config(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL, -- 'success', 'error', 'running'
        log_output TEXT,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        duration_ms INTEGER
      );
    `);

    // 3. Insertar tarea por defecto si no hay ninguna
    const countRes = await client.query('SELECT COUNT(*) FROM cloud_tasks_config;');
    if (parseInt(countRes.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO cloud_tasks_config (name, type, prompt, cron_expr, active)
        VALUES (
          'Seguimiento Diario de WhatsApp (Maine Coon y General)',
          'whatsapp_followup',
          'Analizar los últimos mensajes de cada sesión de cliente que no haya respondido en las últimas 24 a 72 horas. Escribir un mensaje de seguimiento ultra breve (máximo 1 o 2 oraciones) y enviarlo con delay de 3 minutos.',
          '0 10 * * *',
          true
        );
      `);
      console.log('✓ Tarea de seguimiento por defecto insertada.');
    }

    console.log('✓ Tablas de base de datos creadas/validadas con éxito.');
  } catch (err) {
    console.error('Error al inicializar la base de datos:', err.message);
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initDb
};
