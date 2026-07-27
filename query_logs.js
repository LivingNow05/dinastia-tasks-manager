const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  try {
    const res = await pool.query(`
      SELECT *
      FROM cloud_tasks_logs
      ORDER BY id DESC LIMIT 20;
    `);
    
    console.log('--- RECENT TASK LOGS ---');
    for (const row of res.rows) {
      console.log(`Log ID: ${row.id} | Task ID: ${row.task_id} | Status: ${row.status} | Executed At: ${row.executed_at} | Duration: ${row.duration_ms}ms`);
      console.log('Output preview (last 500 chars):');
      console.log(row.log_output ? row.log_output.slice(-500) : 'N/A');
      console.log('-------------------------------------\n');
    }
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
main();
