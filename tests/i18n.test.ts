import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NextFunction, Request, Response } from 'express';
import { currentLang, i18nMiddleware, t, tp } from '../src/server/i18n';

/** Runs `fn` the way a request handler would, with the given Cookie header */
function inRequest<T>(cookie: string | undefined, fn: () => T): T {
  let out: T | undefined;
  const req = { headers: cookie ? { cookie } : {} } as unknown as Request;
  i18nMiddleware(req, {} as Response, (() => {
    out = fn();
  }) as NextFunction);
  return out as T;
}

test('server messages follow the language chosen in the UI (cookie), English by default', () => {
  assert.equal(inRequest(undefined, currentLang), 'en');
  assert.equal(inRequest('sms_lang=pl', () => t('Map file not found: {id}', { id: 'ctf_x' })), 'Nie znaleziono pliku mapy: ctf_x');
  assert.equal(inRequest('theme=dark; sms_lang=en', () => t('Map file not found: {id}', { id: 'ctf_x' })), 'Map file not found: ctf_x');
  // Unknown texts fall back to English with placeholders filled
  assert.equal(inRequest('sms_lang=pl', () => t('Not in the dictionary {x}', { x: 1 })), 'Not in the dictionary 1');
});

test('Polish plural forms: 1 / 2–4 / 5+ (12–14 and 22 included)', () => {
  const forms = (n: number) => inRequest('sms_lang=pl', () => tp(n, '{n} file', '{n} files'));
  assert.deepEqual([1, 2, 4, 5, 12, 14, 22, 25, 101].map(forms), [
    '1 plik',
    '2 pliki',
    '4 pliki',
    '5 plików',
    '12 plików',
    '14 plików',
    '22 pliki',
    '25 plików',
    '101 plików',
  ]);
  assert.deepEqual([1, 2].map((n) => inRequest('sms_lang=en', () => tp(n, '{n} file', '{n} files'))), ['1 file', '2 files']);
});
