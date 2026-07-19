// fetch-amazon.js — Amazon product data for the "shopping" bucket.
//
// Primary path: SerpApi's Amazon engine (engine=amazon).
// Fallback path: a Playwright Amazon search scraper with slow randomized
//   delays and rotating user-agents. Best-effort; Amazon markup changes often
//   and may serve a CAPTCHA — in that case we log a warning and return empty
//   products rather than crashing the pipeline.
//
// Normalized shape returned by both paths:
//
//   {
//     keyword, source,
//     products: [{ title, price, rating, reviews, sponsored, amazons_choice }]
//   }

import { config } from './config.js';
import {
  log,
  jitterDelay,
  randomUserAgent,
  parseIntLoose,
  parseFloatLoose,
} from './util.js';

function normalizeAmazon(keyword, source, products) {
  return {
    keyword,
    source,
    products: (products || []).slice(0, 5).map((p) => ({
      title: p.title || '',
      price: p.price ?? null,
      rating: p.rating ?? null,
      reviews: p.reviews ?? null,
      sponsored: Boolean(p.sponsored),
      amazons_choice: Boolean(p.amazons_choice),
    })),
  };
}

// ---------------------------------------------------------------------------
// Primary: SerpApi Amazon engine
// ---------------------------------------------------------------------------

export async function fetchAmazonViaSerpApi(keyword) {
  const params = new URLSearchParams({
    engine: 'amazon',
    k: keyword,
    amazon_domain: 'amazon.com',
    api_key: config.serpApiKey,
  });
  const url = `https://serpapi.com/search.json?${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`SerpApi Amazon HTTP ${res.status} for "${keyword}"`);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(`SerpApi Amazon error for "${keyword}": ${data.error}`);
  }

  const results = data.organic_results || data.shopping_results || [];
  const products = results.map((r) => ({
    title: r.title,
    price:
      r.extracted_price ??
      parseFloatLoose(r.price && (r.price.raw || r.price)) ??
      null,
    rating: r.rating ?? parseFloatLoose(r.stars) ?? null,
    reviews: r.reviews ?? r.ratings_total ?? parseIntLoose(r.reviews_count) ?? null,
    sponsored: Boolean(r.sponsored),
    amazons_choice: Boolean(r.amazons_choice || r.badge === "Amazon's Choice"),
  }));

  return normalizeAmazon(keyword, 'serpapi', products);
}

// ---------------------------------------------------------------------------
// Fallback: Playwright Amazon scraper
// ---------------------------------------------------------------------------

let _browserPromise = null;
async function getBrowser() {
  if (!_browserPromise) {
    const { chromium } = await import('playwright');
    _browserPromise = chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
  }
  return _browserPromise;
}

export async function closeBrowser() {
  if (_browserPromise) {
    const browser = await _browserPromise;
    await browser.close();
    _browserPromise = null;
  }
}

export async function fetchAmazonViaPlaywright(keyword) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: randomUserAgent(),
    locale: 'en-US',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  try {
    // Extra slow, randomized delay before hitting Amazon.
    await jitterDelay(Math.max(config.requestDelayMs, 3000));

    const url = `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Detect CAPTCHA / robot wall.
    const title = (await page.title()).toLowerCase();
    const body = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
    if (
      title.includes('robot') ||
      body.includes('enter the characters you see below') ||
      body.includes('type the characters you see in this image')
    ) {
      log.warn(`Amazon served a CAPTCHA for "${keyword}" — skipping Amazon data`);
      return normalizeAmazon(keyword, 'playwright-blocked', []);
    }

    await page.waitForSelector('[data-component-type="s-search-result"]', {
      timeout: 15000,
    }).catch(() => {});

    const products = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
      const cards = Array.from(
        document.querySelectorAll('[data-component-type="s-search-result"]')
      );
      const out = [];
      for (const card of cards) {
        if (out.length >= 5) break;
        const titleEl = card.querySelector('h2 a span, h2 span');
        const title = clean(titleEl && titleEl.textContent);
        if (!title) continue;

        const priceWhole = card.querySelector('.a-price .a-offscreen');
        const priceText = clean(priceWhole && priceWhole.textContent);

        const ratingEl = card.querySelector('.a-icon-star-small .a-icon-alt, .a-icon-star .a-icon-alt');
        const ratingText = clean(ratingEl && ratingEl.textContent); // "4.5 out of 5 stars"

        const reviewsEl = card.querySelector(
          '[aria-label$="ratings"], [aria-label$="rating"], .s-link-style .s-underline-text, span.a-size-base.s-underline-text'
        );
        const reviewsText = clean(
          (reviewsEl && (reviewsEl.getAttribute('aria-label') || reviewsEl.textContent)) || ''
        );

        const badgeText = clean(card.textContent);
        const sponsored = /Sponsored/i.test(
          clean(card.querySelector('.puis-sponsored-label-text, .s-sponsored-label-text')?.textContent || '') ||
          (/^Sponsored/i.test(badgeText) ? 'Sponsored' : '')
        );
        const amazonsChoice = /Amazon's Choice/i.test(
          clean(card.querySelector('.a-badge-text, [aria-label*="Amazon\'s Choice"]')?.textContent || badgeText.slice(0, 200))
        );

        out.push({
          title,
          priceText,
          ratingText,
          reviewsText,
          sponsored,
          amazonsChoice,
        });
      }
      return out;
    });

    const mapped = products.map((p) => ({
      title: p.title,
      price: parseFloatLoose(p.priceText),
      rating: parseFloatLoose(p.ratingText),
      reviews: parseIntLoose(p.reviewsText),
      sponsored: p.sponsored,
      amazons_choice: p.amazonsChoice,
    }));

    return normalizeAmazon(keyword, 'playwright', mapped);
  } finally {
    await page.close();
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function fetchAmazon(keyword, { useSerpApi }) {
  if (useSerpApi) {
    try {
      return await fetchAmazonViaSerpApi(keyword);
    } catch (err) {
      // Amazon engine may not be enabled on the SerpApi plan — degrade to
      // the scraper rather than failing the whole run.
      log.warn(`${err.message} — falling back to Playwright Amazon scraper`);
      return fetchAmazonViaPlaywright(keyword);
    }
  }
  return fetchAmazonViaPlaywright(keyword);
}
