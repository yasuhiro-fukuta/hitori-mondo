// Plans, model routing and cost math. Everything that decides money lives here.
// Costs are tracked in yen per user so a subscriber can never cost more than they pay.

export const USD_JPY = Number(process.env.USD_JPY) || 160; // set a little above the market rate on purpose

// USD per million tokens (platform.claude.com/docs/en/about-claude/pricing, 2026-10)
export const MODELS = {
  haiku:  { id: "claude-haiku-5-5",  in: 0.10, out: 0.50, maxOut: 1500, effort: "low" },
  sonnet: { id: "claude-sonnet-5-5", in: 2,    out: 10,   maxOut: 1500, effort: "low" },
  opus:   { id: "claude-opus-5-5",   in: 4,    out: 20,   maxOut: 3000, effort: "medium" },
};

export const LIMITS = {
  historyChars: 15_000,   // only the most recent part of a thread is sent
  freePerDay: 3,          // free answers per day (Haiku)
  subCostYen: 250,        // monthly cost ceiling per subscriber (net revenue ≈ ¥408)
  subDeepPerPeriod: 30,   // Opus answers per subscription period
  subHaikuPerDay: 50,     // after the cost ceiling: Haiku only, with a daily cap against abuse
  ticketNormal: 1,        // tickets per Sonnet answer
  ticketDeep: 3,          // tickets per Opus answer
};

export const PRODUCTS = {
  monthly: process.env.PLAY_SUB_ID || "monthly_480",     // subscription ¥480/month
  tickets20: process.env.PLAY_TICKETS_ID || "tickets_20", // consumable ¥240 = 20 tickets
};
export const TICKETS_PER_PACK = 20;

const SYSTEM_TOKENS = 600;
// Japanese text runs about 1–1.3 tokens per character; plan on the high side.
export const estimateTokens = (chars) => Math.ceil(chars * 1.3) + SYSTEM_TOKENS;

export function costYen(model, inputTokens, outputTokens) {
  const m = MODELS[model];
  return ((inputTokens * m.in + outputTokens * m.out) / 1e6) * USD_JPY;
}

// Worst case for one answer, used to reserve budget before calling the API.
export const maxCostYen = (model, chars) => costYen(model, estimateTokens(chars), MODELS[model].maxOut);

// Today's date in Japan, for the daily free quota.
export function jstDay(now = Date.now()) {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}
