const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    console.log('--- INICIANDO SIMULACIÓN DE CAMPAÑA DE SEGUIMIENTO ---');
    const sessionsRes = await pool.query(`
      SELECT DISTINCT session_id 
      FROM dinastia_chat_histories
      WHERE session_id != '573005101832@s.whatsapp.net'
        AND message::text LIKE '%Mensaje usuario:%';
    `);

    const candidateSessions = sessionsRes.rows.map(r => r.session_id);
    console.log(`Encontradas ${candidateSessions.length} sesiones iniciadas por plantilla web.`);

    const now = new Date();
    const minAgeMs = 24 * 60 * 60 * 1000;
    const maxAgeMs = 72 * 60 * 60 * 1000;
    
    let processedCount = 0;
    let skippedByNoHuman = 0;
    let skippedByAlreadySent = 0;
    let skippedByAge = 0;
    let skippedByLatestIsHuman = 0;
    let activeColdLeads = [];

    for (const session of candidateSessions) {
      const historyRes = await pool.query(`
        SELECT id, created_at, message::text as msg_str
        FROM dinastia_chat_histories
        WHERE session_id = $1
        ORDER BY id DESC LIMIT 15;
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
      if (latestMsg.type === 'human') {
        skippedByLatestIsHuman++;
        continue;
      }

      // Buscar el último mensaje del cliente ('human') en el historial
      let firstHumanIndex = -1;
      for (let i = 0; i < history.length; i++) {
        try {
          const msg = JSON.parse(history[i].msg_str);
          if (msg.type === 'human') {
            firstHumanIndex = i;
            break;
          }
        } catch (e) {
          // ignorar
        }
      }

      if (firstHumanIndex === -1) {
        skippedByNoHuman++;
        continue;
      }

      // Extraer los mensajes salientes (nuestros) desde el último mensaje del cliente
      const outboundMessages = [];
      for (let i = 0; i < firstHumanIndex; i++) {
        try {
          const msgObj = JSON.parse(history[i].msg_str);
          outboundMessages.push({
            type: msgObj.type,
            content: msgObj.content,
            created_at: new Date(history[i].created_at)
          });
        } catch (e) {
          // ignorar
        }
      }

      // Si detectamos una brecha de tiempo significativa (ej. > 12 horas) entre mensajes salientes consecutivos,
      // significa que ya se envió un seguimiento anterior.
      let followUpAlreadySent = false;
      const gapThresholdMs = 12 * 60 * 60 * 1000; // 12 horas
      let detectedGaps = [];
      
      for (let i = 0; i < outboundMessages.length - 1; i++) {
        const gap = outboundMessages[i].created_at - outboundMessages[i + 1].created_at;
        detectedGaps.push(`${(gap / (1000 * 60 * 60)).toFixed(2)}h`);
        if (gap > gapThresholdMs) {
          followUpAlreadySent = true;
        }
      }

      if (followUpAlreadySent) {
        skippedByAlreadySent++;
        console.log(`Session: ${session} - SKIPPED (Follow-up already sent). Gaps: ${detectedGaps.join(', ')}`);
        continue;
      }

      // Validar antigüedad del último mensaje enviado
      const lastMsgDate = new Date(latestMsgRow.created_at);
      const ageMs = now - lastMsgDate;
      const ageHours = (ageMs / (1000 * 60 * 60)).toFixed(2);

      if (ageMs >= minAgeMs && ageMs <= maxAgeMs) {
        activeColdLeads.push({ session, ageHours });
        console.log(`Session: ${session} - TARGET FOR FOLLOW-UP. Age of last msg: ${ageHours}h`);
      } else {
        skippedByAge++;
        // console.log(`Session: ${session} - SKIPPED (Outside 24-72h range: ${ageHours}h).`);
      }
    }

    console.log('\n--- SIMULATION SUMMARY ---');
    console.log(`Total sessions processed: ${candidateSessions.length}`);
    console.log(`Skipped because latest message is HUMAN: ${skippedByLatestIsHuman}`);
    console.log(`Skipped because no HUMAN message in last 15: ${skippedByNoHuman}`);
    console.log(`Skipped because FOLLOW-UP ALREADY SENT (gap > 12h): ${skippedByAlreadySent}`);
    console.log(`Skipped because age is outside 24-72h range: ${skippedByAge}`);
    console.log(`Sessions that WOULD receive follow-up: ${activeColdLeads.length}`);
    activeColdLeads.forEach(l => {
      console.log(` - +${l.session.split('@')[0]} (last msg age: ${l.ageHours}h)`);
    });

  } catch (err) {
    console.error('Error during simulation:', err);
  } finally {
    await pool.end();
  }
}
main();
