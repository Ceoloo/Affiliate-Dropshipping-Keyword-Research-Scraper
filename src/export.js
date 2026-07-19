// export.js — write keyword-matrix.csv, keyword-matrix.json, and
// opportunity-report.md. Pure-ish: takes scored records, writes files, and
// returns the paths written.

import fs from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR } from './config.js';

const CSV_COLUMNS = [
  'keyword',
  'bucket',
  'source',
  'commercial_intent_score',
  'competition_score',
  'opportunity_score',
  'priority',
  'ads_count',
  'paa_count',
  'amazon_product_count',
  'amazon_avg_rating',
  'amazon_max_reviews',
  'top_domains',
  'suggested_angle',
  'merged_from',
];

function csvEscape(value) {
  if (value == null) return '';
  const str = Array.isArray(value) ? value.join(' | ') : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(records) {
  const header = CSV_COLUMNS.join(',');
  const rows = records.map((r) =>
    CSV_COLUMNS.map((col) => {
      if (col === 'bucket') return csvEscape(r.buckets ? r.buckets.join('|') : r.bucket);
      return csvEscape(r[col]);
    }).join(',')
  );
  return [header, ...rows].join('\n');
}

// Strip the heavy nested raw payloads for the flat JSON matrix but keep them
// available under `_raw` for anyone who wants them.
function slimRecord(r) {
  const { serp, amazon, ...flat } = r;
  return { ...flat, _raw: { serp, amazon } };
}

export function ensureOutputDir(dir = OUTPUT_DIR) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sortByOpportunity(records) {
  return [...records].sort(
    (a, b) => b.opportunity_score - a.opportunity_score
  );
}

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------

function bucketBreakdown(records) {
  const byBucket = {};
  for (const r of records) {
    const buckets = r.buckets || [r.bucket];
    for (const b of buckets) {
      byBucket[b] = byBucket[b] || {
        count: 0,
        intent: 0,
        competition: 0,
        opportunity: 0,
      };
      byBucket[b].count++;
      byBucket[b].intent += r.commercial_intent_score;
      byBucket[b].competition += r.competition_score;
      byBucket[b].opportunity += r.opportunity_score;
    }
  }
  const rows = Object.entries(byBucket).map(([bucket, s]) => ({
    bucket,
    count: s.count,
    avgIntent: round1(s.intent / s.count),
    avgCompetition: round1(s.competition / s.count),
    avgOpportunity: round1(s.opportunity / s.count),
  }));
  return rows.sort((a, b) => b.avgOpportunity - a.avgOpportunity);
}

function angleRecommendations(records) {
  // Tally which angles show up among priority (or, if none, top) keywords.
  const priority = records.filter((r) => r.priority);
  const pool = priority.length ? priority : records.slice(0, 10);
  const tally = {};
  for (const r of pool) {
    for (const angle of String(r.suggested_angle).split(';').map((s) => s.trim())) {
      if (!angle) continue;
      tally[angle] = tally[angle] || { count: 0, examples: [] };
      tally[angle].count++;
      if (tally[angle].examples.length < 3) tally[angle].examples.push(r.keyword);
    }
  }
  return Object.entries(tally)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([angle, info]) => ({ angle, ...info }));
}

const round1 = (n) => Math.round(n * 10) / 10;

export function toMarkdownReport(records, meta = {}) {
  const sorted = sortByOpportunity(records);
  const priority = sorted.filter((r) => r.priority);
  const top10 = sorted.slice(0, 10);
  const breakdown = bucketBreakdown(sorted);
  const recs = angleRecommendations(sorted);

  const lines = [];
  lines.push('# Joint-Health Supplement — Keyword Opportunity Report');
  lines.push('');
  lines.push(`_Generated: ${new Date().toISOString()}_`);
  lines.push('');
  lines.push(
    `**Keywords analyzed:** ${sorted.length}  |  ` +
      `**Priority (opportunity ≥ 7):** ${priority.length}  |  ` +
      `**Data source:** ${meta.mode || 'unknown'}`
  );
  lines.push('');

  // --- Top 10 priority keywords ---
  lines.push('## 🎯 Top 10 Priority Keywords');
  lines.push('');
  lines.push(
    '| # | Keyword | Bucket | Intent | Competition | Opportunity | Angle |'
  );
  lines.push('|---|---------|--------|:------:|:-----------:|:-----------:|-------|');
  top10.forEach((r, i) => {
    const bucket = (r.buckets || [r.bucket]).join(', ');
    lines.push(
      `| ${i + 1} | ${r.keyword} | ${bucket} | ${r.commercial_intent_score} | ` +
        `${r.competition_score} | **${r.opportunity_score}**${r.priority ? ' ⭐' : ''} | ${r.suggested_angle} |`
    );
  });
  lines.push('');

  // --- Breakdown by bucket ---
  lines.push('## 📊 Breakdown by Bucket');
  lines.push('');
  lines.push('| Bucket | Keywords | Avg Intent | Avg Competition | Avg Opportunity |');
  lines.push('|--------|:--------:|:----------:|:---------------:|:---------------:|');
  for (const b of breakdown) {
    lines.push(
      `| ${b.bucket} | ${b.count} | ${b.avgIntent} | ${b.avgCompetition} | ${b.avgOpportunity} |`
    );
  }
  lines.push('');

  // --- Recommendations ---
  lines.push('## 💡 Content & Product Angle Recommendations');
  lines.push('');
  if (recs.length === 0) {
    lines.push('_No angle signals were produced — check data source configuration._');
  } else {
    recs.forEach((rec, i) => {
      lines.push(
        `${i + 1}. **${titleCase(rec.angle)}** — signalled by ${rec.count} ` +
          `keyword${rec.count === 1 ? '' : 's'} ` +
          `(e.g. ${rec.examples.map((e) => `_${e}_`).join(', ')}).`
      );
    });
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(
    '### How to read the scores\n' +
      '- **Commercial intent (1–10):** buyer intent — ad density, "best/buy/top-rated" language, product listings.\n' +
      '- **Competition (1–10):** authority-domain saturation (Amazon, WebMD, Healthline…) + heavy Amazon review counts.\n' +
      '- **Opportunity (1–10):** `intent − competition×0.5`, normalized. **≥ 7 = priority ⭐**.'
  );
  lines.push('');

  return lines.join('\n');
}

function titleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function exportAll(records, meta = {}, dir = OUTPUT_DIR) {
  ensureOutputDir(dir);
  const sorted = sortByOpportunity(records);

  const csvPath = path.join(dir, 'keyword-matrix.csv');
  const jsonPath = path.join(dir, 'keyword-matrix.json');
  const reportPath = path.join(dir, 'opportunity-report.md');

  fs.writeFileSync(csvPath, toCsv(sorted), 'utf8');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        meta,
        count: sorted.length,
        keywords: sorted.map(slimRecord),
      },
      null,
      2
    ),
    'utf8'
  );
  fs.writeFileSync(reportPath, toMarkdownReport(sorted, meta), 'utf8');

  return { csvPath, jsonPath, reportPath };
}
