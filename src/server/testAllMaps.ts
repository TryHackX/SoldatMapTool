import fs from 'fs';
import path from 'path';
import { SoldatMapScanner } from './soldatScanner';
import { createMapClassifier } from '../shared/prefixUtils';
import { findDefaultSoldatPath } from './platform';

function readConfiguredSoldatPath(): string {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'data', 'config.json'), 'utf-8'));
    if (typeof cfg.soldatPath === 'string' && cfg.soldatPath.trim()) return cfg.soldatPath.trim();
  } catch {
    // Fall back to the Steam install found on this machine
  }
  return findDefaultSoldatPath();
}

async function main() {
  const soldatPath = process.argv[2] || readConfiguredSoldatPath();
  // Own cache folder: never purges or locks the running app's index
  const cacheDir = path.resolve(process.cwd(), 'data', 'cache-test');
  const thumbDir = path.resolve(cacheDir, 'thumbnails');

  console.log(`[Test v2.0] Testing SoldatMapScanner + SQLite WAL on ${soldatPath}...`);
  const scanner = new SoldatMapScanner(soldatPath, [], [], cacheDir, thumbDir);
  const meta1 = await scanner.scanAsync(true);

  console.log(`Initial SQLite scan completed in ${meta1.scanDurationMs} ms!`);
  console.log(
    `Total: ${meta1.totalMaps} | Vanilla: ${meta1.vanillaMapsCount} | Custom: ${meta1.customMapsCount} | Missing assets: ${meta1.brokenMapsCount} | Duplicates: ${meta1.duplicateMapsCount}`
  );

  console.log('\n=== Mode Groups (RSCS, Trenchwars, CTF, Climb...) ===');
  for (const g of meta1.modeGroups) {
    const pfxSummary = g.prefixes.map((p) => `${p.label}(${p.count})`).join(', ');
    console.log(`  [${g.name.padEnd(32)}] -> ${String(g.count).padStart(4)} map | ${pfxSummary}`);
  }

  console.log('\n=== Top Discovered Compound Subprefixes ===');
  for (const sp of meta1.discoveredSubprefixes.slice(0, 12)) {
    console.log(`  ${sp.subprefix.padEnd(16)} (under ${sp.parentPrefix}) -> ${sp.count}`);
  }

  // Test cached rescan speed
  const meta2 = await scanner.scanAsync(false);
  console.log(`\nCached SQLite WAL re-scan completed in ${meta2.scanDurationMs} ms!`);

  // Benchmark 50,000-map classification & query throughput simulation!
  const tBench = performance.now();
  const customClassifier = createMapClassifier([
    {
      id: 'rule_ns',
      name: 'NightStalkers CTF',
      prefixes: ['ctf_ns_'],
      badgeColor: '#38bdf8',
      priority: 100,
      enabled: true,
    },
    {
      id: 'rule_fixed',
      name: 'Poprawione Mapy (_f)',
      prefixes: [],
      pattern: '*_f',
      badgeColor: '#a855f7',
      priority: 50,
      enabled: true,
    },
  ]);

  const sampleNames = [
    'ctf_cs_assault',
    'ctf_de_aztec',
    'tw_Cathedral',
    'ttw_bunker',
    'ctf_tw_castle',
    'ctf_ttw_valley',
    'ctf_ns_arena',
    'ctf_cs_747_f',
    'kz_everest',
    'Arena',
  ];
  for (let i = 0; i < 50000; i++) {
    customClassifier.classify(sampleNames[i % sampleNames.length]);
  }
  const benchMs = Math.round((performance.now() - tBench) * 100) / 100;
  console.log(`\n[Benchmark] Classified 50,000 map names (with custom rules + regex) in ${benchMs} ms!`);

  for (const name of sampleNames) {
    const c = customClassifier.classify(name);
    console.log(
      `  ${name.padEnd(18)} => prefix=${c.prefix.padEnd(10)} group=${c.modeGroupName} sub=${c.subprefix ?? '-'}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
