/**
 * Polish UI dictionary: key = the exact English text passed to t() / tr() / tText(), value = Polish text with the
 * same `{placeholders}`. Entries for tp(n, one, other) use the key "one|other" and the three Polish forms
 * [1, 2–4, 5+], e.g. '{n} map|{n} maps': ['{n} mapa', '{n} mapy', '{n} map'].
 */
export type PlDictionary = Record<string, string | readonly [string, string, string]>;
