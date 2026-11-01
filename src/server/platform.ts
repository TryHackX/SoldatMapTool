import { execFile, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { t } from './i18n';

// Windows, Linux and macOS differences: the default game folder, the file manager and the native file pickers

/** A string value from the Windows registry (`reg query`), or null */
function readRegistryValue(key: string, name: string): string | null {
  try {
    const out = execFileSync('reg', ['query', key, '/v', name], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    const m = out.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`));
    return m ? path.normalize(m[1].trim()) : null;
  } catch {
    return null;
  }
}

function steamRoots(): string[] {
  const home = os.homedir();
  if (process.platform === 'win32') {
    // Steam may live on any drive; it records where in the registry
    const registered = [
      readRegistryValue('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
      readRegistryValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
    ].filter((p): p is string => Boolean(p));
    return [
      ...registered,
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam'),
    ];
  }
  if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Steam')];
  return [
    path.join(home, '.steam', 'steam'),
    path.join(home, '.local', 'share', 'Steam'),
    path.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'), // Flatpak
  ];
}

/** The Steam root plus every library folder listed in its libraryfolders.vdf (games on other drives) */
function steamLibraries(root: string): string[] {
  const libraries = [root];
  try {
    const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf-8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libraries.push(m[1].replace(/\\\\/g, '\\'));
  } catch {
    // No Steam in this location
  }
  return libraries;
}

/**
 * Game folder used until the user picks one in the settings: Soldat from any Steam library on this machine
 * (on Linux the Proton install has the same layout), otherwise the usual Steam location of this system.
 */
export function findDefaultSoldatPath(): string {
  const candidates = steamRoots().flatMap((root) =>
    steamLibraries(root).map((library) => path.join(library, 'steamapps', 'common', 'Soldat'))
  );
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'maps'))) ?? candidates[0];
}

/** Opens a folder in the system file manager; for a file, its folder (with the file selected where possible) */
export function openInFileManager(target: string, isFile: boolean): void {
  const ignore = () => undefined; // a missing file manager must not crash the server
  if (process.platform === 'win32') {
    execFile('explorer.exe', isFile ? [`/select,${target}`] : [target], ignore);
  } else if (process.platform === 'darwin') {
    execFile('open', isFile ? ['-R', target] : [target], ignore);
  } else {
    execFile('xdg-open', [isFile ? path.dirname(target) : target], ignore);
  }
}

export class DialogUnavailableError extends Error {}

function run(command: string, args: string[], env?: Record<string, string>): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: 300000, windowsHide: true, encoding: 'utf8', env: { ...process.env, ...env } },
      (err, stdout) => {
        if (!err) {
          resolve({ code: 0, stdout: String(stdout) });
          return;
        }
        const { code, killed } = err as { code?: unknown; killed?: boolean };
        if (code === 'ENOENT') {
          reject(new DialogUnavailableError(command));
          return;
        }
        // Exit code 1 is how zenity, kdialog and osascript report "cancelled"; a timed-out dialog counts as one too
        if (code === 1 || killed) {
          resolve({ code: 1, stdout: '' });
          return;
        }
        reject(err);
      }
    );
  });
}

const POWERSHELL_FOLDER = `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.FolderBrowserDialog
$f.Description = $env:SMS_DIALOG_TEXT
$f.ShowNewFolderButton = $true
$top = New-Object System.Windows.Forms.Form
$top.TopMost = $true
if ($f.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $f.SelectedPath
}
$top.Dispose()
`;

const POWERSHELL_FILE = `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Filter = $env:SMS_DIALOG_TEXT
$top = New-Object System.Windows.Forms.Form
$top.TopMost = $true
if ($f.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $f.FileName
}
$top.Dispose()
`;

/** "Archiwa (*.zip;*.smap)|*.zip;*.smap|..." (Windows filter syntax) as label / pattern pairs */
function parseFilter(filter: string): Array<{ label: string; patterns: string[] }> {
  const parts = filter.split('|');
  const out: Array<{ label: string; patterns: string[] }> = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    out.push({ label: parts[i].trim(), patterns: parts[i + 1].split(';').map((p) => p.trim()).filter(Boolean) });
  }
  return out;
}

/**
 * Native folder or file picker; resolves null when the user cancels. `text` is the folder dialog's title or
 * the file dialog's filter (Windows syntax). User texts travel as arguments / environment variables, never
 * spliced into a script. On Linux it needs zenity or kdialog (DialogUnavailableError otherwise).
 */
export async function pickPathDialog(kind: 'folder' | 'file', text: string): Promise<string | null> {
  const pick = (result: { code: number; stdout: string }) => (result.code === 0 ? result.stdout.trim() || null : null);

  if (process.platform === 'win32') {
    const script = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n${
      kind === 'folder' ? POWERSHELL_FOLDER : POWERSHELL_FILE
    }`;
    return pick(
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], {
        SMS_DIALOG_TEXT: text,
      })
    );
  }

  if (process.platform === 'darwin') {
    const script =
      kind === 'folder'
        ? 'POSIX path of (choose folder with prompt (system attribute "SMS_DIALOG_TEXT"))'
        : 'POSIX path of (choose file)';
    return pick(await run('osascript', ['-e', script], { SMS_DIALOG_TEXT: text }));
  }

  const filters = kind === 'file' ? parseFilter(text) : [];
  try {
    const args =
      kind === 'folder'
        ? ['--file-selection', '--directory', `--title=${text}`]
        : ['--file-selection', ...filters.map((f) => `--file-filter=${f.label} | ${f.patterns.join(' ')}`)];
    return pick(await run('zenity', args));
  } catch (err) {
    if (!(err instanceof DialogUnavailableError)) throw err;
  }
  try {
    const args =
      kind === 'folder'
        ? ['--title', text, '--getexistingdirectory', os.homedir()]
        : ['--getopenfilename', os.homedir(), filters.map((f) => `${f.patterns.join(' ')}|${f.label}`).join('\n')];
    return pick(await run('kdialog', args));
  } catch (err) {
    if (err instanceof DialogUnavailableError) {
      throw new DialogUnavailableError(
        t('The picker dialog needs zenity or kdialog (e.g. sudo apt install zenity) — you can also type the path manually.')
      );
    }
    throw err;
  }
}
