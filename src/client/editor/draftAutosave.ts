import type { PmsMapData } from '@shared/pmsParser';
import type { EditorDocumentSnapshot } from './EditorDocument';

interface DraftState {
  target: WeakRef<PmsMapData> | null | undefined;
  pending?: Promise<void>;
}

/** Writes and removals for one recovery file must reach the server in the same order as edits. */
export class DraftAutosave {
  private readonly drafts = new Map<string, DraftState>();

  rememberRecovered(id: string, map: PmsMapData) {
    if (!this.drafts.has(id)) this.drafts.set(id, {target: new WeakRef(map)});
  }

  save(id: string, map: PmsMapData, write: () => Promise<void>) {
    return this.schedule(id, map, write);
  }

  clearIfClean({draftId, map, savedMap}: EditorDocumentSnapshot) {
    if (map === savedMap) return this.clear(draftId);
    return Promise.resolve();
  }

  clear(id: string) {
    if (!this.drafts.has(id)) return Promise.resolve();
    return this.schedule(id, null, async () => {
      const response = await fetch('/api/editor/drafts/' + encodeURIComponent(id), {method:'DELETE',keepalive:true});
      if (!response.ok) throw new Error('Draft removal failed');
    });
  }

  private schedule(id: string, target: PmsMapData | null, operation: () => Promise<void>) {
    const state: DraftState = this.drafts.get(id) ?? {target: undefined};
    if (target === null ? state.target === null : state.target?.deref() === target) {
      return state.pending ?? Promise.resolve();
    }
    this.drafts.set(id, state);
    state.target = target && new WeakRef(target);
    const pending: Promise<void> = (state.pending ?? Promise.resolve()).then(operation)
      .catch(() => {
        // A lost response can still mean the server applied the request. Retry the current intent.
        if (state.pending === pending) state.target = undefined;
      }).finally(() => {
        if (state.pending !== pending) return;
        state.pending = undefined;
        if (state.target === null) this.drafts.delete(id);
      });
    state.pending = pending;
    return pending;
  }
}
