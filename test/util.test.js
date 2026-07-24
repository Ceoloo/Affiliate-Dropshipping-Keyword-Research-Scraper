// Unit tests for util helpers. Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseIntLoose,
  parseFloatLoose,
  randomUserAgent,
  USER_AGENTS,
  sleep,
  jitterDelay,
} from '../src/util.js';

test('parseIntLoose extracts digits from noisy strings', () => {
  assert.equal(parseIntLoose('1,234 reviews'), 1234);
  assert.equal(parseIntLoose('(12,000)'), 12000);
  assert.equal(parseIntLoose('no digits'), null);
  assert.equal(parseIntLoose(null), null);
});

test('parseFloatLoose handles prices, ratings, and commas', () => {
  assert.equal(parseFloatLoose('$29.99'), 29.99);
  assert.equal(parseFloatLoose('4.5 out of 5 stars'), 4.5);
  assert.equal(parseFloatLoose('1.234,56'), 1.234); // first numeric token
  assert.equal(parseFloatLoose('n/a'), null);
  assert.equal(parseFloatLoose(null), null);
});

test('randomUserAgent returns one of the known pool', () => {
  for (let i = 0; i < 20; i++) {
    assert.ok(USER_AGENTS.includes(randomUserAgent()));
  }
});

test('sleep resolves after roughly the requested delay', async () => {
  const t0 = Date.now();
  await sleep(30);
  assert.ok(Date.now() - t0 >= 25);
});

test('jitterDelay never blocks for less than 250ms', async () => {
  const t0 = Date.now();
  await jitterDelay(0);
  assert.ok(Date.now() - t0 >= 240);
});
