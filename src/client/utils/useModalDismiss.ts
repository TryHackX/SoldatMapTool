import React, { useCallback, useEffect, useRef } from 'react';

// Ids of currently open modals in opening order; only the last (top-most) one reacts to Escape
const openModalStack: number[] = [];
let nextModalId = 1;

/** True while any modal using this hook is open (the map editor then ignores its shortcuts) */
export function isAnyModalOpen(): boolean {
  return openModalStack.length > 0;
}

/**
 * Provides consistent Escape-key closing and safe outside-backdrop click closing
 * across all modals in Soldat Map Studio.
 * Tracks mouseDown origin so dragging text from an input onto the backdrop never closes the modal accidentally.
 * With stacked modals, Escape closes only the top-most one.
 */
export function useModalDismiss(
  open: boolean,
  onClose: () => void,
  disabled = false
): {
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  role: 'dialog';
  ref: React.RefObject<HTMLDivElement | null>;
  tabIndex: -1;
  'aria-modal': true;
} {
  const mouseDownOnBackdropRef = useRef(false);
  const backdrop = useRef<HTMLDivElement>(null);
  const modalIdRef = useRef(0);
  if (modalIdRef.current === 0) modalIdRef.current = nextModalId++;

  // Latest callbacks via refs: the effect below must only re-run on open/close, otherwise a re-render with
  // a new inline onClose would move this modal to the top of the stack.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    if (!open) return;
    const id = modalIdRef.current;
    openModalStack.push(id);
    const root = backdrop.current, opener = document.activeElement;
    function controls() {
      return root ? Array.from(root.querySelectorAll<HTMLElement>('button,input,select,textarea,summary,a[href],[tabindex]'))
        .filter(el => !el.matches(':disabled,[tabindex="-1"]') && el.getClientRects().length > 0) : [];
    }
    if (root && !root.contains(opener)) (controls()[0] ?? root).focus({preventScroll:true});

    const handleKeyDown = (e: KeyboardEvent) => {
      if (openModalStack[openModalStack.length - 1] !== id) return;
      if (e.key === 'Tab' && root && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const items = controls();
        const active = document.activeElement, first = items[0], last = items.at(-1);
        if (!first || !root.contains(active) || active===root || (e.shiftKey ? active===first : active===last)) {
          e.preventDefault();
          ((e.shiftKey ? last : first) ?? root).focus();
        }
        return;
      }
      if (e.key !== 'Escape') return;
      if (disabledRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      const idx = openModalStack.lastIndexOf(id);
      const wasTop = idx===openModalStack.length-1;
      if (idx >= 0) openModalStack.splice(idx, 1);
      if (wasTop && opener instanceof HTMLElement && opener.isConnected &&
        (document.activeElement===document.body || root?.contains(document.activeElement))) opener.focus({preventScroll:true});
    };
  }, [open]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    mouseDownOnBackdropRef.current = e.target === e.currentTarget;
  }, []);

  const onClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const startedOnBackdrop = mouseDownOnBackdropRef.current;
    mouseDownOnBackdropRef.current = false;
    if (disabledRef.current) return;
    if (startedOnBackdrop && e.target === e.currentTarget) {
      onCloseRef.current();
    }
  }, []);

  return {
    onMouseDown,
    onClick,
    role: 'dialog',
    ref: backdrop,
    tabIndex: -1,
    'aria-modal': true,
  };
}
