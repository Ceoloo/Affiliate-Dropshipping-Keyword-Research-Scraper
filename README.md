# supplement-keyword-scout

[![CI](https://github.com/Ceoloo/Affiliate-Dropshipping-Keyword-Research-Scraper/actions/workflows/ci.yml/badge.svg)](https://github.com/Ceoloo/Affiliate-Dropshipping-Keyword-Research-Scraper/actions/workflows/ci.yml)

A Node.js + Playwright keyword-research tool for a **joint-health supplement
affiliate / dropship offer**. It pulls Google SERP signals (and Amazon product
data for shopping-intent keywords), scores each keyword for **commercial
intent**, **competition**, and **opportunity**, deduplicates near-identical
phrases, and exports a prioritized keyword matrix plus a written opportunity
report.

- **Primary data source:** [SerpApi](https://serpapi.com/) — structured,
  reliable, ToS-friendly.
- **Documented fallback:** a Playwright scraper for Google + Amazon, used
  automatically when no `SERPAPI_KEY` is present. It uses slow randomized
  delays and rotating user-agents, and clearly logs that it is running in
  **FALLBACK** mode.

---

## What it produces

All artifacts land in `output/`:

| File | Contents |
|------|----------|
| `keyword-matrix.csv` | Flat table of every keyword + scores, sorted by opportunity ↓ |
| `keyword-matrix.json` | Same data as structured JSON (with raw SERP/Amazon payloads under `_raw`) |
| `opportunity-report.md` | Top-10 priority keywords, per-bucket score breakdown, and 3–5 content/product angle recommendations |

Optionally, `--sync-notion` pushes the matrix to a Notion database.

---

## Setup

Requires **Node.js ≥ 18**.

```bash
# 1. Install dependencies
npm install

# 2. Install the Playwright Chromium browser (only needed for fallback scraping)
npx playwright install chromium

# 3. Configure API keys
cp .env.example .env
#   then edit .env and add your SERPAPI_KEY (recommended)
```

### Environment variables (`.env`)

| Key | Required? | Purpose |
|-----|-----------|---------|
| `SERPAPI_KEY` | Recommended | Enables SerpApi (Google + Amazon). Without it, the tool falls back to Playwright scraping. |
| `SERP_LOCATION` | Optional | Google geo location (default `United States`). |
| `SERP_GL` / `SERP_HL` | Optional | Google country / language (default `us` / `en`). |
| `REQUEST_DELAY_MS` | Optional | Base throttle between requests in ms (default `2500`); random jitter is added. |
| `NOTION_API_KEY` | Optional | Needed for `--sync-notion`. |
| `NOTION_DATABASE_ID` | Optional | Needed for `--sync-notion`. |

---

## Running

```bash
# Full run (uses SerpApi if SERPAPI_KEY is set, otherwise Playwright fallback)
npm run scout
# or
node src/main.js

# Test quickly against just the first few keywords
node src/main.js --limit 5

# Full run, then push the matrix to Notion
node src/main.js --sync-notion

# Help
node src/main.js --help
```

You'll see live progress logging per keyword, then a final summary listing the
top priority keywords.

---

## How the scoring works

All scoring lives in `src/score.js` as **pure, unit-tested functions**.

- **`commercial_intent_score` (1–10)** — weights **ad count heavily** (more ads
  = more buyer intent), presence of buy/best/top-rated language in organic
  results and related searches, and — for the shopping bucket especially —
  the presence of real product listings.
- **`competition_score` (1–10)** — higher when the top domains include major
  brands/retailers (Amazon, WebMD, Healthline, Vitamin Shoppe, GNC, Mayo
  Clinic, NIH, …) or when Amazon results show **1000+ reviews** across
  multiple products.
- **`opportunity_score` (1–10)** — `commercial_intent − (competition × 0.5)`,
  linearly normalized into the 1–10 range. **Keywords scoring ≥ 7 are flagged
  `priority` ⭐.**
- **`suggested_angle`** — a rule-based strategy tag, e.g.:
  - PAA-heavy + low competition → *long-form content/blog angle*
  - High ad count + shopping bucket → *paid + comparison landing page angle*
  - High Amazon review counts → *Amazon listing/PDP optimization angle*
  - Problem-based + low competition → *symptom-solution educational content angle*

---

## Pipeline (what `main.js` does)

1. Load keywords from `keywords.json` (3 buckets: `long_tail`, `problem_based`,
   `shopping`).
2. Query the SERP source for every keyword. For **shopping** keywords, also
   query Amazon (product titles, price, star rating, review count,
   Sponsored / Amazon's Choice tags).
3. Compute the three scores + suggested angle per keyword.
4. Deduplicate near-identical keywords (fuzzy match on a normalized string,
   ~90% threshold) and merge their data — unioning buckets and keeping the
   strongest signals.
5. Export `keyword-matrix.csv` and `keyword-matrix.json`, sorted by
   `opportunity_score` descending.
6. Generate `opportunity-report.md` (top-10 priority, per-bucket averages,
   angle recommendations).
7. If `--sync-notion` is passed and Notion keys are set, push the matrix to
   the Notion database.

---

## Adding / editing keywords

Just edit **`keywords.json`**. It has three arrays — add, remove, or reword
strings in any of them:

```json
{
  "long_tail":    ["best joint supplement for seniors over 60", "..."],
  "problem_based":["knee pain relief", "..."],
  "shopping":     ["best rated joint supplements", "..."]
}
```

- Only keywords in the **`shopping`** bucket trigger the extra Amazon lookup.
- Near-duplicate entries are automatically merged, so you don't need to worry
  about small variants (e.g. singular vs plural).

---

## Data-source modes

| Situation | Behavior |
|-----------|----------|
| `SERPAPI_KEY` set | Google via SerpApi's `google` engine; Amazon via SerpApi's `amazon` engine. If the Amazon engine isn't enabled on your plan, it degrades to the Playwright Amazon scraper automatically. |
| No `SERPAPI_KEY` | **FALLBACK mode** (logged clearly). Google + Amazon scraped via Playwright with randomized delays and rotating user-agents. |

> **Fallback caveats.** Raw scraping is best-effort. Google/Amazon markup
> changes frequently and may serve consent walls or CAPTCHAs. When Amazon
> presents a CAPTCHA the tool logs a warning and returns empty product data for
> that keyword rather than crashing the run. For production use, **SerpApi is
> strongly recommended.** Only scrape within the target sites' Terms of Service
> and applicable law.

---

## Notion sync (optional)

With `--sync-notion` and `NOTION_API_KEY` + `NOTION_DATABASE_ID` set, each
keyword becomes a page in your database. Create an internal integration at
<https://www.notion.so/my-integrations>, share your database with it, and grab
the database ID from its URL.

Recommended database properties (missing ones are simply skipped):

| Property | Type |
|----------|------|
| `Keyword` | Title |
| `Bucket` | Text |
| `Opportunity` | Number |
| `Intent` | Number |
| `Competition` | Number |
| `Priority` | Checkbox |
| `Source` | Text |
| `Angle` | Text |

---

## Project structure

```
supplement-keyword-scout/
├── keywords.json          # editable keyword buckets (the config)
├── .env.example           # copy to .env and add keys
├── package.json
├── src/
│   ├── main.js            # pipeline orchestrator + CLI
│   ├── config.js          # env + keyword loading
│   ├── util.js            # logging, delays, user-agents, parsers
│   ├── fetch-serp.js      # Google SERP (SerpApi + Playwright fallback)
│   ├── fetch-amazon.js    # Amazon products (SerpApi + Playwright fallback)
│   ├── score.js           # pure scoring functions (intent/competition/opportunity/angle)
│   ├── dedupe.js          # fuzzy near-duplicate merging
│   ├── export.js          # CSV / JSON / Markdown report writers
│   └── sync-notion.js     # optional Notion push
├── test/
│   ├── score.test.js      # unit tests for scoring
│   └── dedupe.test.js     # unit tests for dedupe
└── output/                # generated (gitignored)
```

---

## Tests

Scoring and dedupe logic are covered by unit tests (Node's built-in test
runner, no extra dependencies):

```bash
npm test
```

---

## License

MIT