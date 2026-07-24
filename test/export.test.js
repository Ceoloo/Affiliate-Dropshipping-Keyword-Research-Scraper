// Unit tests for CSV/JSON/Markdown export. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { toCsv, sortByOpportunity, toMarkdownReport, exportAll } from '../src/export.js';

const recA = {
  keyword: 'best joint supplement, reviewed',
  buckets: ['long_tail'],
  source: 'serpapi',
  commercial_intent_score: 9,
  competition_score: 4,
  opportunity_score: 8,
  priority: true,
  suggested_angle: 'comparison',
};
const recB = {
  keyword: 'knee pain',
  bucket: 'problem_based',
  source: 'serpapi',
  commercial_intent_score: 5,
  competition_score: 6,
  opportunity_score: 3,
  priority: false,
  suggested_angle: 'educational',
};

test('toCsv writes a header + one row per record and escapes commas', () => {
  const csv = toCsv([recA, recB]);
  const lines = csv.split('\n');
  assert.equal(lines.length, 3); // header + 2 rows
  assert.ok(lines[0].startsWith('keyword,bucket,source,'));
  // Comma-containing keyword must be quoted.
  assert.ok(lines[1].includes('"best joint supplement, reviewed"'));
  // buckets array is rendered with a pipe.
  assert.ok(lines[1].includes('long_tail'));
});

test('sortByOpportunity is descending and non-mutating', () => {
  const input = [recB, recA];
  const sorted = sortByOpportunity(input);
  assert.deepEqual(sorted.map((r) => r.opportunity_score), [8, 3]);
  assert.deepEqual(input.map((r) => r.opportunity_score), [3, 8]); // original untouched
});

test('toMarkdownReport includes header, counts, and the top keyword', () => {
  const md = toMarkdownReport([recA, recB], { mode: 'SerpApi (primary)' });
  assert.ok(md.includes('# Joint-Health Supplement — Keyword Opportunity Report'));
  assert.ok(md.includes('**Keywords analyzed:** 2'));
  assert.ok(md.includes('**Priority (opportunity ≥ 7):** 1'));
  assert.ok(md.includes('best joint supplement, reviewed'));
  assert.ok(md.includes('SerpApi (primary)'));
});

test('exportAll writes all three artifacts and returns their paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-export-'));
  const { csvPath, jsonPath, reportPath } = exportAll([recA, recB], { mode: 'test' }, dir);

  for (const p of [csvPath, jsonPath, reportPath]) {
    assert.ok(fs.existsSync(p), `expected ${p} to exist`);
  }
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.equal(json.count, 2);
  assert.equal(json.keywords[0].opportunity_score, 8); // sorted desc
  // slimRecord moves raw payloads under _raw.
  assert.ok('_raw' in json.keywords[0]);
});
