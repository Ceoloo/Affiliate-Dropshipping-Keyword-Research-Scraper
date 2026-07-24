// Unit tests for Google SERP acquisition + parsing. The SerpApi path is tested
// by stubbing globalThis.fetch; the Playwright fallback is not exercised here
// (it needs a real browser). Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { domainOf, fetchSerpViaSerpApi } from '../src/fetch-serp.js';

test('domainOf strips protocol + www and lowercases', () => {
  assert.equal(domainOf('https://www.Healthline.com/nutrition'), 'healthline.com');
  assert.equal(domainOf('http://amazon.com/dp/x'), 'amazon.com');
  assert.equal(domainOf('webmd.com/a/b'), 'webmd.com');
  assert.equal(domainOf(''), '');
});

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

const okJson = (body) => async () => ({ ok: true, status: 200, json: async () => body });

test('fetchSerpViaSerpApi normalizes ads, organic, PAA, and related', async () => {
  const body = {
    ads: [{}, {}],
    shopping_results: [{}],
    organic_results: [
      { title: 'A', link: 'https://www.a.com/x' },
      { title: 'B', link: 'https://b.org/y' },
      { title: 'C', link: 'https://c.net' },
      { title: 'D', link: 'https://d.io' },
      { title: 'E', link: 'https://e.co' },
      { title: 'F', link: 'https://f.com' }, // 6th -> sliced off
    ],
    related_questions: [{ question: 'does it work?' }, { title: 'is it safe?' }],
    related_searches: [{ query: 'best joint supplement' }, { query: 'glucosamine' }],
  };
  const result = await withFetch(okJson(body), () => fetchSerpViaSerpApi('joint pain'));

  assert.equal(result.source, 'serpapi');
  assert.equal(result.ads_count, 3); // 2 ads + 1 shopping
  assert.equal(result.organic.length, 5); // sliced to 5
  assert.equal(result.organic[0].domain, 'a.com');
  assert.equal(result.organic[1].domain, 'b.org');
  assert.deepEqual(result.people_also_ask, ['does it work?', 'is it safe?']);
  assert.deepEqual(result.related_searches, ['best joint supplement', 'glucosamine']);
});

test('fetchSerpViaSerpApi tolerates a sparse response', async () => {
  const result = await withFetch(okJson({}), () => fetchSerpViaSerpApi('x'));
  assert.equal(result.ads_count, 0);
  assert.deepEqual(result.organic, []);
  assert.deepEqual(result.people_also_ask, []);
});

test('fetchSerpViaSerpApi throws on HTTP error and on API error body', async () => {
  await assert.rejects(
    withFetch(async () => ({ ok: false, status: 429, json: async () => ({}) }),
      () => fetchSerpViaSerpApi('x')),
    /SerpApi HTTP 429/
  );
  await assert.rejects(
    withFetch(okJson({ error: 'invalid api key' }), () => fetchSerpViaSerpApi('x')),
    /SerpApi error.*invalid api key/
  );
});
