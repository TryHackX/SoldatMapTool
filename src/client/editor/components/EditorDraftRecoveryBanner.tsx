import React, { useEffect, useState } from 'react';
import { EditorDraftPayload, EditorDraftSummary } from '@shared/apiTypes';
import { parsePmsFull, PmsMapData } from '@shared/pmsParser';
import { History, RotateCcw, Trash2, X } from 'lucide-react';
import { locale, t } from '../../i18n';
import { base64ToUint8 } from '../useEditorController';
import { restoreAssetOrigin } from '../../renderer/mapAssetSource';

interface EditorDraftRecoveryBannerProps {
  isEditorOpen: boolean;
  onRecoverDraft: (opts: {
    map: PmsMapData;
    sourceMapId: string | null;
    sourceBaseName: string | null;
    initialBaseName: string;
    draftId: string;
    projectFile?: boolean;
  }) => void;
}

export const EditorDraftRecoveryBanner: React.FC<EditorDraftRecoveryBannerProps> = ({
  isEditorOpen,
  onRecoverDraft,
}) => {
  const [drafts, setDrafts] = useState<EditorDraftSummary[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [choice,setChoice] = useState<string | null>(null);
  const [error,setError] = useState('');
  const pending=React.useRef<AbortController|null>(null);

  useEffect(() => {
    // The list from before the editor opened is stale; after closing, the "discard" request needs a moment
    setDrafts([]);
    setBusyId(null);
    setError('');
    setChoice(null);
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
      pending.current?.abort(); pending.current=null;
    };
  }, [isEditorOpen]);

  if (isEditorOpen || dismissed || drafts.length === 0) return null;

  const selected = drafts.find(draft=>draft.draftId===choice) ?? drafts[0];

  const handleRestore = async (draft: EditorDraftSummary) => {
    if(pending.current) return;
    const controller=new AbortController();
    pending.current=controller;
    setBusyId(draft.draftId);setError('');
    try {
      const res = await fetch(`/api/editor/drafts/${encodeURIComponent(draft.draftId)}`,{signal:controller.signal});
      if (!res.ok) throw new Error();
      const payload = (await res.json()) as EditorDraftPayload;
      if(controller.signal.aborted || payload.draftId!==draft.draftId) throw new Error();
      const bytes = base64ToUint8(payload.pmsBase64);
      const parsed = parsePmsFull(bytes);
      await restoreAssetOrigin(parsed,payload.assetMapId ?? payload.sourceMapId,controller.signal);
      if (controller.signal.aborted) return;
      if (payload.tunnels?.length) parsed.editorTunnels = payload.tunnels;
      if (payload.sketch) parsed.editorSketch = payload.sketch;
      onRecoverDraft({
        map: parsed,
        sourceMapId: payload.sourceMapId,
        sourceBaseName: payload.baseName,
        initialBaseName: payload.baseName,
        draftId: payload.draftId,
        projectFile: payload.projectFile === true,
      });
    } catch {
      if(!controller.signal.aborted) setError(t('Could not restore this draft. The saved copy is still available.'));
    } finally {
      if(pending.current===controller){pending.current=null;setBusyId(null);}
    }
  };

  const handleDiscard = async (draftId: string) => {
    if(pending.current) return;
    // The draft may be the only copy of work recovered after a crash
    if(!window.confirm(t('Delete this recovery draft? This cannot be undone.'))) return;
    const controller=new AbortController();pending.current=controller;
    setBusyId(draftId);setError('');
    try {
      const response=await fetch(`/api/editor/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE',signal:controller.signal });
      if(!response.ok || controller.signal.aborted) throw new Error();
      setDrafts((prev) => prev.filter((d) => d.draftId !== draftId));
    } catch {
      if(!controller.signal.aborted) setError(t('Could not remove this draft.'));
    } finally {
      if(pending.current===controller){pending.current=null;setBusyId(null);}
    }
  };

  return (
    <div className="shrink-0 bg-amber-950/50 border-b border-amber-500/35 px-4 py-1.5 flex items-center justify-between gap-3 text-xs text-amber-100">
      <div className="flex items-center gap-2 min-w-0 truncate">
        <History className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        {drafts.length>1 && <select aria-label={t('Choose a recovery draft')} value={selected.draftId} disabled={busyId!==null}
          onChange={event=>{setChoice(event.target.value);setError('');}} className="min-w-0 max-w-60 rounded border border-amber-800 bg-zinc-950 px-1 py-0.5">
          {drafts.map(draft=><option key={draft.draftId} value={draft.draftId}>{draft.baseName} · {new Date(draft.updatedAt).toLocaleString(locale)}</option>)}
        </select>}
        <span className="truncate">
          {t('Unsaved Map Editor draft found: {name}.pms ({polys} polys, {time})', {
            name: selected.baseName,
            polys: selected.polygonCount,
            time: new Date(selected.updatedAt).toLocaleString(locale, {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            }),
          })}
        </span>
      </div>

      {error && <p role="alert" className="text-red-200">{error}</p>}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          disabled={busyId !== null}
          onClick={() => handleRestore(selected)}
          className="px-2.5 py-0.5 rounded bg-amber-500/25 hover:bg-amber-500/40 border border-amber-400/50 text-amber-100 font-semibold flex items-center gap-1 cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" />
          <span>{t('Restore draft')}</span>
        </button>
        <button
          type="button"
          disabled={busyId !== null}
          onClick={() => handleDiscard(selected.draftId)}
          title={t('Delete autosaved draft from disk')}
          className="px-2 py-0.5 rounded bg-zinc-900/80 hover:bg-red-950/60 border border-zinc-700 text-zinc-300 hover:text-red-200 flex items-center gap-1 cursor-pointer"
        >
          <Trash2 className="w-3 h-3" />
          <span>{t('Discard')}</span>
        </button>
        <button
          type="button"
          disabled={busyId!==null}
          aria-label={t('Hide banner for this session')}
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
