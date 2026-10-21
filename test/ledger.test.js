// node --test test/ — checks the money rules without touching Firebase or Claude.
import { test } from "node:test";
import assert from "node:assert/strict";
import { _setDb, reserve, settle, refund, summarize, grantTickets, Paywall } from "../lib/ledger.js";
import { LIMITS, maxCostYen, costYen } from "../lib/pricing.js";
import { trimThread } from "../api/chat.js";
import { merge, increment } from "../lib/store.js";

// In-memory stand-in for lib/store.js (same merge rules).
function fakeDb() {
  const data = new Map();
  const apply = (key, fields) => data.set(key, merge(data.get(key), fields));
  const doc = (col, id) => {
    const key = col + "/" + id;
    return { key, get: async () => ({ data: () => data.get(key) }), set: async (f) => apply(key, f) };
  };
  return {
    data,
    collection: (c) => ({ doc: (id) => doc(c, id) }),
    runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, f) => apply(r.key, f) }),
  };
}

const db = fakeDb();
_setDb(() => db);
const bill = (uid) => db.data.get("billing/" + uid) || {};
const CH = 15_000; // worst-case history

test("worst-case cost per answer stays under what the user pays", () => {
  const ticketNet = (240 * 0.85) / 20; // ≈ ¥10.2 per ticket
  assert.ok(maxCostYen("sonnet", CH) < ticketNet * LIMITS.ticketNormal, "Sonnet answer must cost less than 1 ticket");
  assert.ok(maxCostYen("opus", CH) < ticketNet * LIMITS.ticketDeep, "Opus answer must cost less than 3 tickets");
  assert.ok(maxCostYen("haiku", CH) < 1, "free Haiku answer must cost under ¥1");
  assert.ok(LIMITS.subCostYen < 480 * 0.85, "subscription ceiling must be below net revenue");
});

test("free: 3 per day on Haiku, then paywall", async () => {
  for (let i = 0; i < 3; i++) assert.equal((await reserve("u1", "normal", 100)).model, "haiku");
  await assert.rejects(reserve("u1", "normal", 100), (e) => e instanceof Paywall && e.code === "limit");
  await assert.rejects(reserve("u1", "deep", 100), (e) => e instanceof Paywall && e.code === "deep");
});

test("refund gives a free answer back", async () => {
  const r = await reserve("u2", "normal", 100);
  assert.equal(bill("u2").freeUsed, 1);
  await refund("u2", r);
  assert.equal(bill("u2").freeUsed, 0);
});

test("tickets: Sonnet uses 1, Opus uses 3, purchase is credited once", async () => {
  assert.equal(await grantTickets("u3", "tok-a", "tickets_20", 20), true);
  assert.equal(await grantTickets("u3", "tok-a", "tickets_20", 20), false);
  await assert.rejects(grantTickets("other", "tok-a", "tickets_20", 20), (e) => e.code === "owned");
  assert.equal((await reserve("u3", "normal", 100)).model, "sonnet");
  assert.equal((await reserve("u3", "deep", 100)).model, "opus");
  assert.equal(bill("u3").tickets, 16);
});

test("subscription: cost ceiling switches to Haiku, never above ¥250", async () => {
  const exp = Date.now() + 30 * 86400_000;
  db.data.set("billing/u4", { sub: { token: "t", productId: "monthly_480", expiresAt: exp, periodKey: exp } });
  let spent = 0, n = 0;
  for (;;) {
    const r = await reserve("u4", "normal", CH);
    if (r.model !== "sonnet") { assert.equal(r.model, "haiku"); break; }
    const real = costYen("sonnet", 18_000, 1500); // heavy but realistic answer
    await settle("u4", r, real);
    spent += real; n++;
    assert.ok(n < 1000);
  }
  assert.ok(spent <= LIMITS.subCostYen, `spent ¥${spent.toFixed(0)} > ceiling`);
  assert.ok(bill("u4").subCost <= LIMITS.subCostYen);
  const q = summarize(bill("u4"));
  assert.equal(q.sub.planLeftPct < 10, true);
});

test("subscription: deep limited to 30 per period", async () => {
  const exp = Date.now() + 30 * 86400_000;
  db.data.set("billing/u5", { sub: { token: "t", productId: "monthly_480", expiresAt: exp, periodKey: exp } });
  for (let i = 0; i < LIMITS.subDeepPerPeriod; i++) {
    const r = await reserve("u5", "deep", 100);
    assert.equal(r.model, "opus");
    await settle("u5", r, 1);
  }
  await assert.rejects(reserve("u5", "deep", 100), (e) => e.code === "deep");
});

test("new period resets subscription usage", async () => {
  const exp = Date.now() + 30 * 86400_000;
  db.data.set("billing/u6", { sub: { token: "t", productId: "m", expiresAt: exp, periodKey: exp }, subPeriodKey: exp - 1, subCost: 249, subDeep: 30 });
  assert.equal((await reserve("u6", "deep", 100)).model, "opus");
});

test("trimThread keeps only the latest ~15k characters", () => {
  const long = Array.from({ length: 40 }, (_, i) => ({ r: i % 2 ? "a" : "q", t: "あ".repeat(1000) }));
  long.push({ r: "q", t: "最後の問い" });
  const { thread, chars } = trimThread(long);
  assert.ok(chars <= LIMITS.historyChars);
  assert.equal(thread.at(-1).t, "最後の問い");
  const huge = trimThread([{ r: "q", t: "x".repeat(50_000) }]);
  assert.equal(huge.chars, LIMITS.historyChars);
});

test("store merge applies increments", () => {
  assert.deepEqual(merge({ a: 1, b: 2 }, { a: increment(2), c: increment(-1), b: 5 }), { a: 3, b: 5, c: -1 });
});
