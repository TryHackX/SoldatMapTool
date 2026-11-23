import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';

let openBrowser = process.argv.includes('--open');

for (;;) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], {
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'], env: {...process.env, SMS_MANAGED_RESTART: '1'},
  });
  child.on('message', message => {
    if (!openBrowser || message !== 'ready') return;
    openBrowser = false;
    const url = 'http://127.0.0.1:' + Number(process.env.PORT || 4321) + (fs.existsSync('data/admin/account.json') ? '/' : '/admin');
    const win = process.platform === 'win32';
    const opener = win ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const browser = spawn(opener, win ? ['url.dll,FileProtocolHandler', url] : [url], {stdio:'ignore', detached:true, windowsHide:true});
    browser.on('error', () => console.log('Open ' + url));
    browser.unref();
  });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (status, signal) => resolve(status ?? (signal ? 1 : 0)));
  });
  process.off('SIGTERM', stop);
  process.off('SIGINT', stop);
  if (code !== 75) { process.exitCode = code; break; }
  if (spawnSync(process.execPath, ['scripts/needs-build.mjs']).status !== 0) {
    const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {stdio:'inherit'});
    if (build.status !== 0) { process.exitCode = 1; break; }
  }
}
