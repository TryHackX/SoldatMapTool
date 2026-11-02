import React, { useEffect, useState } from 'react';
import { EditorDraftPayload, EditorDraftSummary } from '@shared/apiTypes';
import { parsePmsFull, PmsMapData } from '@shared/pmsParser';
import { History, RotateCcw, Trash2, X } from 'lucide-react';
import { locale, t } from '../../i18n';
import { base64ToUint8 } from '../useEditorController';

interface EditorDraftRecoveryBannerProps {
  isEditorOpen: boolean;
  onRecoverDraft: (opts: {
    map: PmsMapData;
    sourceMapId: string | null;
    sourceBaseName: string | null;
    initialBaseName: string;
    draftId: string;
  }) => void;
}

export const EditorDraftRecoveryBanner: React.FC<EditorDraftRecoveryBannerProps> = ({
  isEditorOpen,
  onRecoverDraft,
}) => {
  const [drafts, setDrafts] = useState<EditorDraftSummary[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    // The list from before the editor opened is stale; after closing, the "discard" request needs a moment
    setDrafts([]);
    if (isEditorOpen) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetch('/api/editor/drafts')
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { drafts?: EditorDraftSummary[] } | null) => {
          if (!cancelled && data && Array.isArray(data.drafts)) {
            setDrafts(data.drafts);
          }
        })
        .catch(() => {});
    }, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isEditorOpen]);

  if (isEditorOpen || dismissed || drafts.length === 0) return null;

  const latest = drafts[0];

  const handleRestore = async (draft: EditorDraftSummary) => {
    setBusyId(draft.draftId);
    try {
      const res = await fetch(`/api/editor/drafts/${encodeURIComponent(draft.draftId)}`);
      if (!res.ok) return;
      const payload = (await res.json()) as EditorDraftPayload;
      const bytes = base64ToUint8(payload.pmsBase64);
      const parsed = parsePmsFull(bytes);
      onRecoverDraft({
        map: parsed,
        sourceMapId: payload.sourceMapId,
        sourceBaseName: payload.baseName,
        initialBaseName: payload.baseName,
        draftId: payload.draftId,
      });
    } catch {
      // Ignore corrupt draft
    } finally {
      setBusyId(null);
    }
  };

  const handleDiscard = async (draftId: string) => {
    setBusyId(draftId);
    try {
      await fetch(`/api/editor/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
      setDrafts((prev) => prev.filter((d) => d.draftId !== draftId));
    } catch {
      // Ignore
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="shrink-0 bg-amber-950/50 border-b border-amber-500/35 px-4 py-1.5 flex items-center justify-between gap-3 text-xs text-amber-100">
      <div className="flex items-center gap-2 min-w-0 truncate">
        <History className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="truncate">
          {t('Unsaved Map Editor draft found: {name}.pms ({polys} polys, {time})', {
            name: latest.baseName,
            polys: latest.polygonCount,
            time: new Date(latest.updatedAt).toLocaleString(locale, {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            }),
          })}
        </span>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          disabled={busyId !== null}
          onClick={() => handleRestore(latest)}
          className="px-2.5 py-0.5 rounded bg-amber-500/25 hover:bg-amber-500/40 border border-amber-400/50 text-amber-100 font-semibold flex items-center gap-1 cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" />
          <span>{t('Restore draft')}</span>
        </button>
        <button
          type="button"
          disabled={busyId !== null}
          onClick={() => handleDiscard(latest.draftId)}
          title={t('Delete autosaved draft from disk')}
          className="px-2 py-0.5 rounded bg-zinc-900/80 hover:bg-red-950/60 border border-zinc-700 text-zinc-300 hover:text-red-200 flex items-center gap-1 cursor-pointer"
        >
          <Trash2 className="w-3 h-3" />
          <span>{t('Discard')}</span>
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          title={t('Hide banner for this session')}
          className="p-0.5 rounded hover:bg-amber-500/20 text-amber-300/70 hover:text-amber-100 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
