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
  'aria-modal': true;
} {
  const mouseDownOnBackdropRef = useRef(false);
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

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (openModalStack[openModalStack.length - 1] !== id) return;
      if (disabledRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      const idx = openModalStack.lastIndexOf(id);
      if (idx >= 0) openModalStack.splice(idx, 1);
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
    'aria-modal': true,
  };
}
