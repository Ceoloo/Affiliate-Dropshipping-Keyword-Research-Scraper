// Unit tests for config loading + keyword flattening. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { flattenKeywords, loadKeywords, hasSerpApi, hasNotion } from '../src/config.js';

test('flattenKeywords turns buckets into {keyword, bucket} records', () => {
  const out = flattenKeywords({
    long_tail: ['best joint supplement', '  '],
    shopping: ['buy glucosamine'],
    ignored_non_array: 'nope',
  });
  assert.deepEqual(out, [
    { keyword: 'best joint supplement', bucket: 'long_tail' },
    { keyword: 'buy glucosamine', bucket: 'shopping' },
  ]);
});

test('flattenKeywords trims and drops blank/non-string entries', () => {
  const out = flattenKeywords({ long_tail: ['  knee pain ', 42, '', null] });
  assert.deepEqual(out, [{ keyword: 'knee pain', bucket: 'long_tail' }]);
});

test('loadKeywords parses a valid file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-'));
  const file = path.join(dir, 'keywords.json');
  fs.writeFileSync(file, JSON.stringify({ long_tail: ['a'], problem_based: ['b'], shopping: ['c'] }));
  const parsed = loadKeywords(file);
  assert.deepEqual(parsed.long_tail, ['a']);
});

test('loadKeywords throws on missing file, bad JSON, and missing bucket', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kw-'));
  assert.throws(() => loadKeywords(path.join(dir, 'nope.json')), /not found/);

  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '{ not json ');
  assert.throws(() => loadKeywords(bad), /not valid JSON/);

  const incomplete = path.join(dir, 'incomplete.json');
  fs.writeFileSync(incomplete, JSON.stringify({ long_tail: ['a'], problem_based: ['b'] }));
  assert.throws(() => loadKeywords(incomplete), /missing the "shopping" array/);
});

test('hasSerpApi / hasNotion default to false with no env configured', () => {
  // config is a snapshot of process.env at import; in the test env neither
  // SERPAPI_KEY nor NOTION_* are set, so both gates report unconfigured.
  assert.equal(hasSerpApi(), false);
  assert.equal(hasNotion(), false);
});
