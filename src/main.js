#!/usr/bin/env node
// main.js — orchestrates the full pipeline:
//   load keywords -> fetch SERP (+ Amazon for shopping) -> score -> dedupe ->
//   export CSV/JSON/MD -> optional Notion sync.

import {
  config,
  hasSerpApi,
  hasNotion,
  loadKeywords,
  flattenKeywords,
} from './config.js';
import { log } from './util.js';
import { fetchSerp, closeBrowser as closeSerpBrowser } from './fetch-serp.js';
import { fetchAmazon, closeBrowser as closeAmazonBrowser } from './fetch-amazon.js';
import { scoreKeyword } from './score.js';
import { dedupeKeywords } from './dedupe.js';
import { exportAll } from './export.js';
import { syncToNotion } from './sync-notion.js';

function parseArgs(argv) {
  return {
    syncNotion: argv.includes('--sync-notion'),
    limit: (() => {
      const i = argv.indexOf('--limit');
      return i !== -1 ? Number.parseInt(argv[i + 1], 10) : null;
    })(),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function printHelp() {
  console.log(`
supplement-keyword-scout — joint-health keyword research

Usage: node src/main.js [options]

Options:
  --sync-notion    Push the keyword matrix to Notion (needs NOTION_API_KEY +
                   NOTION_DATABASE_ID in .env)
  --limit <n>      Only process the first n keywords (handy for testing)
  --help, -h       Show this help

Data source: set SERPAPI_KEY in .env to use SerpApi (preferred). Without it,
the tool falls back to a Playwright scraper and logs FALLBACK mode.
`);
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const startedAt = Date.now();
  const useSerpApi = hasSerpApi();
  const mode = useSerpApi ? 'SerpApi (primary)' : 'Playwright scraper (FALLBACK)';

  log.step('supplement-keyword-scout');
  if (useSerpApi) {
    log.ok(`Data source: ${mode}`);
  } else {
    log.warn(`No SERPAPI_KEY found — running in ${mode}.`);
    log.warn('Results are best-effort and may be rate-limited or blocked.');
  }

  // 1. Load + flatten keywords.
  const buckets = loadKeywords();
  let records = flattenKeywords(buckets);
  if (args.limit) records = records.slice(0, args.limit);
  const shoppingCount = records.filter((r) => r.bucket === 'shopping').length;
  log.info(
    `Loaded ${records.length} keywords across ${Object.keys(buckets).length} buckets ` +
      `(${shoppingCount} in shopping bucket also hit Amazon).`
  );

  // 1–3. Fetch + score each keyword.
  const scored = [];
  let idx = 0;
  for (const rec of records) {
    idx++;
    const tag = `[${idx}/${records.length}] (${rec.bucket})`;
    try {
      log.info(`${tag} querying: "${rec.keyword}"`);
      const serp = await fetchSerp(rec.keyword, { useSerpApi });

      let amazon = null;
      if (rec.bucket === 'shopping') {
        log.info(`${tag} → Amazon lookup`);
        amazon = await fetchAmazon(rec.keyword, { useSerpApi });
      }

      const enriched = scoreKeyword({ ...rec, serp, amazon });
      scored.push(enriched);
      log.ok(
        `${tag} intent=${enriched.commercial_intent_score} ` +
          `comp=${enriched.competition_score} ` +
          `opp=${enriched.opportunity_score}${enriched.priority ? ' ⭐PRIORITY' : ''}`
      );
    } catch (err) {
      log.err(`${tag} failed: ${err.message}`);
      // Record a zeroed placeholder so one bad keyword doesn't sink the run.
      scored.push(
        scoreKeyword({
          ...rec,
          serp: { source: useSerpApi ? 'serpapi' : 'playwright', ads_count: 0, organic: [], people_also_ask: [], related_searches: [] },
          amazon: null,
        })
      );
    }
  }

  // 4. Deduplicate near-identical keywords.
  log.step('Deduplicating near-identical keywords (fuzzy ≥ 90%)…');
  const { records: deduped, mergedCount } = dedupeKeywords(scored, 0.9);
  log.ok(`Merged ${mergedCount} duplicate(s); ${deduped.length} unique keywords remain.`);

  // 5–6. Export CSV/JSON/report.
  log.step('Exporting matrix + report…');
  const meta = {
    mode,
    generated_at: new Date().toISOString(),
    total_keywords: deduped.length,
    duplicates_merged: mergedCount,
  };
  const { csvPath, jsonPath, reportPath } = exportAll(deduped, meta);
  log.ok(`CSV    → ${csvPath}`);
  log.ok(`JSON   → ${jsonPath}`);
  log.ok(`Report → ${reportPath}`);

  // 7. Optional Notion sync.
  if (args.syncNotion) {
    if (hasNotion()) {
      await syncToNotion(deduped);
    } else {
      log.warn('--sync-notion given but NOTION_API_KEY / NOTION_DATABASE_ID missing — skipping.');
    }
  }

  // Final summary.
  const priority = deduped.filter((r) => r.priority);
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  log.step('Summary');
  console.log(`  Keywords analyzed : ${deduped.length}`);
  console.log(`  Priority (opp≥7)  : ${priority.length}`);
  console.log(`  Duplicates merged : ${mergedCount}`);
  console.log(`  Data source       : ${mode}`);
  console.log(`  Elapsed           : ${elapsed}s`);
  if (priority.length) {
    console.log('\n  Top priority keywords:');
    priority
      .sort((a, b) => b.opportunity_score - a.opportunity_score)
      .slice(0, 5)
      .forEach((r) => console.log(`    • ${r.keyword} (opp ${r.opportunity_score})`));
  }
  console.log('');
}

run()
  .catch((err) => {
    log.err(`Fatal: ${err.stack || err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Ensure any launched browsers are torn down.
    await Promise.allSettled([closeSerpBrowser(), closeAmazonBrowser()]);
  });
