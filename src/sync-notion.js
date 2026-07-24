// sync-notion.js — optional push of the keyword matrix to a Notion database.
//
// Enabled only via the --sync-notion flag AND when NOTION_API_KEY +
// NOTION_DATABASE_ID are set. Uses the public Notion REST API directly (no SDK
// dependency). Each keyword becomes one page in the target database.
//
// Recommended database properties (the code no-ops on any that are missing):
//   Keyword (title), Bucket (rich_text), Opportunity (number),
//   Intent (number), Competition (number), Priority (checkbox),
//   Source (rich_text), Angle (rich_text)

import { config } from './config.js';
import { log, sleep } from './util.js';

const NOTION_VERSION = '2022-06-28';

export function pageProperties(r) {
  const buckets = (r.buckets || [r.bucket]).join(', ');
  return {
    Keyword: { title: [{ text: { content: String(r.keyword).slice(0, 2000) } }] },
    Bucket: { rich_text: [{ text: { content: buckets } }] },
    Opportunity: { number: r.opportunity_score },
    Intent: { number: r.commercial_intent_score },
    Competition: { number: r.competition_score },
    Priority: { checkbox: Boolean(r.priority) },
    Source: { rich_text: [{ text: { content: String(r.source || '') } }] },
    Angle: { rich_text: [{ text: { content: String(r.suggested_angle || '').slice(0, 2000) } }] },
  };
}

async function createPage(record) {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.notionApiKey}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: config.notionDatabaseId },
      properties: pageProperties(record),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

export async function syncToNotion(records) {
  log.step(`Syncing ${records.length} keywords to Notion…`);
  let ok = 0;
  let failed = 0;
  for (const r of records) {
    try {
      await createPage(r);
      ok++;
      if (ok % 10 === 0) log.info(`  …${ok}/${records.length} pushed`);
      // Respect Notion's ~3 req/s rate limit.
      await sleep(350);
    } catch (err) {
      failed++;
      log.warn(`  Notion push failed for "${r.keyword}": ${err.message}`);
      // Back off a little on failure in case we hit a rate limit.
      await sleep(1000);
    }
  }
  log.ok(`Notion sync complete — ${ok} created, ${failed} failed`);
  return { ok, failed };
}
