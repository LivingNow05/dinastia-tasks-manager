const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const session = '5213511241353@s.whatsapp.net';
    const historyRes = await pool.query(`
      SELECT id, created_at, message::text as msg_str
      FROM dinastia_chat_histories
      WHERE session_id = $1
      ORDER BY id DESC LIMIT 15;
    `, [session]);
    
    console.log(`--- MSG HISTORY FOR ${session} ---`);
    const history = historyRes.rows;
    for (let i = 0; i < history.length; i++) {
      const msg = JSON.parse(history[i].msg_str);
      console.log(`Index: ${i} | ID: ${history[i].id} | Type: ${msg.type} | Content: ${msg.content ? msg.content.substring(0, 50).replace(/\n/g, ' ') : 'N/A'} | Created At: ${history[i].created_at.toISOString()}`);
    }

    let firstHumanIndex = -1;
    for (let i = 0; i < history.length; i++) {
      const msg = JSON.parse(history[i].msg_str);
      if (msg.type === 'human') {
        firstHumanIndex = i;
        break;
      }
    }
    console.log(`firstHumanIndex: ${firstHumanIndex}`);

    if (firstHumanIndex !== -1) {
      const outboundMessages = [];
      for (let i = 0; i < firstHumanIndex; i++) {
        const msgObj = JSON.parse(history[i].msg_str);
        outboundMessages.push({
          type: msgObj.type,
          content: msgObj.content,
          created_at: new Date(history[i].created_at)
        });
      }
      
      console.log('Outbound messages since last human message:');
      outboundMessages.forEach((m, idx) => {
        console.log(`  Outbound [${idx}]: Type: ${m.type} | Created At: ${m.created_at.toISOString()}`);
      });

      for (let i = 0; i < outboundMessages.length - 1; i++) {
        const gap = outboundMessages[i].created_at - outboundMessages[i + 1].created_at;
        console.log(`  Gap between ${i} and ${i+1}: ${(gap / (1000 * 60 * 60)).toFixed(2)}h (${gap} ms)`);
      }
    }

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
main();
