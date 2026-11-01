export interface ModeGroupDefinition {
  id: string;
  name: string;
  shortName: string;
  description: string;
  badgeColor: string;
  builtIn: boolean;
  defaultPrefixes: string[];
}

export interface CustomPrefixRule {
  id: string;
  name: string;               // np. "Liga SCTFL", "RSCS Dodatkowe", "Mapy Klanu NS"
  prefixes: string[];         // np. ["ctf_ns_", "sctfl_"]
  pattern?: string;           // opcjonalny wildcard (np. "*_f", "*arena*") lub "/regex/i"
  badgeColor: string;         // kolor hex plakietki
  targetGroupId?: string;     // jeśli podano istniejące id grupy (np. 'rscs', 'trenchwars'), podpina pod nią; inaczej tworzy własną grupę
  priority: number;           // wyższy = sprawdzany wcześniej
  enabled: boolean;
}

export interface MapClassification {
  prefix: string;             // np. "ctf_cs_", "tw_", "ctf_tw_", "ctf_", "__none__"
  modeGroupId: string;        // np. "rscs", "trenchwars", "ctf", "climb", "custom:..."
  modeGroupName: string;
  badgeColor: string;
  subprefix: string | null;   // np. "ctf_ns_" dla "ctf_ns_arena" gdy dopasowano ogólne "ctf_"
  matchedRuleId?: string;
}

export const BUILTIN_MODE_GROUPS: ModeGroupDefinition[] = [
  {
    id: 'ctf',
    name: 'Capture the Flag (CTF)',
    shortName: 'CTF',
    description: 'Klasyczne oraz ligowe mapy Capture the Flag',
    badgeColor: '#ef4444',
    builtIn: true,
    defaultPrefixes: ['ctf_', 'sctf_'],
  },
  {
    id: 'rscs',
    name: 'RSCS (Counter-Strike)',
    shortName: 'RSCS',
    description: 'Realistic Soldat Counter-Strike — Hostage Rescue, Bomb Defusal, AIM/AWP/FY',
    badgeColor: '#f59e0b',
    builtIn: true,
    defaultPrefixes: ['ctf_cs_', 'ctf_de_', 'cs_', 'de_', 'aim_', 'awp_', 'fy_', 'as_', 'es_', 'ka_', 'he_'],
  },
  {
    id: 'trenchwars',
    name: 'Trenchwars (TW / TTW)',
    shortName: 'Trenchwars',
    description: 'Mapy okopowe i taktyczne Trenchwars oraz Total Trenchwars',
    badgeColor: '#f97316',
    builtIn: true,
    defaultPrefixes: ['tw_', 'ttw_', 'ctf_tw_', 'ctf_ttw_', 'inf_tw_', 'htf_tw_', 'dm_tw_'],
  },
  {
    id: 'climb',
    name: 'Climb / Kreedz / Race',
    shortName: 'Climb & Race',
    description: 'Mapy wspinaczkowe, przeszkodowe, wyścigowe, Hardcore Climb i Bunnyhop',
    badgeColor: '#10b981',
    builtIn: true,
    defaultPrefixes: [
      'kz_',
      'cl_',
      'climb_',
      'rce_',
      'race_',
      'ctf_rce_',
      'ctf_kz_',
      'ctf_cl_',
      'hc_',
      'bh_',
      'obst_',
      'run_',
      'surf_',
      'jmp_',
      'jump_',
    ],
  },
  {
    id: 'inf',
    name: 'Infiltration (INF)',
    shortName: 'INF',
    description: 'Obrona i atak bazy (Czerwoni vs Niebiescy)',
    badgeColor: '#3b82f6',
    builtIn: true,
    defaultPrefixes: ['inf_'],
  },
  {
    id: 'htf',
    name: 'Hold the Flag (HTF)',
    shortName: 'HTF',
    description: 'Utrzymanie żółtej flagi na czas',
    badgeColor: '#eab308',
    builtIn: true,
    defaultPrefixes: ['htf_'],
  },
  {
    id: 'dm',
    name: 'Deathmatch / TM / PM / RM',
    shortName: 'DM / Klasyczne',
    description: 'Deathmatch (w tym mapy bez prefixu), Teammatch, Pointmatch, Rambomatch',
    badgeColor: '#94a3b8',
    builtIn: true,
    defaultPrefixes: ['__none__', 'dm_', 'tm_', 'tdm_', 'pm_', 'rm_', 'rambo_', 'ffa_'],
  },
  {
    id: 'sniper',
    name: 'Longshot / Snajperskie',
    shortName: 'Longshot',
    description: 'Mapy snajperskie dalekiego zasięgu (Barrett / Ruger)',
    badgeColor: '#8b5cf6',
    builtIn: true,
    defaultPrefixes: ['ls_', 'ctf_ls_', 'sniper_', 'snip_', 'bar_', 'b82_', 'r77_'],
  },
  {
    id: 'hns_zombie',
    name: 'Hide & Seek / Zombie / RPG',
    shortName: 'HNS & Zombie',
    description: 'Hide & Seek, Zombie Mod / ZRPG, Hexer, Survival i Co-op',
    badgeColor: '#ec4899',
    builtIn: true,
    defaultPrefixes: ['hns_', 'zrpg_', 'zm_', 'ze_', 'zomb_', 'zombie_', 'hex_', 'rpg_', 'surv_', 'coop_', 'boss_'],
  },
  {
    id: 'weapon_arena',
    name: 'Areny Broni (Knife / M79 / Saw)',
    shortName: 'Areny Broni',
    description: 'Areny dedykowane pojedynczym broniom (Nóż, M79 Nadejump, Piła, LAW, Łuk)',
    badgeColor: '#06b6d4',
    builtIn: true,
    defaultPrefixes: ['kn_', 'knife_', 'm79_', 'nad_', 'nade_', 'saw_', 'chainsaw_', 'law_', 'flamer_', 'bow_', 'dgl_', 'deagle_'],
  },
  {
    id: 'sports_fun',
    name: 'Dodgeball / Sportowe / Fun',
    shortName: 'Sport & Fun',
    description: 'Dodgeball, Football, Volleyball, Pong, Labirynty i mapy rozrywkowe',
    badgeColor: '#f43f5e',
    builtIn: true,
    defaultPrefixes: ['db_', 'dodge_', 'ball_', 'fb_', 'foot_', 'vol_', 'vlk_', 'disk_', 'kbx_', 'pong_', 'fun_', 'maze_', 'box_', 'arena_'],
  },
  {
    id: 'realistic',
    name: 'Realistic / Taktyczne',
    shortName: 'Realistic',
    description: 'Mapy pod tryb realistyczny, wojenny i taktyczny',
    badgeColor: '#84cc16',
    builtIn: true,
    defaultPrefixes: ['real_', 'rl_', 'tac_', 'war_', 'mil_', 'ww2_', 'dday_'],
  },
  {
    id: 'other',
    name: 'Inne / Niestandardowe Prefixy',
    shortName: 'Inne',
    description: 'Pozostałe prefixy autorskie, klanowe i niestandardowe',
    badgeColor: '#64748b',
    builtIn: true,
    defaultPrefixes: [],
  },
];

