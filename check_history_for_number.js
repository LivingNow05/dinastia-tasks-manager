const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const res = await pool.query(`
      SELECT id, message::text as msg_str, created_at
      FROM dinastia_chat_histories
      WHERE session_id = '59899444887@s.whatsapp.net'
      ORDER BY id ASC;
    `);
    
    console.log('--- MESSAGE HISTORY FOR 59899444887 ---');
    for (const row of res.rows) {
      console.log(`[${row.created_at.toISOString()}] ID: ${row.id} | Msg: ${row.msg_str}`);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
main();
