import type express from 'express';
import type { Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export function installLocalRestart(app: express.Express, dataDir: string, port: number) {
  const secret = randomBytes(32).toString('hex');
  const tokenFile = path.join(dataDir, 'runtime', 'restart-' + port);
  let running: Server | undefined;
  app.post('/api/system/local-restart', (req, res) => {
    if (!running || req.headers['x-studio-restart'] !== secret) { res.sendStatus(403); return; }
    const server = running;
    running = undefined;
    const reset = req.body?.reset === true;
    res.status(202).json({restarting: true});
    server.close(() => {
      if (reset) {
        const account = path.join(dataDir, 'admin', 'account.json');
        if (fs.existsSync(account)) fs.renameSync(account, account + '.reset-' + Date.now());
      }
      process.exit(75);
    });
  });
  return (server: Server) => {
    if (process.env.SMS_MANAGED_RESTART !== '1') return;
    fs.mkdirSync(path.dirname(tokenFile), {recursive: true, mode: 0o700});
    fs.writeFileSync(tokenFile, secret, {mode: 0o600});
    running = server;
    process.once('exit', () => {
      try { if (fs.readFileSync(tokenFile, 'utf8') === secret) fs.unlinkSync(tokenFile); } catch { /* Already removed. */ }
    });
  };
}
