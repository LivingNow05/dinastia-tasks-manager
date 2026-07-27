const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const insertedIds = [];
  try {
    console.log('=== RUN 1: DETECTING COLD LEADS ===');
    const sessionsRes = await pool.query(`
      SELECT DISTINCT session_id 
      FROM dinastia_chat_histories
      WHERE session_id != '573005101832@s.whatsapp.net'
        AND message::text LIKE '%Mensaje usuario:%';
    `);

    const candidateSessions = sessionsRes.rows.map(r => r.session_id);
    const now = new Date();
    
    // We will test on one of the known repeated numbers
    const testSession = '59899444887@s.whatsapp.net';
    if (!candidateSessions.includes(testSession)) {
      console.log(`Error: test session ${testSession} not found in candidates.`);
      return;
    }

    const checkSession = async (sessionLabel) => {
      const historyRes = await pool.query(`
        SELECT id, created_at, message::text as msg_str
        FROM dinastia_chat_histories
        WHERE session_id = $1
        ORDER BY id DESC LIMIT 15;
      `, [testSession]);

      const history = historyRes.rows;
      if (history.length === 0) return { decision: 'SKIP (no history)' };

      const latestMsgRow = history[0];
      const latestMsg = JSON.parse(latestMsgRow.msg_str);

      if (latestMsg.type === 'human') return { decision: 'SKIP (latest is human)' };

      let firstHumanIndex = -1;
      for (let i = 0; i < history.length; i++) {
        try {
          const msg = JSON.parse(history[i].msg_str);
          if (msg.type === 'human') {
            firstHumanIndex = i;
            break;
          }
        } catch (e) {}
      }

      if (firstHumanIndex === -1) return { decision: 'SKIP (no human)' };

      const outboundMessages = [];
      for (let i = 0; i < firstHumanIndex; i++) {
        try {
          const msgObj = JSON.parse(history[i].msg_str);
          outboundMessages.push({
            type: msgObj.type,
            content: msgObj.content,
            created_at: new Date(history[i].created_at)
          });
        } catch (e) {}
      }

      let followUpAlreadySent = false;
      const gapThresholdMs = 12 * 60 * 60 * 1000;
      const detectedGaps = [];
      for (let i = 0; i < outboundMessages.length - 1; i++) {
        const gap = outboundMessages[i].created_at - outboundMessages[i + 1].created_at;
        detectedGaps.push(`${(gap / (1000 * 60 * 60)).toFixed(2)}h`);
        if (gap > gapThresholdMs) {
          followUpAlreadySent = true;
        }
      }

      if (followUpAlreadySent) {
        return { decision: 'SKIP (follow-up already sent)', gaps: detectedGaps };
      }

      const minAgeMs = 24 * 60 * 60 * 1000;
      const maxAgeMs = 72 * 60 * 60 * 1000;
      const lastMsgDate = new Date(latestMsgRow.created_at);
      const ageMs = new Date() - lastMsgDate;

      if (ageMs >= minAgeMs && ageMs <= maxAgeMs) {
        return { decision: 'SEND FOLLOW-UP', age: (ageMs / (1000 * 60 * 60)).toFixed(2) + 'h' };
      } else {
        return { decision: 'SKIP (outside age window)', age: (ageMs / (1000 * 60 * 60)).toFixed(2) + 'h' };
      }
    };

    console.log(`Checking session ${testSession} in Run 1...`);
    const run1Result = await checkSession();
    console.log('Run 1 Result:', run1Result);

    if (run1Result.decision !== 'SEND FOLLOW-UP') {
      console.log('Error: Run 1 did not decide to send a follow-up. Verification cannot proceed.');
      return;
    }

    // Simulate sending the follow-up and inserting it into the database
    console.log('\n=== SIMULATING FOLLOW-UP DISPATCH AND DB WRITE ===');
    const mockMessage = {
      type: 'ai',
      content: '¡Hola! ¿Cómo vas? ¿Alguna duda sobre los perritos que te envié?'
    };
    
    // We insert it with created_at = NOW() (or slightly offset if needed, but NOW() is fine)
    const insertRes = await pool.query(`
      INSERT INTO dinastia_chat_histories (session_id, message, created_at)
      VALUES ($1, $2, NOW())
      RETURNING id;
    `, [testSession, JSON.stringify(mockMessage)]);
    
    const newMsgId = insertRes.rows[0].id;
    insertedIds.push(newMsgId);
    console.log(`✓ Inserted mock follow-up message into DB with ID: ${newMsgId}`);

    // Wait a brief moment to simulate time passing (or just run checking again)
    // Run 2: Check session again
    console.log('\n=== RUN 2: DETECTING COLD LEADS AGAIN ===');
    console.log(`Checking session ${testSession} in Run 2...`);
    const run2Result = await checkSession();
    console.log('Run 2 Result:', run2Result);

    if (run2Result.decision === 'SKIP (follow-up already sent)') {
      console.log('✅ SUCCESS: The new follow-up message created a gap > 12h, and the session was correctly skipped!');
    } else {
      console.log('❌ FAILURE: The session was not skipped as expected.');
    }

  } catch (err) {
    console.error('Error during verification:', err);
  } finally {
    // CLEANUP
    if (insertedIds.length > 0) {
      console.log('\n=== CLEANING UP TEST DATABASE ENTRIES ===');
      try {
        await pool.query(`
          DELETE FROM dinastia_chat_histories 
          WHERE id = ANY($1);
        `, [insertedIds]);
        console.log(`✓ Deleted test message IDs: ${insertedIds.join(', ')}`);
      } catch (cleanupErr) {
        console.error('Error during cleanup:', cleanupErr.message);
      }
    }
    await pool.end();
  }
}
main();
