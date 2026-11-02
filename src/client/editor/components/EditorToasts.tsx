import React from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { t } from '../../i18n';

export interface EditorToast {
  id: number;
  kind: 'success' | 'error' | 'info';
  message: string;
}

const STYLE: Record<EditorToast['kind'], string> = {
  success: 'border-emerald-500/40 bg-emerald-950/90 text-emerald-100',
  error: 'border-red-500/45 bg-red-950/90 text-red-100',
  info: 'border-zinc-600/70 bg-zinc-900/95 text-zinc-100',
};

/** Short feedback after editor actions (saved, copied, pasted, fixed…), stacked above the status bar */
export const EditorToasts: React.FC<{ toasts: EditorToast[]; onDismiss: (id: number) => void }> = ({
  toasts,
  onDismiss,
}) => {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-1.5 pointer-events-none">
      {toasts.map((toast) => {
        const Icon = toast.kind === 'success' ? CheckCircle2 : toast.kind === 'error' ? AlertTriangle : Info;
        return (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto max-w-lg px-3 py-2 rounded-lg border shadow-xl backdrop-blur-md text-xs flex items-start gap-2 ${STYLE[toast.kind]}`}
          >
            <Icon className="w-4 h-4 shrink-0 mt-px" />
            <span className="leading-snug">{toast.message}</span>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label={t('Close')}
              className="opacity-60 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
