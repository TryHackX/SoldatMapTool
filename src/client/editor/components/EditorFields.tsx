import React, { useRef, useState } from 'react';

type InputPassThrough = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>;

/** The change handlers in the docks read `e.target.value`, so the fields hand them a minimal event-like object */
export interface FieldChange {
  target: { value: string };
}

const toNumber = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Drop-in replacement for `<input type="number">` in the editor docks. Typing is free (a lone "-" or "0." is
 * fine, nothing snaps back while typing); the value is applied when leaving the field (Enter does that too) and
 * on each arrow-key step (Shift = ×10), so one edit is one undo step. Escape restores the current value.
 */
export const NumberInput: React.FC<
  InputPassThrough & {
    value: number | string;
    onChange: (e: FieldChange) => void;
  }
> = ({ value, onChange, onFocus, onBlur, onKeyDown, min, max, step, ...rest }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelRef = useRef(false);
  // Only typed text is applied on blur: a field merely focused must not write back a value changed meanwhile
  const typedRef = useRef(false);

  const clamp = (n: number) => {
    const lo = toNumber(min);
    const hi = toNumber(max);
    return Math.min(hi ?? Infinity, Math.max(lo ?? -Infinity, n));
  };

  const commit = (text: string) => {
    const n = toNumber(text.trim().replace(',', '.'));
    if (n === null) return; // empty or not a number: keep the old value
    const next = clamp(n);
    if (next !== Number(value)) onChange({ target: { value: String(next) } });
  };

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={draft ?? String(value)}
      onFocus={(e) => {
        typedRef.current = false;
        setDraft(String(value));
        onFocus?.(e);
      }}
      onChange={(e) => {
        typedRef.current = true;
        setDraft(e.target.value);
      }}
      onBlur={(e) => {
        if (cancelRef.current) cancelRef.current = false;
        else if (draft !== null && typedRef.current) commit(draft);
        typedRef.current = false;
        setDraft(null);
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur(); // leaving the field applies the value (exactly once)
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancelRef.current = true;
          e.currentTarget.blur();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const base = toNumber((draft ?? String(value)).replace(',', '.')) ?? toNumber(value) ?? 0;
          const unit = toNumber(step) ?? 1;
          const next = clamp(base + (e.key === 'ArrowUp' ? 1 : -1) * unit * (e.shiftKey ? 10 : 1));
          const rounded = Number(next.toFixed(6)); // no float noise from steps like 0.1
          setDraft(String(rounded));
          if (rounded !== Number(value)) onChange({ target: { value: String(rounded) } });
        }
        onKeyDown?.(e);
      }}
    />
  );
};

/**
 * Text field that applies its value when leaving the field (Enter does that too), not on every keystroke.
 * Escape restores the current value. For names whose intermediate states would be bad edits
 * (scenery file, texture, map description).
 */
export const CommitTextInput: React.FC<
  InputPassThrough & {
    value: string;
    onChange: (e: FieldChange) => void;
  }
> = ({ value, onChange, onFocus, onBlur, onKeyDown, ...rest }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const typedRef = useRef(false);
  return (
    <input
      {...rest}
      type="text"
      value={draft ?? value}
      onFocus={(e) => {
        typedRef.current = false;
        setDraft(value);
        onFocus?.(e);
      }}
      onChange={(e) => {
        typedRef.current = true;
        setDraft(e.target.value);
      }}
      onBlur={(e) => {
        if (cancelRef.current) cancelRef.current = false;
        else if (draft !== null && typedRef.current && draft !== value) onChange({ target: { value: draft } });
        typedRef.current = false;
        setDraft(null);
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cancelRef.current = true;
          e.currentTarget.blur();
        }
        onKeyDown?.(e);
      }}
    />
  );
};
