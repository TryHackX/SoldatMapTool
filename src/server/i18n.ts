import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { SERVER_PL } from './i18nPl';

// Server messages (API errors, warnings, generated files) are written in English; Polish comes from ./i18nPl,
// keyed by the English text. The language is the one chosen in the UI (cookie `sms_lang`).

export type Lang = 'en' | 'pl';

const requestLang = new AsyncLocalStorage<Lang>();
// Single-user local app: work that outlives a request context (stream callbacks, background jobs) uses the
// language of the most recent request
let lastLang: Lang = 'en';

export function langOf(req: Request): Lang {
  return /(?:^|;\s*)sms_lang=pl(?:;|$)/.test(req.headers.cookie ?? '') ? 'pl' : 'en';
}

/** Express middleware (after the body parsers): messages created while handling a request use its language */
export function i18nMiddleware(req: Request, _res: Response, next: NextFunction): void {
  lastLang = langOf(req);
  requestLang.run(lastLang, next);
}

export function currentLang(): Lang {
  return requestLang.getStore() ?? lastLang;
}

type Vars = Record<string, string | number>;

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? String(vars[key]) : m));
}

/** `t('Map file not found: {id}', { id })` — English source, Polish from the dictionary */
export function t(en: string, vars?: Vars): string {
  if (currentLang() === 'pl') {
    const pl = SERVER_PL[en];
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

/** `tp(n, '{n} file', '{n} files')`; Polish forms [1, 2–4, 5+] come from the dictionary key "one|other" */
export function tp(n: number, one: string, other: string, vars?: Vars): string {
  const all: Vars = { n, ...vars };
  if (currentLang() === 'pl') {
    const forms = SERVER_PL[`${one}|${other}`];
    if (Array.isArray(forms)) return fill(forms[polishPluralIndex(n)], all);
  }
  return fill(Math.abs(n) === 1 ? one : other, all);
}
