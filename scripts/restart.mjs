import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createInterface } from 'node:readline/promises';

const port = Number(process.env.PORT || 4321);
const url = 'http://127.0.0.1:' + port;
const tokenFile = path.join('data', 'runtime', 'restart-' + port);
try {
  const token = fs.readFileSync(tokenFile, 'utf8');
  const reset = process.argv.includes('--reset-admin');
  if (reset) {
    const prompt = createInterface({input: process.stdin, output: process.stdout});
    const answer = await prompt.question('Reset the local admin login? Type RESET to continue: ');
    prompt.close();
    if (answer !== 'RESET') process.exit(1);
  }
  const response = await fetch(url + '/api/system/local-restart', {method: 'POST',
    headers: {'X-Studio-Restart': token, 'Content-Type':'application/json'}, body: JSON.stringify({reset})});
  if (!response.ok) throw new Error('HTTP ' + response.status);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    await delay(500);
    try {
      if (fs.readFileSync(tokenFile, 'utf8') !== token && (await fetch(url + '/api/admin/status')).ok) { ready = true; break; }
    } catch { /* Build or restart in progress. */ }
  }
  if (!ready) throw new Error('The server has not reported ready. Check its console.');
  console.log('Soldat Map Studio ready at ' + url + (reset ? '/admin' : ''));
} catch (err) {
  console.error('Restart failed. Start the server with the launcher or npm start. ' + err.message);
  process.exitCode = 1;
}
