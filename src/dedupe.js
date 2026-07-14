// dedupe.js — fuzzy near-duplicate keyword merging.
//
// Pure functions. Normalizes keyword strings and merges records whose
// similarity crosses a threshold (default ~0.90). Similarity uses a
// token-aware blend of Levenshtein ratio and Jaccard token overlap so that
// "best joint supplement" vs "best joint supplements" collapse, but distinct
// intents stay separate.

// Normalize: lowercase, strip punctuation, collapse whitespace, and
// singularize trailing plural "s" on each token to catch supplement/supplements.
export function normalizeKeyword(kw) {
  return String(kw)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t))
    .join(' ');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, prevDiag + cost);
      prevDiag = tmp;
    }
  }
  return prev[b.length];
}

export function levenshteinRatio(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export function jaccardTokens(a, b) {
  const setA = new Set(a.split(' ').filter(Boolean));
  const setB = new Set(b.split(' ').filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Blended similarity in [0,1].
export function similarity(aRaw, bRaw) {
  const a = normalizeKeyword(aRaw);
  const b = normalizeKeyword(bRaw);
  if (a === b) return 1;
  const lev = levenshteinRatio(a, b);
  const jac = jaccardTokens(a, b);
  return 0.5 * lev + 0.5 * jac;
}

// Merge two scored records into one, keeping the richer/higher-scoring data.
function mergeRecords(primary, secondary) {
  // Keep whichever has the higher opportunity score as the base.
  const [keep, drop] =
    primary.opportunity_score >= secondary.opportunity_score
      ? [primary, secondary]
      : [secondary, primary];

  const merged = { ...keep };
  merged.merged_from = [
    ...(keep.merged_from || []),
    ...(drop.merged_from || []),
    drop.keyword,
  ];
  // Union the buckets so a merged keyword records every bucket it appeared in.
  const buckets = new Set([
    ...(Array.isArray(keep.buckets) ? keep.buckets : [keep.bucket]),
    ...(Array.isArray(drop.buckets) ? drop.buckets : [drop.bucket]),
  ]);
  merged.buckets = [...buckets];
  // Prefer the higher signal counts across the pair.
  merged.ads_count = Math.max(keep.ads_count || 0, drop.ads_count || 0);
  merged.paa_count = Math.max(keep.paa_count || 0, drop.paa_count || 0);
  merged.amazon_max_reviews = Math.max(
    keep.amazon_max_reviews || 0,
    drop.amazon_max_reviews || 0
  );
  return merged;
}

// Deduplicate a list of scored records. Returns { records, mergedCount }.
export function dedupeKeywords(records, threshold = 0.9) {
  const result = [];
  let mergedCount = 0;

  for (const rec of records) {
    let mergedInto = null;
    for (const existing of result) {
      if (similarity(rec.keyword, existing.keyword) >= threshold) {
        mergedInto = existing;
        break;
      }
    }
    if (mergedInto) {
      const merged = mergeRecords(mergedInto, rec);
      const idx = result.indexOf(mergedInto);
      result[idx] = merged;
      mergedCount++;
    } else {
      result.push({
        ...rec,
        buckets: [rec.bucket],
        merged_from: [],
      });
    }
  }

  return { records: result, mergedCount };
}
