import { useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '../i18n';

type Status = { configured: boolean; signedIn: boolean; font: boolean };
async function request(endpoint: string, options?: RequestInit) {
  const response = await fetch('/api/admin/' + endpoint, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || t('Request failed ({code}).', { code: response.status }));
  return data;
}
export function AdminPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const loginField = useRef<HTMLInputElement>(null);
  const settingsHeading = useRef<HTMLHeadingElement>(null);
  const previousSession = useRef<boolean | undefined>(undefined);
  const [message, setMessage] = useState('');
  useEffect(() => { request('status').then(setStatus).catch(err => setMessage(err.message)); }, []);
  useEffect(() => {
    if (!status) return;
    if (previousSession.current !== undefined && previousSession.current !== status.signedIn)
      (status.signedIn ? settingsHeading.current : loginField.current)?.focus();
    previousSession.current = status.signedIn;
  }, [status]);
  async function run(action: () => Promise<unknown>, success = '') {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try { await action(); setMessage(success); }
    catch (err) { setMessage(err instanceof Error ? err.message : t('Request failed.')); }
    finally {
      try { setStatus(await request('status')); } catch { setStatus(null); }
      submitting.current = false;
      setBusy(false);
    }
  }
  function authenticate(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await request(status?.configured ? 'login' : 'setup', {method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({login, password})});
      setPassword('');
    });
  }
  const field = 'block mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 p-2';
  const button = 'rounded-md bg-emerald-700 hover:bg-emerald-600 px-4 py-2 font-semibold disabled:opacity-50';
  return <main className="min-h-screen bg-zinc-950 text-zinc-100 px-5 py-14">
    <div className="mx-auto max-w-lg space-y-5">
      <a href="/" className="text-sm text-cyan-300">← Soldat Map Studio</a>
      <h1 className="text-2xl font-bold">{t('Local administration')}</h1>
      <section className="rounded-xl border border-zinc-700 bg-zinc-900 p-5 space-y-4 text-sm">
        {!status ? <button disabled={busy} onClick={() => void run(async () => {})}>{t('Reload')}</button>
        : !status.signedIn ? <form onSubmit={authenticate} className="space-y-4">
          <h2 className="font-semibold">{t(status.configured ? 'Admin sign in' : 'Create the local administrator')}</h2>
          <label className="block">{t('Login')}<input ref={loginField} required maxLength={64} autoComplete="username" className={field} value={login} onChange={e=>setLogin(e.target.value)}/></label>
          <label className="block">{t('Password')}<input required type="password" minLength={status.configured ? 1 : 12} maxLength={256}
            aria-describedby={status.configured ? undefined : 'admin-password-hint'} autoComplete={status.configured ? 'current-password' : 'new-password'}
            className={field} value={password} onChange={e=>setPassword(e.target.value)}/></label>
          {!status.configured && <p id="admin-password-hint" className="text-zinc-400">{t('Use at least 12 characters.')}</p>}
          <button type="submit" disabled={busy} className={button}>{t(status.configured ? 'Sign in' : 'Create account')}</button>
        </form> : <>
          <h2 ref={settingsHeading} tabIndex={-1} className="font-semibold">Font Awesome</h2>
          <p>{t(status.font ? 'Active toolbar icons: Font Awesome Solid' : 'Active toolbar icons: Lucide')}</p>
          <label className="block text-zinc-300">{t('Web package (.zip), up to 96 MiB')}
            <input type="file" accept=".zip,application/zip" className={field} onChange={e => setFile(e.target.files?.[0] || null)}/>
          </label>
          <p className="text-zinc-400">{t('The editor uses webfonts/fa-solid-900.woff2 from your ZIP. Reload the editor to see the icons.')}</p>
          <div className="flex items-center justify-between">
            <button disabled={busy || !file} className={button} onClick={() => file && void run(() =>
              request('font', {method: 'POST', headers: {'Content-Type':'application/zip'}, body: file}), t('Icon pack installed.'))}>{t('Install icon pack')}</button>
            <button disabled={busy} className="text-zinc-300" onClick={() => void run(() => request('logout', {method:'POST'}))}>{t('Sign out')}</button>
          </div>
        </>}
        <p role="status" className="text-amber-200">{message}</p>
      </section>
    </div>
  </main>;
}
