const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'dinastia_chat_histories';
    `);
    
    console.log('--- Columns of dinastia_chat_histories ---');
    for (const row of res.rows) {
      console.log(`${row.column_name}: ${row.data_type} (Nullable: ${row.is_nullable})`);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
main();
