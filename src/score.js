// score.js — pure, unit-testable scoring functions.
//
// Every export here is deterministic and side-effect free. They take plain
// data objects (the normalized SERP/Amazon shapes) and return numbers/strings.
// This is where the "opportunity" opinion of the tool lives.

// Domains that signal a crowded, authority-heavy SERP for the supplement niche.
export const BIG_DOMAINS = [
  'amazon.com',
  'walmart.com',
  'webmd.com',
  'healthline.com',
  'mayoclinic.org',
  'clevelandclinic.org',
  'vitaminshoppe.com',
  'gnc.com',
  'iherb.com',
  'nih.gov',
  'harvard.edu',
  'arthritis.org',
  'medicalnewstoday.com',
  'verywellhealth.com',
  'consumerlab.com',
];

const BUY_INTENT_WORDS = [
  'buy', 'best', 'top rated', 'top-rated', 'best rated', 'review', 'reviews',
  'price', 'deal', 'shop', 'discount', 'sale', 'cheap', 'coupon', 'order',
  'best seller', 'bestseller',
];

const clampScore = (n) => Math.max(1, Math.min(10, n));
export const round1 = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// commercial_intent_score (1-10)
// ---------------------------------------------------------------------------
// Weighs ad_count heavily (buyer intent), buy-style language in organic
// titles, and — for shopping keywords — the presence of real product listings.
export function commercialIntentScore({ serp, amazon, bucket }) {
  const ads = serp?.ads_count || 0;

  // Ads are the strongest signal. 0 ads -> 0pts, saturates around 6 ads.
  const adPoints = Math.min(5, ads * 0.9); // 0..5

  // Buy-intent language across organic titles + related searches + PAA.
  const haystack = [
    ...(serp?.organic || []).map((o) => o.title),
    ...(serp?.related_searches || []),
    ...(serp?.people_also_ask || []),
  ]
    .join(' ')
    .toLowerCase();
  const intentHits = BUY_INTENT_WORDS.reduce(
    (n, w) => (haystack.includes(w) ? n + 1 : n),
    0
  );
  const intentPoints = Math.min(3, intentHits * 0.6); // 0..3

  // Product listings present (shopping bucket especially).
  const productCount = amazon?.products?.length || 0;
  let productPoints = Math.min(2, productCount * 0.4); // 0..2
  if (bucket === 'shopping') productPoints = Math.min(2, productPoints + 0.5);

  return clampScore(1 + adPoints + intentPoints + productPoints);
}

// ---------------------------------------------------------------------------
// competition_score (1-10)
// ---------------------------------------------------------------------------
// Higher when the top domains are major brands/retailers, or when Amazon
// products carry heavy review counts (1000+) across multiple listings.
export function competitionScore({ serp, amazon }) {
  const domains = (serp?.organic || []).map((o) => (o.domain || '').toLowerCase());
  const bigHits = domains.filter((d) =>
    BIG_DOMAINS.some((big) => d === big || d.endsWith(`.${big}`))
  ).length;

  // Each authority domain in the top 5 adds weight; saturates around 5.
  const domainPoints = Math.min(6, bigHits * 1.6); // 0..6

  // Amazon: count products with 1000+ reviews.
  const heavy = (amazon?.products || []).filter(
    (p) => (p.reviews || 0) >= 1000
  ).length;
  const reviewPoints = Math.min(3, heavy * 1.2); // 0..3

  return clampScore(1 + domainPoints + reviewPoints);
}

// ---------------------------------------------------------------------------
// opportunity_score = intent - (competition * 0.5), normalized to 1-10.
// ---------------------------------------------------------------------------
// Raw range is (1 - 5) .. (10 - 0.5) = -4 .. 9.5. We linearly map that window
// onto 1..10 so the field is always comparable and human-readable.
export function opportunityScore(intent, competition) {
  const raw = intent - competition * 0.5;
  const RAW_MIN = -4;
  const RAW_MAX = 9.5;
  const normalized = 1 + ((raw - RAW_MIN) / (RAW_MAX - RAW_MIN)) * 9;
  return round1(clampScore(normalized));
}

export const PRIORITY_THRESHOLD = 7;

export function isPriority(opportunity) {
  return opportunity >= PRIORITY_THRESHOLD;
}

// ---------------------------------------------------------------------------
// suggested_angle — rule-based content/product strategy tag.
// ---------------------------------------------------------------------------
export function suggestedAngle({ serp, amazon, bucket, intent, competition }) {
  const paaCount = serp?.people_also_ask?.length || 0;
  const ads = serp?.ads_count || 0;
  const heavyReviewProducts = (amazon?.products || []).filter(
    (p) => (p.reviews || 0) >= 1000
  ).length;

  const angles = [];

  // High Amazon review counts -> listing/PDP optimization play.
  if (heavyReviewProducts >= 2) {
    angles.push('Amazon listing/PDP optimization angle');
  }

  // High ad_count + shopping bucket -> paid + comparison landing page.
  if (ads >= 3 && bucket === 'shopping') {
    angles.push('paid + comparison landing page angle');
  } else if (ads >= 4) {
    angles.push('paid search + review roundup angle');
  }

  // PAA-heavy + low competition -> long-form content/blog.
  if (paaCount >= 3 && competition <= 5) {
    angles.push('long-form content/blog angle');
  }

  // Problem-based, low competition -> educational/symptom-solution content.
  if (bucket === 'problem_based' && competition <= 5) {
    angles.push('symptom-solution educational content angle');
  }

  // Fallbacks so every keyword gets a tag.
  if (angles.length === 0) {
    if (intent >= 6 && competition >= 7) {
      angles.push('niche down / long-tail differentiation angle');
    } else if (intent >= 6) {
      angles.push('comparison / "best of" roundup angle');
    } else {
      angles.push('informational / awareness content angle');
    }
  }

  // De-dupe while preserving order.
  return [...new Set(angles)].join('; ');
}

// ---------------------------------------------------------------------------
// scoreKeyword — orchestrates the above into one enriched record.
// ---------------------------------------------------------------------------
export function scoreKeyword(record) {
  const { serp, amazon, bucket } = record;
  const intent = commercialIntentScore({ serp, amazon, bucket });
  const competition = competitionScore({ serp, amazon });
  const opportunity = opportunityScore(intent, competition);
  const angle = suggestedAngle({ serp, amazon, bucket, intent, competition });

  return {
    keyword: record.keyword,
    bucket,
    source: serp?.source || amazon?.source || 'unknown',
    ads_count: serp?.ads_count || 0,
    paa_count: serp?.people_also_ask?.length || 0,
    related_count: serp?.related_searches?.length || 0,
    top_domains: (serp?.organic || []).map((o) => o.domain).filter(Boolean),
    amazon_product_count: amazon?.products?.length || 0,
    amazon_avg_rating: avgRating(amazon?.products),
    amazon_max_reviews: maxReviews(amazon?.products),
    commercial_intent_score: intent,
    competition_score: competition,
    opportunity_score: opportunity,
    priority: isPriority(opportunity),
    suggested_angle: angle,
    // Keep raw nested data for JSON export / debugging.
    serp,
    amazon,
  };
}

function avgRating(products) {
  const rated = (products || []).filter((p) => typeof p.rating === 'number');
  if (rated.length === 0) return null;
  return round1(rated.reduce((s, p) => s + p.rating, 0) / rated.length);
}

function maxReviews(products) {
  const counts = (products || [])
    .map((p) => p.reviews)
    .filter((r) => typeof r === 'number');
  return counts.length ? Math.max(...counts) : 0;
}
