import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, scrypt, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';
import { isZipSymlink, zipEntryProblem } from './zipSafety';
import { t } from './i18n';

const deriveKey = promisify(scrypt);
const sessionAge = 8 * 60 * 60 * 1000;
const cookieName = 'sms_admin';
const cookie = { path: '/api/admin', httpOnly: true, sameSite: 'strict' as const };

export function fontFromZip(bytes: Buffer) {
  const archive = new AdmZip(bytes);
  const entries = archive.getEntries();
  if (entries.length > 20000) throw new Error();
  // Only the icon face the toolbar uses is installed. Names from the ZIP never become filesystem paths.
  const matches = entries.filter(e => /(?:^|\/)webfonts\/fa-solid-900\.woff2$/i.test(e.entryName));
  if (matches.length !== 1) throw new Error();
  const entry = matches[0];
  if (isZipSymlink(entry) || zipEntryProblem(entry) || entry.header.size < 48 || entry.header.size > 4 * 1024 * 1024) throw new Error();
  const font = entry.getData();
  if (font.length !== entry.header.size || font.toString('ascii', 0, 4) !== 'wOF2' || font.readUInt32BE(8) !== font.length) throw new Error();
  const tables = font.readUInt16BE(12);
  const compressedSize = font.readUInt32BE(20);
  if (!tables || font.readUInt16BE(14) !== 0 || !compressedSize || compressedSize > font.length - 48 ||
      font.readUInt32BE(16) < 12 + tables * 16) throw new Error();
  return font;
}

export function createAdminRouter(dir: string) {
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  const accountFile = path.join(dir, 'account.json');
  const fontFile = path.join(dir, 'fa-solid-900.woff2');
  const sessions = new Map<string, number>();
  const attempts: number[] = [];
  const router = express.Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  function token(req: express.Request) {
    return req.headers.cookie?.match(/(?:^|;\s*)sms_admin=([0-9a-f]{64})(?:;|$)/)?.[1] ?? '';
  }
  function signedIn(req: express.Request) {
    return (sessions.get(token(req)) ?? 0) > Date.now();
  }
  router.get('/status', (req, res) => res.json({
    configured: fs.existsSync(accountFile), signedIn: signedIn(req), font: fs.existsSync(fontFile),
  }));
  router.get('/font', (_req, res) => {
    if (!fs.existsSync(fontFile)) { res.sendStatus(404); return; }
    res.type('font/woff2').sendFile(fontFile);
  });
  router.post(['/setup', '/login'], express.json({limit: '4kb'}), async (req, res) => {
    const setup = req.path === '/setup';
    const configured = fs.existsSync(accountFile);
    if (configured === setup) { res.status(409).json({error: t('Reload the admin page.')}); return; }
    const now = Date.now();
    while (attempts.length && attempts[0] <= now - 60000) attempts.shift();
    if (attempts.length >= 8) { res.status(429).json({error: t('Try again in a minute.')}); return; }
    attempts.push(now);
    const name = req.body?.login, password = req.body?.password;
    if (typeof name !== 'string' || !name.trim() || name.length > 64 || typeof password !== 'string' ||
        password.length > 256 || (setup && password.length < 12)) {
      res.status(400).json({error: t('Enter a login and a password of 12 to 256 characters.')}); return;
    }
    if (setup) {
      const salt = randomBytes(24).toString('hex');
      const hash = await deriveKey(password, salt, 64) as Buffer;
      const temp = path.join(dir, randomUUID() + '.tmp');
      fs.writeFileSync(temp, JSON.stringify({name: name.trim(), salt, hash: hash.toString('hex')}), {mode: 0o600, flag: 'wx'});
      try { fs.linkSync(temp, accountFile); }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        res.status(409).json({error: t('Reload the admin page.')}); return;
      } finally { fs.unlinkSync(temp); }
    } else {
      const account = JSON.parse(fs.readFileSync(accountFile, 'utf8'));
      const hash = await deriveKey(password, account.salt, 64) as Buffer;
      if (!timingSafeEqual(hash, Buffer.from(account.hash, 'hex')) || account.name !== name.trim()) {
        res.status(401).json({error: t('Incorrect login or password.')}); return;
      }
    }
    for (const [key, expires] of sessions) if (expires <= now) sessions.delete(key);
    const id = randomBytes(32).toString('hex');
    sessions.set(id, now + sessionAge);
    res.cookie(cookieName, id, {...cookie, maxAge: sessionAge}).json({ok: true});
  });
  router.use((req, res, next) => {
    if (signedIn(req)) next();
    else res.status(401).json({error: t('Sign in to administration.')});
  });
  router.post('/logout', (req, res) => {
    sessions.delete(token(req));
    res.clearCookie(cookieName, cookie).json({ok: true});
  });
  router.post('/font', express.raw({type: 'application/zip', limit: '96mb', inflate: false}), (req, res) => {
    let font: Buffer;
    try { if (!Buffer.isBuffer(req.body)) throw new Error(); font = fontFromZip(req.body); }
    catch { res.status(400).json({error: t('Choose a Font Awesome web ZIP containing webfonts/fa-solid-900.woff2.')}); return; }
    const temp = path.join(dir, randomUUID() + '.tmp');
    try {
      fs.writeFileSync(temp, font, {mode: 0o600, flag: 'wx'});
      fs.renameSync(temp, fontFile);
    } finally { fs.rmSync(temp, {force: true}); }
    res.json({ok: true});
  });
  const onError: express.ErrorRequestHandler = (err, _req, res, _next) => {
    const status = Number(err.status);
    res.status(status >= 400 && status <= 499 ? status : 500).json({ error: t('Administration request failed.') });
  };
  router.use(onError);
  return router;
}
