// Exit code 1 when the built client (dist/client) is missing or older than any client/shared source file,
// so the launcher rebuilds the UI automatically after an update instead of serving a stale interface.
import fs from 'fs';
import path from 'path';

const distIndex = path.join('dist', 'client', 'index.html');
if (!fs.existsSync(distIndex)) process.exit(1);
const builtAt = fs.statSync(distIndex).mtimeMs;

function hasNewerFile(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) return fs.readdirSync(p).some((f) => hasNewerFile(path.join(p, f)));
  return st.mtimeMs > builtAt;
}

const inputs = ['src/client', 'src/shared', 'index.html', 'vite.config.ts', 'package.json'];
process.exit(inputs.some((p) => fs.existsSync(p) && hasNewerFile(p)) ? 1 : 0);
