const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const res = await pool.query(`
      SELECT id, session_id, message::text as msg_str, created_at
      FROM dinastia_chat_histories
      WHERE message::text LIKE '%¿Cómo vas?%' 
         OR message::text LIKE '%¿Alguna duda sobre%'
         OR message::text LIKE '%¿todavía te gustaría%'
      ORDER BY id DESC LIMIT 50;
    `);
    
    console.log(`Found ${res.rows.length} matching messages:`);
    for (const row of res.rows) {
      console.log(`ID: ${row.id} | Session: ${row.session_id} | Msg: ${row.msg_str}`);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
main();
