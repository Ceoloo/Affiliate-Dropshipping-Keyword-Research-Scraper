// Unit tests for dedupe helpers. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeKeyword,
  levenshtein,
  levenshteinRatio,
  jaccardTokens,
  similarity,
  dedupeKeywords,
} from '../src/dedupe.js';

test('normalizeKeyword lowercases, strips punctuation, singularizes', () => {
  assert.equal(normalizeKeyword('Best Joint Supplements!'), 'best joint supplement');
  assert.equal(normalizeKeyword('  Knee   Pain '), 'knee pain');
});

test('levenshtein basic distances', () => {
  assert.equal(levenshtein('cat', 'cat'), 0);
  assert.equal(levenshtein('cat', 'bat'), 1);
  assert.equal(levenshtein('', 'abc'), 3);
});

test('levenshteinRatio in [0,1]', () => {
  assert.equal(levenshteinRatio('abc', 'abc'), 1);
  assert.ok(levenshteinRatio('abc', 'abd') < 1);
});

test('jaccardTokens overlap', () => {
  assert.equal(jaccardTokens('a b c', 'a b c'), 1);
  assert.equal(jaccardTokens('a b', 'c d'), 0);
  assert.equal(jaccardTokens('a b c', 'a b'), 2 / 3);
});

test('similarity collapses singular/plural variants', () => {
  const s = similarity('best joint supplement', 'best joint supplements');
  assert.ok(s >= 0.9, `expected >= 0.9, got ${s}`);
});

test('similarity keeps distinct intents apart', () => {
  const s = similarity('knee pain relief', 'hip pain relief');
  assert.ok(s < 0.9, `expected < 0.9, got ${s}`);
});

test('dedupeKeywords merges near-duplicates and unions buckets', () => {
  const records = [
    { keyword: 'best joint supplement', bucket: 'long_tail', opportunity_score: 8, ads_count: 2, paa_count: 1, amazon_max_reviews: 0 },
    { keyword: 'best joint supplements', bucket: 'shopping', opportunity_score: 6, ads_count: 4, paa_count: 3, amazon_max_reviews: 500 },
    { keyword: 'knee pain relief', bucket: 'problem_based', opportunity_score: 7, ads_count: 1, paa_count: 0, amazon_max_reviews: 0 },
  ];
  const { records: out, mergedCount } = dedupeKeywords(records, 0.9);
  assert.equal(mergedCount, 1);
  assert.equal(out.length, 2);

  const merged = out.find((r) => r.keyword.startsWith('best joint supplement'));
  assert.ok(merged.buckets.includes('long_tail'));
  assert.ok(merged.buckets.includes('shopping'));
  // Keeps the higher signal counts across the pair.
  assert.equal(merged.ads_count, 4);
  assert.equal(merged.paa_count, 3);
  assert.equal(merged.amazon_max_reviews, 500);
  assert.ok(merged.merged_from.length >= 1);
});

test('dedupeKeywords leaves unique keywords untouched', () => {
  const records = [
    { keyword: 'turmeric vs glucosamine', bucket: 'long_tail', opportunity_score: 5 },
    { keyword: 'collagen for arthritis', bucket: 'long_tail', opportunity_score: 5 },
  ];
  const { records: out, mergedCount } = dedupeKeywords(records, 0.9);
  assert.equal(mergedCount, 0);
  assert.equal(out.length, 2);
});
