// util.js — small shared helpers (logging, sleep, jittered delays, UAs).

const LEVELS = {
  info: '\x1b[36m',   // cyan
  ok: '\x1b[32m',     // green
  warn: '\x1b[33m',   // yellow
  err: '\x1b[31m',    // red
  dim: '\x1b[90m',    // gray
};
const RESET = '\x1b[0m';

function stamp() {
  return new Date().toISOString().slice(11, 19);
}

export const log = {
  info: (msg) => console.log(`${LEVELS.dim}[${stamp()}]${RESET} ${LEVELS.info}›${RESET} ${msg}`),
  ok: (msg) => console.log(`${LEVELS.dim}[${stamp()}]${RESET} ${LEVELS.ok}✓${RESET} ${msg}`),
  warn: (msg) => console.log(`${LEVELS.dim}[${stamp()}]${RESET} ${LEVELS.warn}!${RESET} ${msg}`),
  err: (msg) => console.log(`${LEVELS.dim}[${stamp()}]${RESET} ${LEVELS.err}✗${RESET} ${msg}`),
  step: (msg) => console.log(`\n${LEVELS.info}━━${RESET} ${msg}`),
};

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sleep for base ± up to 40% random jitter. Used to look less robotic when
// scraping. Never blocks for less than 250ms.
export async function jitterDelay(baseMs) {
  const base = Math.max(0, Number(baseMs) || 0);
  const jitter = base * (0.6 + Math.random() * 0.8); // 60%–140% of base
  await sleep(Math.max(250, Math.round(jitter)));
}

// A small pool of realistic desktop user-agents to rotate through when
// falling back to raw Playwright scraping.
export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

export function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Parse "1,234 reviews" / "$29.99" style strings into numbers.
export function parseIntLoose(str) {
  if (str == null) return null;
  const digits = String(str).replace(/[^0-9]/g, '');
  return digits ? Number.parseInt(digits, 10) : null;
}

export function parseFloatLoose(str) {
  if (str == null) return null;
  const match = String(str).match(/[0-9]+(?:[.,][0-9]+)?/);
  return match ? Number.parseFloat(match[0].replace(',', '.')) : null;
}