const BUILTIN_GROUP_MAP = new Map<string, ModeGroupDefinition>(
  BUILTIN_MODE_GROUPS.map((g) => [g.id, g])
);

export interface CompiledClassifier {
  classify: (mapBaseName: string) => MapClassification;
  getGroupMeta: (groupId: string) => { id: string; name: string; shortName: string; badgeColor: string; isCustom: boolean };
  getPrefixMeta: (prefix: string) => { prefix: string; label: string; modeGroupId: string; modeName: string; badgeColor: string };
}

interface PrefixMatcherEntry {
  prefix: string;
  groupId: string;
  groupName: string;
  badgeColor: string;
  priorityTier: number; // 2 = user custom rule, 1 = built-in rule
  userPriority: number;
  ruleId?: string;
}

interface PatternMatcherEntry {
  regex: RegExp;
  pseudoPrefix: string;
  groupId: string;
  groupName: string;
  badgeColor: string;
  userPriority: number;
  ruleId: string;
}

export function normalizePrefixToken(raw: string): string {
  const clean = raw.trim().toLowerCase();
  if (!clean) return '';
  if (clean === '__none__' || clean === 'none' || clean === 'brak') return '__none__';
  return clean.endsWith('_') ? clean : `${clean}_`;
}

function compileWildcardOrRegex(patternStr: string): RegExp | null {
  const trimmed = patternStr.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
      const lastSlash = trimmed.lastIndexOf('/');
      const body = trimmed.slice(1, lastSlash);
      // 'g' / 'y' make RegExp.test() stateful (lastIndex), which would misclassify every other map
      const flags = (trimmed.slice(lastSlash + 1) || 'i').replace(/[gy]/g, '');
      return new RegExp(body, flags.includes('i') ? flags : `${flags}i`);
    }
    // Wildcard (* and ?) -> RegExp
    const escaped = trimmed.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
  } catch {
    return null;
  }
}

