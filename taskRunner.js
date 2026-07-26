const axios = require('axios');
const { pool } = require('./db');

require('dotenv').config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'https://evolution.localexpertapp.com';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || 'Dinastia';

// Función auxiliar para esperar/dormir
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper para llamadas a OpenRouter para redactar seguimientos
async function generateFollowUpMessage(history) {
  const models = [
    'google/gemini-2.5-flash',
    'google/gemini-2.5-flash-lite',
    'openai/gpt-4o-mini'
  ];

  const formattedHistory = history.map(h => `[${h.type.toUpperCase()}] ${h.content || '(Mensaje vacío/multimedia)'}`).join('\n');

  const systemPrompt = `Eres Anthony, un asesor de ventas empático de la tienda de mascotas "Dinastía Cachorros".
Se te proporcionará el historial de los últimos mensajes de un chat de WhatsApp con un cliente.
Tu objetivo es escribir un mensaje de seguimiento súper corto (máximo 1 o 2 oraciones, de 15 a 30 palabras).

Reglas estrictas:
- El tono debe ser muy natural, amigable y conversacional (humano, no robótico).
- Sé extremadamente breve. Una o dos oraciones cortas bastan.
- Si el bot o el asesor ya le cotizaron y prometieron fotos/videos en el pasado pero no se enviaron (o no hay confirmación de que se enviaran), discúlapte cortésmente por la demora y pregúntale si todavía quiere que se los envíes.
- Si ya se le cotizó pero no respondió, pregúntale de forma muy ligera si le quedó alguna duda o si sigue interesado en el cachorro/gatito.
- NUNCA menciones la palabra "videollamada" ni propongas hacer una videollamada.
- No uses saludos exagerados ni hashtags.
- Responde ÚNICAMENTE con el texto del mensaje que se le enviará al cliente por WhatsApp. No agregues introducciones, explicaciones ni comillas alrededor del mensaje.`;

  let lastError;
  for (const model of models) {
    try {
      console.log(`Intentando generar mensaje con modelo OpenRouter: ${model}...`);
      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Historial reciente del chat:\n${formattedHistory}` }
        ]
      }, {
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://tasks.localexpertapp.com',
          'X-Title': 'Dinastia Tasks Manager'
        },
        timeout: 15000
      });

      if (response.data && response.data.choices && response.data.choices[0]) {
        console.log(`✓ Mensaje generado exitosamente con el modelo: ${model}`);
        return response.data.choices[0].message.content.trim();
      }
    } catch (err) {
      console.warn(`⚠️ Falló el modelo ${model}: ${err.message}`);
      lastError = err;
    }
  }

  throw new Error('Todos los modelos de OpenRouter fallaron. Último error: ' + lastError.message);
}

// Helper para enviar mensaje por Evolution API
async function sendWhatsAppMessage(number, text) {
  try {
    const response = await axios.post(`${EVOLUTION_API_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
      number,
      text
    }, {
      headers: {
        'apikey': EVOLUTION_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    return response.data;
  } catch (err) {
    console.error(`Error enviando mensaje a ${number}:`, err.message);
    throw new Error(`Error en Evolution API: ${err.message}`);
  }
}

// Ejecutor principal de la tarea de seguimiento
async function runWhatsAppFollowUps(taskId) {
  const startTime = Date.now();
  let logBuffer = '';

  const appendLog = (msg) => {
    const timestamp = new Date().toISOString();
    const formattedMsg = `[${timestamp}] ${msg}\n`;
    console.log(msg);
    logBuffer += formattedMsg;
  };

  // Crear log inicial en base de datos
  let logId;
  try {
    const insertRes = await pool.query(
      `INSERT INTO cloud_tasks_logs (task_id, status, log_output, executed_at) 
       VALUES ($1, $2, $3, NOW()) RETURNING id;`,
      [taskId, 'running', 'Iniciando ejecución de seguimiento...\n']
    );
    logId = insertRes.rows[0].id;
  } catch (dbErr) {
    console.error('Error insertando log inicial en DB:', dbErr.message);
  }

  const updateDbLog = async (status) => {
    if (!logId) return;
    try {
      const duration = Date.now() - startTime;
      await pool.query(
        `UPDATE cloud_tasks_logs 
         SET status = $1, log_output = $2, duration_ms = $3 
         WHERE id = $4;`,
        [status, logBuffer, duration, logId]
      );
    } catch (dbErr) {
      console.error('Error actualizando log en DB:', dbErr.message);
    }
  };

  appendLog('--- INICIANDO CAMPAÑA DE SEGUIMIENTO EN LA NUBE ---');

  try {
    // 1. Buscar sesiones candidatas que tengan el primer mensaje del formulario de la web ("Mensaje usuario:")
    appendLog('Conectando a base de datos para buscar sesiones...');
    const sessionsRes = await pool.query(`
      SELECT DISTINCT session_id 
      FROM dinastia_chat_histories
      WHERE session_id != '573005101832@s.whatsapp.net'
        AND message::text LIKE '%Mensaje usuario:%';
    `);

    const candidateSessions = sessionsRes.rows.map(r => r.session_id);
    appendLog(`Encontradas ${candidateSessions.length} sesiones iniciadas por plantilla web.`);

    if (candidateSessions.length === 0) {
      appendLog('No hay prospectos candidatos para procesar.');
      await updateDbLog('success');
      return;
    }

    // 2. Filtrar los prospectos fríos (sin respuesta en las últimas 24-72 horas)
    const now = new Date();
    const minAgeMs = 24 * 60 * 60 * 1000;
    const maxAgeMs = 72 * 60 * 60 * 1000;
    const coldLeads = [];

    for (const session of candidateSessions) {
      const historyRes = await pool.query(`
        SELECT id, created_at, message::text as msg_str
        FROM dinastia_chat_histories
        WHERE session_id = $1
        ORDER BY id DESC LIMIT 5;
      `, [session]);

      const history = historyRes.rows;
      if (history.length === 0) continue;

      const latestMsgRow = history[0];
      let latestMsg;
      try {
        latestMsg = JSON.parse(latestMsgRow.msg_str);
      } catch (e) {
        continue;
      }

      // Validar que el cliente no haya respondido (último mensaje no debe ser 'human')
      if (latestMsg.type === 'human') continue;

      // Validar antigüedad
      const lastMsgDate = new Date(latestMsgRow.created_at);
      const ageMs = now - lastMsgDate;

      if (ageMs >= minAgeMs && ageMs <= maxAgeMs) {
        // Mapear historial en orden cronológico
        const formattedHistory = history.reverse().map(h => {
          try {
            const parsed = JSON.parse(h.msg_str);
            return { type: parsed.type, content: parsed.content };
          } catch (err) {
            return { type: 'unknown', content: h.msg_str };
          }
        });

        coldLeads.push({
          session,
          history: formattedHistory
        });
      }
    }

    appendLog(`Filtro completado. Total prospectos fríos identificados: ${coldLeads.length}`);
    await updateDbLog('running');

    if (coldLeads.length === 0) {
      appendLog('No hay prospectos fríos que requieran seguimiento en esta ejecución.');
      await updateDbLog('success');
      return;
    }

    // 3. Ejecutar los envíos uno por uno con delay de 3 minutos
    for (let i = 0; i < coldLeads.length; i++) {
      const lead = coldLeads[i];
      appendLog(`\n--- PROCESANDO CLIENTE (${i + 1}/${coldLeads.length}): ${lead.session} ---`);

      try {
        // Generar mensaje con OpenRouter
        appendLog('Llamando a OpenRouter para redactar seguimiento personalizado...');
        const generatedMessage = await generateFollowUpMessage(lead.history);
        appendLog(`Mensaje generado: "${generatedMessage}"`);

        // Enviar por WhatsApp
        appendLog('Enviando mensaje vía Evolution API...');
        const apiResponse = await sendWhatsAppMessage(lead.session, generatedMessage);
        appendLog(`Enviado con éxito. ID de mensaje: ${apiResponse.key?.id || 'Desconocido'}`);

      } catch (leadErr) {
        appendLog(`❌ Error procesando cliente ${lead.session}: ${leadErr.message}`);
      }

      // Esperar 3 minutos (180000 ms) antes del siguiente envío, excepto para el último
      if (i < coldLeads.length - 1) {
        appendLog('Esperando 3 minutos (retraso anti-bloqueo) antes del próximo envío...');
        await updateDbLog('running');
        await sleep(3 * 60 * 1000);
      }
    }

    appendLog('\n--- CAMPAÑA DE SEGUIMIENTO FINALIZADA CON ÉXITO ---');
    await updateDbLog('success');

  } catch (globalErr) {
    appendLog(`\n❌ ERROR CRÍTICO EN LA CAMPAÑA: ${globalErr.message}`);
    await updateDbLog('error');
  }
}

module.exports = {
  runWhatsAppFollowUps
};
