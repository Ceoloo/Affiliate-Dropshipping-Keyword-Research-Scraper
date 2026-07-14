// config.js — centralized environment + runtime configuration.
// Loads .env once and exposes typed helpers so the rest of the code never
// touches process.env directly.

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const OUTPUT_DIR = path.join(ROOT_DIR, 'output');
export const KEYWORDS_FILE = path.join(ROOT_DIR, 'keywords.json');

export const config = {
  serpApiKey: (process.env.SERPAPI_KEY || '').trim(),
  location: (process.env.SERP_LOCATION || 'United States').trim(),
  gl: (process.env.SERP_GL || 'us').trim(),
  hl: (process.env.SERP_HL || 'en').trim(),
  requestDelayMs: Number.parseInt(process.env.REQUEST_DELAY_MS || '2500', 10),
  notionApiKey: (process.env.NOTION_API_KEY || '').trim(),
  notionDatabaseId: (process.env.NOTION_DATABASE_ID || '').trim(),
};

export function hasSerpApi() {
  return config.serpApiKey.length > 0;
}

export function hasNotion() {
  return config.notionApiKey.length > 0 && config.notionDatabaseId.length > 0;
}

// Load and validate keywords.json. Returns { long_tail, problem_based, shopping }.
export function loadKeywords(file = KEYWORDS_FILE) {
  if (!fs.existsSync(file)) {
    throw new Error(`keywords.json not found at ${file}`);
  }
  const raw = fs.readFileSync(file, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`keywords.json is not valid JSON: ${err.message}`);
  }
  const buckets = ['long_tail', 'problem_based', 'shopping'];
  for (const bucket of buckets) {
    if (!Array.isArray(parsed[bucket])) {
      throw new Error(`keywords.json is missing the "${bucket}" array`);
    }
  }
  return parsed;
}

// Flatten buckets into a list of { keyword, bucket } records.
export function flattenKeywords(buckets) {
  const records = [];
  for (const [bucket, list] of Object.entries(buckets)) {
    if (!Array.isArray(list)) continue;
    for (const keyword of list) {
      if (typeof keyword === 'string' && keyword.trim()) {
        records.push({ keyword: keyword.trim(), bucket });
      }
    }
  }
  return records;
}
