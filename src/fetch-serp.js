// fetch-serp.js — Google SERP data acquisition.
//
// Primary path: SerpApi (https://serpapi.com/search) — reliable, structured,
//   and ToS-friendly. Returns ads count, People Also Ask, related searches,
//   and organic results.
// Fallback path: a Playwright-driven Google search scraper used only when no
//   SERPAPI_KEY is present. It is best-effort, uses randomized delays and
//   rotating user-agents, and clearly logs that it is running in FALLBACK mode.
//
// Both paths return the SAME normalized shape so downstream scoring never has
// to care where the data came from:
//
//   {
//     keyword, source, ads_count, organic: [{ title, link, domain }],
//     people_also_ask: [string], related_searches: [string]
//   }

import { config } from './config.js';
import { log, jitterDelay, randomUserAgent } from './util.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function domainOf(url) {
  if (!url) return '';
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    // Fall back to a loose regex if URL parsing fails.
    const m = String(url).match(/^(?:https?:\/\/)?(?:www\.)?([^/]+)/i);
    return m ? m[1].toLowerCase() : '';
  }
}

function normalizeSerp(keyword, source, partial) {
  return {
    keyword,
    source,
    ads_count: partial.ads_count || 0,
    organic: (partial.organic || []).slice(0, 5).map((o) => ({
      title: o.title || '',
      link: o.link || '',
      domain: o.domain || domainOf(o.link),
    })),
    people_also_ask: partial.people_also_ask || [],
    related_searches: partial.related_searches || [],
  };
}

// ---------------------------------------------------------------------------
// Primary: SerpApi
// ---------------------------------------------------------------------------

export async function fetchSerpViaSerpApi(keyword) {
  const params = new URLSearchParams({
    engine: 'google',
    q: keyword,
    location: config.location,
    gl: config.gl,
    hl: config.hl,
    num: '10',
    api_key: config.serpApiKey,
  });
  const url = `https://serpapi.com/search.json?${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`SerpApi HTTP ${res.status} for "${keyword}"`);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(`SerpApi error for "${keyword}": ${data.error}`);
  }

  // Ads can appear in `ads` (top/bottom) and `shopping_results`.
  const ads = Array.isArray(data.ads) ? data.ads.length : 0;
  const shoppingAds = Array.isArray(data.shopping_results)
    ? data.shopping_results.length
    : 0;

  const organic = (data.organic_results || []).map((r) => ({
    title: r.title,
    link: r.link,
    domain: domainOf(r.link),
  }));

  // People Also Ask questions.
  const paa = (data.related_questions || data.people_also_ask || [])
    .map((q) => q.question || q.title || q)
    .filter(Boolean);

  const related = (data.related_searches || [])
    .map((r) => r.query || r)
    .filter(Boolean);

  return normalizeSerp(keyword, 'serpapi', {
    ads_count: ads + shoppingAds,
    organic,
    people_also_ask: paa,
    related_searches: related,
  });
}

// ---------------------------------------------------------------------------
// Fallback: Playwright Google scraper
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

export async function fetchSerpViaPlaywright(keyword) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: randomUserAgent(),
    locale: `${config.hl}-${config.gl.toUpperCase()}`,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  try {
    const url = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&gl=${config.gl}&hl=${config.hl}&num=10`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Best-effort consent dismissal (EU interstitials).
    try {
      const consent = page.locator('button:has-text("Accept all"), button:has-text("I agree")');
      if (await consent.first().isVisible({ timeout: 2000 })) {
        await consent.first().click();
        await jitterDelay(800);
      }
    } catch { /* no consent dialog */ }

    const scraped = await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

      // Ads: Google marks paid results with a "Sponsored"/"Ad" label.
      const adNodes = Array.from(
        document.querySelectorAll('[data-text-ad], .uEierd, div[aria-label="Ads"] > div')
      );
      let adsCount = adNodes.length;
      if (adsCount === 0) {
        // Fallback heuristic: count "Sponsored" labels near result blocks.
        adsCount = Array.from(document.querySelectorAll('span, div'))
          .filter((el) => /^Sponsored$/i.test(el.textContent.trim())).length;
      }

      // Organic results: anchor blocks containing an h3.
      const organic = [];
      const seen = new Set();
      document.querySelectorAll('a h3').forEach((h3) => {
        const a = h3.closest('a');
        if (!a || !a.href) return;
        if (/google\.com|googleusercontent|webcache/.test(a.href)) return;
        if (seen.has(a.href)) return;
        seen.add(a.href);
        organic.push({ title: clean(h3.textContent), link: a.href });
      });

      // People Also Ask.
      const paa = [];
      document
        .querySelectorAll('[jsname] [role="heading"], div[data-q]')
        .forEach((el) => {
          const q = el.getAttribute('data-q') || clean(el.textContent);
          if (q && q.endsWith('?')) paa.push(q);
        });

      // Related searches.
      const related = [];
      document.querySelectorAll('a').forEach((a) => {
        if (/\/search\?/.test(a.getAttribute('href') || '')) {
          const t = clean(a.textContent);
          if (t && t.length > 3 && t.split(' ').length <= 8) related.push(t);
        }
      });

      return { adsCount, organic, paa: [...new Set(paa)], related: [...new Set(related)] };
    });

    return normalizeSerp(keyword, 'playwright', {
      ads_count: scraped.adsCount,
      organic: scraped.organic,
      people_also_ask: scraped.paa.slice(0, 8),
      related_searches: scraped.related.slice(0, 10),
    });
  } finally {
    await page.close();
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Public entry point — chooses source and applies throttling.
// ---------------------------------------------------------------------------

export async function fetchSerp(keyword, { useSerpApi }) {
  await jitterDelay(config.requestDelayMs);
  if (useSerpApi) {
    return fetchSerpViaSerpApi(keyword);
  }
  return fetchSerpViaPlaywright(keyword);
}
