import React from 'react';
import ReactDOM from 'react-dom/client';
import { AdminPage } from './components/AdminPage';
import { loadToolIcons } from './editor/toolIcons';
const App = React.lazy(() => import('./App').then(module => ({default: module.App})));
import { ErrorBoundary } from './components/ErrorBoundary';
import { t } from './i18n';
// Fonts are bundled locally (no Google Fonts request: works offline and leaks nothing to third parties)
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);
const loading = <div className="bg-zinc-950 text-zinc-300 p-6">Soldat Map Studio…</div>;

async function openStudio() {
  const adminPage = /^\/admin\/?$/.test(window.location.pathname);
  if (!adminPage) {
    try {
      const response = await fetch('/api/admin/status');
      if (!response.ok) throw new Error();
      const status = await response.json();
      if (!status.configured) { window.location.replace('/admin'); return; }
      if (status.font) void loadToolIcons();
    } catch {
      // The admin screen includes a retry when the server is starting or temporarily unavailable.
      window.location.replace('/admin');
      return;
    }
  }
  root.render(<React.StrictMode>
    <ErrorBoundary fallbackTitle={t('Soldat Map Studio ran into an error')}>
      {adminPage ? <AdminPage/> : <React.Suspense fallback={loading}><App/></React.Suspense>}
    </ErrorBoundary>
  </React.StrictMode>);
}
root.render(loading);
void openStudio();
