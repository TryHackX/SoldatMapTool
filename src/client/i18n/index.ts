import { createElement, Fragment, type ReactNode } from 'react';
import type { PolyTypeMeta } from '@shared/soldatConstants';
import { PL } from './pl';

// UI texts are written in English in the code; Polish comes from the dictionary in ./pl, keyed by the English text.

export type Lang = 'en' | 'pl';

export const LANGUAGES: ReadonlyArray<{ id: Lang; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'pl', label: 'Polski' },
];

const STORAGE_KEY = 'sms.lang';

function savedLang(): Lang {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'pl') return saved;
  } catch {
    // Storage unavailable: default language
  }
  return 'en';
}

/** Active language, fixed for the page's lifetime: changing it reloads the app */
export const lang: Lang = savedLang();

/** Locale for numbers and dates (`toLocaleString(locale)`) */
export const locale = lang === 'pl' ? 'pl-PL' : 'en-US';

// The server reads the same choice from this cookie (API messages, generated files)
const writeCookie = (value: Lang) => {
  document.cookie = `sms_lang=${value}; path=/; max-age=31536000; SameSite=Strict`;
};
// Guarded: renderer modules that use t() are also imported by the Node tests, where there is no document
if (typeof document !== 'undefined') {
  writeCookie(lang);
  document.documentElement.lang = lang;
}

export function setLanguage(next: Lang): void {
  if (next === lang) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The cookie still carries the choice for this session
  }
  writeCookie(next);
  window.location.reload();
}

type Vars = Record<string, string | number>;

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}

/** UI text: `t('Moved {count} files', { count })` — English source, Polish from the dictionary */
export function t(en: string, vars?: Vars): string {
  if (lang === 'pl') {
    const pl = PL[en];
    if (typeof pl === 'string') return fill(pl, vars);
  }
  return fill(en, vars);
}

function polishPluralIndex(n: number): 0 | 1 | 2 {
  if (n === 1) return 0;
  const d = n % 10;
  const h = n % 100;
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? 1 : 2;
}

/**
 * Count-dependent text: `tp(n, '{n} map', '{n} maps')`. English picks one/other; Polish takes the three forms
 * (1 / 2–4 / 5+) from the dictionary entry keyed "one|other". `{n}` is filled with `n` unless `vars` sets it
 * (e.g. a formatted number).
 */
export function tp(n: number, one: string, other: string, vars?: Vars): string {
  const all: Vars = { n, ...vars };
  if (lang === 'pl') {
    const forms = PL[`${one}|${other}`];
    if (Array.isArray(forms)) return fill(forms[polishPluralIndex(n)], all);
  }
  return fill(Math.abs(n) === 1 ? one : other, all);
}

/** Like t(), with React nodes as placeholder values: `tr('Saved to {path}', { path: <code>{p}</code> })` */
export function tr(en: string, nodes: Record<string, ReactNode>): ReactNode {
  const pl = lang === 'pl' ? PL[en] : undefined;
  const text = typeof pl === 'string' ? pl : en;
  const parts = text.split(/(\{\w+\})/g).filter((part) => part !== '');
  return createElement(
    Fragment,
    null,
    ...parts.map((part) => {
      const m = /^\{(\w+)\}$/.exec(part);
      return m && m[1] in nodes ? nodes[m[1]] : part;
    })
  );
}

let templates: Array<{ re: RegExp; names: string[]; pl: string }> | null = null;
// Lists call tText() for thousands of rows with the same few names
const textCache = new Map<string, string>();

/**
 * Translates finished English text that was not built here — warnings saved during a scan, built-in category
 * names from the server. Exact dictionary entries first, then entries with `{placeholders}`. Unknown text
 * (e.g. a user's own category name) is returned unchanged.
 */
export function tText(text: string): string {
  if (lang === 'en' || !text) return text;
  const cached = textCache.get(text);
  if (cached !== undefined) return cached;
  const translated = translateText(text);
  if (textCache.size < 5000) textCache.set(text, translated);
  return translated;
}

function translateText(text: string): string {
  const exact = PL[text];
  if (typeof exact === 'string') return exact;
  templates ??= Object.entries(PL)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && /\{\w+\}/.test(entry[0]))
    .map(([en, pl]) => {
      const names: string[] = [];
      const source = en
        .split(/(\{\w+\})/g)
        .map((part) => {
          const m = /^\{(\w+)\}$/.exec(part);
          if (m) {
            names.push(m[1]);
            return '(.+?)';
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('');
      return { re: new RegExp(`^${source}$`), names, pl };
    });
  for (const tpl of templates) {
    const m = tpl.re.exec(text);
    if (m) return fill(tpl.pl, Object.fromEntries(tpl.names.map((name, i) => [name, m[i + 1]])));
  }
  return text;
}

/** Name of a polygon / spawn type in the active language */
export function polyTypeName(meta: PolyTypeMeta): string {
  return lang === 'pl' ? meta.namePl : meta.nameEn;
}
