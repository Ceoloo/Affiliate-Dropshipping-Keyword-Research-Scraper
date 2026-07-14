// Unit tests for the pure scoring functions. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commercialIntentScore,
  competitionScore,
  opportunityScore,
  isPriority,
  suggestedAngle,
  scoreKeyword,
} from '../src/score.js';

const emptySerp = { source: 'test', ads_count: 0, organic: [], people_also_ask: [], related_searches: [] };

test('commercialIntentScore is clamped to 1..10', () => {
  const low = commercialIntentScore({ serp: emptySerp, amazon: null, bucket: 'long_tail' });
  assert.ok(low >= 1 && low <= 10);
  assert.equal(low, 1); // nothing present -> floor
});

test('commercialIntentScore rises with ads and buy-intent language', () => {
  const serp = {
    ...emptySerp,
    ads_count: 5,
    organic: [{ title: 'Best joint supplement to buy', link: '', domain: 'x.com' }],
    related_searches: ['best rated', 'top rated joint pills'],
  };
  const score = commercialIntentScore({ serp, amazon: { products: [{}, {}] }, bucket: 'shopping' });
  assert.ok(score > 5, `expected high intent, got ${score}`);
  assert.ok(score <= 10);
});

test('competitionScore rises with big domains and heavy reviews', () => {
  const serp = {
    ...emptySerp,
    organic: [
      { title: 'a', link: '', domain: 'amazon.com' },
      { title: 'b', link: '', domain: 'healthline.com' },
      { title: 'c', link: '', domain: 'webmd.com' },
    ],
  };
  const amazon = { products: [{ reviews: 5000 }, { reviews: 2000 }] };
  const high = competitionScore({ serp, amazon });
  const low = competitionScore({ serp: emptySerp, amazon: null });
  assert.ok(high > low);
  assert.equal(low, 1);
  assert.ok(high <= 10);
});

test('competitionScore matches subdomains of big domains', () => {
  const serp = { ...emptySerp, organic: [{ title: 'a', link: '', domain: 'health.webmd.com' }] };
  assert.ok(competitionScore({ serp, amazon: null }) > 1);
});

test('opportunityScore is intent - competition*0.5, normalized to 1..10', () => {
  // Higher intent, lower competition => higher opportunity.
  const good = opportunityScore(9, 2);
  const bad = opportunityScore(3, 9);
  assert.ok(good > bad);
  assert.ok(good >= 1 && good <= 10);
  assert.ok(bad >= 1 && bad <= 10);
});

test('opportunityScore is monotonic in both inputs', () => {
  assert.ok(opportunityScore(8, 2) > opportunityScore(6, 2)); // intent up
  assert.ok(opportunityScore(6, 2) > opportunityScore(6, 8)); // competition up
});

test('isPriority triggers at >= 7', () => {
  assert.equal(isPriority(7), true);
  assert.equal(isPriority(6.9), false);
  assert.equal(isPriority(10), true);
});

test('suggestedAngle: PAA-heavy + low competition => blog angle', () => {
  const serp = { ...emptySerp, people_also_ask: ['q1?', 'q2?', 'q3?', 'q4?'] };
  const angle = suggestedAngle({ serp, amazon: null, bucket: 'long_tail', intent: 5, competition: 3 });
  assert.match(angle, /long-form content\/blog angle/);
});

test('suggestedAngle: high ads + shopping => paid comparison angle', () => {
  const serp = { ...emptySerp, ads_count: 4 };
  const angle = suggestedAngle({ serp, amazon: null, bucket: 'shopping', intent: 8, competition: 6 });
  assert.match(angle, /paid \+ comparison landing page angle/);
});

test('suggestedAngle: heavy Amazon reviews => PDP optimization angle', () => {
  const amazon = { products: [{ reviews: 3000 }, { reviews: 1500 }] };
  const angle = suggestedAngle({ serp: emptySerp, amazon, bucket: 'shopping', intent: 7, competition: 8 });
  assert.match(angle, /Amazon listing\/PDP optimization angle/);
});

test('suggestedAngle always returns a non-empty tag', () => {
  const angle = suggestedAngle({ serp: emptySerp, amazon: null, bucket: 'long_tail', intent: 1, competition: 1 });
  assert.ok(typeof angle === 'string' && angle.length > 0);
});

test('scoreKeyword produces a complete enriched record', () => {
  const serp = {
    source: 'test',
    ads_count: 3,
    organic: [{ title: 'Best knee supplement', link: 'https://amazon.com/x', domain: 'amazon.com' }],
    people_also_ask: ['does it work?'],
    related_searches: ['best rated'],
  };
  const amazon = { source: 'test', products: [{ rating: 4.5, reviews: 1200 }] };
  const rec = scoreKeyword({ keyword: 'best knee supplement', bucket: 'shopping', serp, amazon });
  assert.equal(rec.keyword, 'best knee supplement');
  assert.equal(rec.bucket, 'shopping');
  assert.ok(rec.commercial_intent_score >= 1 && rec.commercial_intent_score <= 10);
  assert.ok(rec.competition_score >= 1 && rec.competition_score <= 10);
  assert.ok(rec.opportunity_score >= 1 && rec.opportunity_score <= 10);
  assert.equal(typeof rec.priority, 'boolean');
  assert.ok(rec.suggested_angle.length > 0);
  assert.equal(rec.amazon_max_reviews, 1200);
  assert.equal(rec.amazon_avg_rating, 4.5);
});
