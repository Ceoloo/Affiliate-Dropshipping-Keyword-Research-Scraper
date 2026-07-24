// Unit tests for the Notion property mapping + sync counting (stubbed fetch).
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pageProperties, syncToNotion } from '../src/sync-notion.js';

function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return (async () => {
    try {
      return await fn();
    } finally {
      globalThis.fetch = original;
    }
  })();
}

const record = {
  keyword: 'best joint supplement',
  buckets: ['long_tail', 'shopping'],
  opportunity_score: 8,
  commercial_intent_score: 9,
  competition_score: 4,
  priority: true,
  source: 'serpapi',
  suggested_angle: 'comparison; buyer guide',
};

test('pageProperties maps a record to Notion property shapes', () => {
  const props = pageProperties(record);
  assert.equal(props.Keyword.title[0].text.content, 'best joint supplement');
  assert.equal(props.Bucket.rich_text[0].text.content, 'long_tail, shopping');
  assert.equal(props.Opportunity.number, 8);
  assert.equal(props.Intent.number, 9);
  assert.equal(props.Competition.number, 4);
  assert.equal(props.Priority.checkbox, true);
  assert.equal(props.Source.rich_text[0].text.content, 'serpapi');
  assert.equal(props.Angle.rich_text[0].text.content, 'comparison; buyer guide');
});

test('pageProperties falls back to single bucket + safe defaults', () => {
  const props = pageProperties({ keyword: 'k', bucket: 'problem_based' });
  assert.equal(props.Bucket.rich_text[0].text.content, 'problem_based');
  assert.equal(props.Priority.checkbox, false);
  assert.equal(props.Source.rich_text[0].text.content, '');
});

test('syncToNotion counts successes', async () => {
  const res = await withFetch(okCreate(), () => syncToNotion([record, { ...record, keyword: 'k2' }]));
  assert.deepEqual(res, { ok: 2, failed: 0 });
});

test('syncToNotion counts failures without throwing', async () => {
  const res = await withFetch(
    async () => ({ ok: false, status: 400, text: async () => 'bad request' }),
    () => syncToNotion([record])
  );
  assert.deepEqual(res, { ok: 0, failed: 1 });
});

function okCreate() {
  return async () => ({ ok: true, status: 200, json: async () => ({ id: 'page_x' }) });
}
