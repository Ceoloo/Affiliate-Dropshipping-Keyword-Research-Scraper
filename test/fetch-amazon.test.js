// Unit tests for Amazon product acquisition + parsing (SerpApi path, stubbed
// fetch). The Playwright fallback needs a real browser and is not tested here.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchAmazonViaSerpApi } from '../src/fetch-amazon.js';

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

test('fetchAmazonViaSerpApi normalizes products and coerces flags', async () => {
  const body = {
    organic_results: [
      {
        title: 'Glucosamine 1500mg',
        extracted_price: 24.99,
        rating: 4.6,
        ratings_total: 12000,
        sponsored: true,
        amazons_choice: true,
      },
      {
        title: 'Turmeric Joint',
        price: { raw: '$19.95' },
        stars: '4.3',
        reviews_count: '3,410',
        badge: "Amazon's Choice",
      },
    ],
  };
  const result = await withFetch(okJson(body), () => fetchAmazonViaSerpApi('joint supplement'));

  assert.equal(result.source, 'serpapi');
  assert.equal(result.products.length, 2);

  const [p1, p2] = result.products;
  assert.equal(p1.price, 24.99);
  assert.equal(p1.rating, 4.6);
  assert.equal(p1.reviews, 12000);
  assert.equal(p1.sponsored, true);
  assert.equal(p1.amazons_choice, true);

  // Second product exercises the loose parsers + badge-based Choice detection.
  assert.equal(p2.price, 19.95);
  assert.equal(p2.rating, 4.3);
  assert.equal(p2.reviews, 3410);
  assert.equal(p2.sponsored, false);
  assert.equal(p2.amazons_choice, true);
});

test('fetchAmazonViaSerpApi caps products at 5', async () => {
  const body = { organic_results: Array.from({ length: 8 }, (_, i) => ({ title: `p${i}` })) };
  const result = await withFetch(okJson(body), () => fetchAmazonViaSerpApi('x'));
  assert.equal(result.products.length, 5);
});

test('fetchAmazonViaSerpApi throws on HTTP + API errors', async () => {
  await assert.rejects(
    withFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }),
      () => fetchAmazonViaSerpApi('x')),
    /SerpApi Amazon HTTP 500/
  );
  await assert.rejects(
    withFetch(okJson({ error: 'amazon engine not enabled' }), () => fetchAmazonViaSerpApi('x')),
    /SerpApi Amazon error.*not enabled/
  );
});