/**
 * Compiles built-in Soldat modes + user custom prefix/category rules into an ultra-fast
 * Longest-Prefix-First classifier capable of classifying 100,000 maps in ~15ms.
 */
export function createMapClassifier(customRules: CustomPrefixRule[] = []): CompiledClassifier {
  const prefixEntries: PrefixMatcherEntry[] = [];
  const patternEntries: PatternMatcherEntry[] = [];
  const customGroupMeta = new Map<
    string,
    { id: string; name: string; shortName: string; badgeColor: string; isCustom: boolean }
  >();
  const prefixMetaLookup = new Map<
    string,
    { prefix: string; label: string; modeGroupId: string; modeName: string; badgeColor: string }
  >();

  // 1. Register built-in mode prefixes
  for (const grp of BUILTIN_MODE_GROUPS) {
    for (const rawPfx of grp.defaultPrefixes) {
      const pfx = rawPfx === '__none__' ? '__none__' : normalizePrefixToken(rawPfx);
      if (!pfx) continue;
      if (pfx !== '__none__') {
        prefixEntries.push({
          prefix: pfx,
          groupId: grp.id,
          groupName: grp.name,
          badgeColor: grp.badgeColor,
          priorityTier: 1,
          userPriority: 0,
        });
      }
      prefixMetaLookup.set(pfx, {
        prefix: pfx,
        label: pfx === '__none__' ? 'Bez prefixu (DM)' : pfx,
        modeGroupId: grp.id,
        modeName: grp.name,
        badgeColor: grp.badgeColor,
      });
    }
  }

  // 2. Register user custom rules (higher priority than built-in!)
  const activeRules = customRules
    .filter((r) => r && r.enabled !== false)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const rule of activeRules) {
    const targetBuiltIn = rule.targetGroupId ? BUILTIN_GROUP_MAP.get(rule.targetGroupId) : undefined;
    const groupId = targetBuiltIn ? targetBuiltIn.id : `custom:${rule.id}`;
    const groupName = targetBuiltIn ? targetBuiltIn.name : rule.name || 'Własna Kategoria';
    const badgeColor = rule.badgeColor || targetBuiltIn?.badgeColor || '#a855f7';

    if (!targetBuiltIn) {
      customGroupMeta.set(groupId, {
        id: groupId,
        name: groupName,
        shortName: groupName,
        badgeColor,
        isCustom: true,
      });
    }

    for (const rawPfx of rule.prefixes || []) {
      const pfx = normalizePrefixToken(rawPfx);
      if (!pfx) continue;
      if (pfx !== '__none__') {
        prefixEntries.push({
          prefix: pfx,
          groupId,
          groupName,
          badgeColor,
          priorityTier: 2,
          userPriority: rule.priority ?? 10,
          ruleId: rule.id,
        });
      }
      prefixMetaLookup.set(pfx, {
        prefix: pfx,
        label: pfx === '__none__' ? 'Bez prefixu (DM)' : pfx,
        modeGroupId: groupId,
        modeName: groupName,
        badgeColor,
      });
    }

    if (rule.pattern?.trim()) {
      const rx = compileWildcardOrRegex(rule.pattern);
      if (rx) {
        const pseudoPrefix =
          rule.prefixes && rule.prefixes.length > 0
            ? normalizePrefixToken(rule.prefixes[0])
            : `[${rule.name}]`;
        patternEntries.push({
          regex: rx,
          pseudoPrefix,
          groupId,
          groupName,
          badgeColor,
          userPriority: rule.priority ?? 10,
          ruleId: rule.id,
        });
        if (!prefixMetaLookup.has(pseudoPrefix)) {
          prefixMetaLookup.set(pseudoPrefix, {
            prefix: pseudoPrefix,
            label: pseudoPrefix,
            modeGroupId: groupId,
            modeName: groupName,
            badgeColor,
          });
        }
      }
    }
  }

  // Sort prefix matchers:
  // 1) Longest prefix first (so "ctf_ttw_" & "ctf_cs_" ALWAYS beat "ctf_"!)
  // 2) User tier (2) beats built-in tier (1) when exact same prefix length
  // 3) Higher userPriority beats lower
  prefixEntries.sort((a, b) => {
    if (b.prefix.length !== a.prefix.length) {
      return b.prefix.length - a.prefix.length;
    }
    if (b.priorityTier !== a.priorityTier) {
      return b.priorityTier - a.priorityTier;
    }
    return b.userPriority - a.userPriority;
  });

  // Group prefix entries by first character for O(1) bucket lookup on 100k maps!
  const buckets = new Map<string, PrefixMatcherEntry[]>();
  for (const entry of prefixEntries) {
    const ch = entry.prefix[0];
    let list = buckets.get(ch);
    if (!list) {
      list = [];
      buckets.set(ch, list);
    }
    list.push(entry);
  }

  const getGroupMeta = (groupId: string) => {
    const builtIn = BUILTIN_GROUP_MAP.get(groupId);
    if (builtIn) {
      return {
        id: builtIn.id,
        name: builtIn.name,
        shortName: builtIn.shortName,
        badgeColor: builtIn.badgeColor,
        isCustom: false,
      };
    }
    const custom = customGroupMeta.get(groupId);
    if (custom) return custom;
    return {
      id: 'other',
      name: 'Inne / Niestandardowe',
      shortName: 'Inne',
      badgeColor: '#64748b',
      isCustom: false,
    };
  };

  const getPrefixMeta = (prefix: string) => {
    const known = prefixMetaLookup.get(prefix);
    if (known) return known;
    return {
      prefix,
      label: prefix === '__none__' ? 'Bez prefixu (DM)' : prefix,
      modeGroupId: 'other',
      modeName: 'Inne / Niestandardowe Prefixy',
      badgeColor: '#64748b',
    };
  };

  const classify = (mapBaseName: string): MapClassification => {
    const rawTrimmed = mapBaseName.trim();
    // Fix rare typo like "ctf._ow" -> "ctf_ow"
    const normalizedForMatch = rawTrimmed
      .replace(/^(ctf|inf|htf|tw|ttw|kz|cl|ls|rce|hns|dm)\._/i, '$1_')
      .toLowerCase();

    // 1. First matching custom wildcard/regex pattern (patterns are ordered by rule priority)
    let patternHit: PatternMatcherEntry | null = null;
    for (const pat of patternEntries) {
      if (pat.regex.test(rawTrimmed)) {
        patternHit = pat;
        break;
      }
    }

    // 2. Longest-Prefix-First bucket
    let prefixHit: PrefixMatcherEntry | null = null;
    if (normalizedForMatch.length > 0) {
      const bucket = buckets.get(normalizedForMatch[0]);
      if (bucket) {
        for (let i = 0; i < bucket.length; i++) {
          if (normalizedForMatch.startsWith(bucket[i].prefix)) {
            prefixHit = bucket[i];
            break;
          }
        }
      }
    }

    // A pattern beats built-in prefixes and custom prefix rules of lower or equal priority;
    // a custom prefix rule with a higher priority than the pattern's rule wins.
    if (
      patternHit &&
      (!prefixHit || prefixHit.priorityTier === 1 || patternHit.userPriority >= prefixHit.userPriority)
    ) {
      return {
        prefix: patternHit.pseudoPrefix,
        modeGroupId: patternHit.groupId,
        modeGroupName: patternHit.groupName,
        badgeColor: patternHit.badgeColor,
        subprefix: extractCompoundSubprefix(normalizedForMatch, patternHit.pseudoPrefix),
        matchedRuleId: patternHit.ruleId,
      };
    }
    if (prefixHit) {
      return {
        prefix: prefixHit.prefix,
        modeGroupId: prefixHit.groupId,
        modeGroupName: prefixHit.groupName,
        badgeColor: prefixHit.badgeColor,
        subprefix: extractCompoundSubprefix(normalizedForMatch, prefixHit.prefix),
        matchedRuleId: prefixHit.ruleId,
      };
    }

    // 3. Fallback: generic first-token prefix or __none__
    const genericMatch = normalizedForMatch.match(/^([a-z0-9!$-]{1,14}_)/);
    if (!genericMatch) {
      const dmMeta = prefixMetaLookup.get('__none__')!;
      return {
        prefix: '__none__',
        modeGroupId: dmMeta.modeGroupId,
        modeGroupName: dmMeta.modeName,
        badgeColor: dmMeta.badgeColor,
        subprefix: null,
      };
    }

    const pfx = genericMatch[1];
    return {
      prefix: pfx,
      modeGroupId: 'other',
      modeGroupName: 'Inne / Niestandardowe Prefixy',
      badgeColor: '#64748b',
      subprefix: extractCompoundSubprefix(normalizedForMatch, pfx),
    };
  };

  return { classify, getGroupMeta, getPrefixMeta };
}

/**
 * Extracts a 2-part series subprefix (e.g. "ctf_ns_" from "ctf_ns_arena")
 * when the primary matched prefix is single-part (e.g. "ctf_").
 */
function extractCompoundSubprefix(lowerMapName: string, matchedPrefix: string): string | null {
  // Only extract compound subprefix if matchedPrefix is single-segment like "ctf_"
  const firstUnderscore = matchedPrefix.indexOf('_');
  if (firstUnderscore <= 0 || firstUnderscore !== matchedPrefix.length - 1) {
    return null;
  }
  const rest = lowerMapName.slice(matchedPrefix.length);
  // Look for a short clan/author/mode tag (1..8 chars) followed by another underscore and map name
  const subMatch = rest.match(/^([a-z0-9!$-]{1,8})_[a-z0-9]/);
  if (!subMatch) return null;
  return `${matchedPrefix}${subMatch[1]}_`;
}

/**
 * Validates and normalizes untrusted rule lists (imported JSON files, HTTP request bodies, old config.json),
 * so a malformed rule can never crash the classifier or get persisted.
 */
export function sanitizeCustomRules(raw: unknown): CustomPrefixRule[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomPrefixRule[] = [];
  const seenIds = new Set<string>();
  for (const item of raw.slice(0, 500)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const name = String(r.name ?? '').trim().slice(0, 80);
    const rawPrefixes: unknown[] = Array.isArray(r.prefixes)
      ? r.prefixes
      : typeof r.prefixes === 'string'
      ? r.prefixes.split(/[,;\s]+/)
      : [];
    const prefixes = Array.from(
      new Set(rawPrefixes.map((p) => normalizePrefixToken(String(p ?? ''))).filter(Boolean))
    ).slice(0, 100);
    const pattern =
      typeof r.pattern === 'string' && r.pattern.trim() && compileWildcardOrRegex(r.pattern)
        ? r.pattern.trim().slice(0, 200)
        : undefined;
    if (!name || (prefixes.length === 0 && !pattern)) continue;

    let id =
      typeof r.id === 'string' && /^[\w-]{1,64}$/.test(r.id)
        ? r.id
        : `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    while (seenIds.has(id)) id = `${id}_${out.length}`;
    seenIds.add(id);

    const badgeColor =
      typeof r.badgeColor === 'string' && /^#[0-9a-f]{6}$/i.test(r.badgeColor) ? r.badgeColor : '#a855f7';
    const targetGroupId =
      typeof r.targetGroupId === 'string' && r.targetGroupId !== 'other' && BUILTIN_GROUP_MAP.has(r.targetGroupId)
        ? r.targetGroupId
        : undefined;
    const priority = Number.isFinite(Number(r.priority)) ? Math.round(Number(r.priority)) : 10;

    out.push({ id, name, prefixes, pattern, badgeColor, targetGroupId, priority, enabled: r.enabled !== false });
  }
  return out;
}

// Default singleton classifier when no custom rules are needed
const defaultClassifier = createMapClassifier([]);

export function extractMapPrefix(mapBaseName: string, customRules?: CustomPrefixRule[]): string {
  if (customRules && customRules.length > 0) {
    return createMapClassifier(customRules).classify(mapBaseName).prefix;
  }
  return defaultClassifier.classify(mapBaseName).prefix;
}

export function getPrefixMeta(prefix: string, customRules?: CustomPrefixRule[]) {
  if (customRules && customRules.length > 0) {
    return createMapClassifier(customRules).getPrefixMeta(prefix);
  }
  return defaultClassifier.getPrefixMeta(prefix);
}
