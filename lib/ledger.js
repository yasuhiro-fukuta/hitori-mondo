// Per-user billing ledger at billing/{uid} (server-only; clients cannot read or write it).
// Each answer reserves the worst-case cost first, then settles to the real cost from the API usage.
import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase.js";
import { LIMITS, maxCostYen, jstDay } from "./pricing.js";
import { getSubscription } from "./play.js";

export class Paywall extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

let dbFn = db;
export const _setDb = (fn) => { dbFn = fn; }; // tests only
const store = () => dbFn();
const ref = (uid) => store().collection("billing").doc(uid);

const subActive = (d, now) => !!(d.sub && d.sub.expiresAt > now);
const periodOf = (d) => (d.sub ? d.sub.periodKey : null);

// Usage counters for the current subscription period (reset when the period changes).
function subUsage(d) {
  const same = d.subPeriodKey && d.subPeriodKey === periodOf(d);
  return { cost: same ? d.subCost || 0 : 0, deep: same ? d.subDeep || 0 : 0 };
}

// If the stored subscription looks expired, ask Play once whether it renewed.
export async function refreshSubscription(uid) {
  const snap = await ref(uid).get();
  const d = snap.data() || {};
  if (!d.sub || !d.sub.token || d.sub.expiresAt > Date.now()) return;
  try {
    const s = await getSubscription(d.sub.token);
    if (s.expiresAt > d.sub.expiresAt) {
      await ref(uid).set({ sub: { ...d.sub, expiresAt: s.expiresAt, periodKey: s.expiresAt } }, { merge: true });
    }
  } catch (e) {
    console.error("refreshSubscription", e.message);
  }
}

// Decide which model answers and reserve budget. Returns a reservation to settle or refund.
export async function reserve(uid, mode, chars) {
  const now = Date.now(), today = jstDay(now);
  return store().runTransaction(async (tx) => {
    const snap = await tx.get(ref(uid));
    const d = snap.data() || {};
    const active = subActive(d, now);
    const use = subUsage(d);
    const tickets = d.tickets || 0;
    const freeUsed = d.freeDay === today ? d.freeUsed || 0 : 0;
    const haikuUsed = d.haikuDay === today ? d.haikuUsed || 0 : 0;
    const write = (fields) => tx.set(ref(uid), { ...fields, updatedAt: now }, { merge: true });
    const subFields = (cost, deep) => ({ subPeriodKey: periodOf(d), subCost: use.cost + cost, subDeep: use.deep + deep });

    if (mode === "deep") {
      const cost = maxCostYen("opus", chars);
      if (active && use.deep < LIMITS.subDeepPerPeriod && use.cost + cost <= LIMITS.subCostYen) {
        write(subFields(cost, 1));
        return { kind: "sub", model: "opus", reserved: cost, deep: 1 };
      }
      if (tickets >= LIMITS.ticketDeep) {
        write({ tickets: FieldValue.increment(-LIMITS.ticketDeep) });
        return { kind: "ticket", model: "opus", n: LIMITS.ticketDeep };
      }
      throw new Paywall("deep", active
        ? "今月の「深く考える」の枠を使い切りました。回数券（3枚）で使えます"
        : "「深く考える」は月額プランか回数券（3枚）で使えます");
    }

    const sonnetCost = maxCostYen("sonnet", chars);
    if (active && use.cost + sonnetCost <= LIMITS.subCostYen) {
      write(subFields(sonnetCost, 0));
      return { kind: "sub", model: "sonnet", reserved: sonnetCost, deep: 0 };
    }
    if (tickets >= LIMITS.ticketNormal) {
      write({ tickets: FieldValue.increment(-LIMITS.ticketNormal) });
      return { kind: "ticket", model: "sonnet", n: LIMITS.ticketNormal };
    }
    if (freeUsed < LIMITS.freePerDay) {
      write({ freeDay: today, freeUsed: freeUsed + 1 });
      return { kind: "free", model: "haiku", day: today };
    }
    if (active && haikuUsed < LIMITS.subHaikuPerDay) {
      write({ haikuDay: today, haikuUsed: haikuUsed + 1 });
      return { kind: "subHaiku", model: "haiku", day: today };
    }
    throw new Paywall("limit", active
      ? "今日はこれ以上答えられません。明日また使えます（回数券なら今すぐ使えます）"
      : "今日の無料3回を使い切りました。月額プランか回数券で続けられます");
  });
}

// Replace the reserved worst case with the real cost (subscription only; others are counted per answer).
export async function settle(uid, r, actualYen) {
  const fields = { totalCostYen: FieldValue.increment(actualYen), answers: FieldValue.increment(1), updatedAt: Date.now() };
  if (r.kind === "sub") fields.subCost = FieldValue.increment(actualYen - r.reserved);
  await ref(uid).set(fields, { merge: true });
}

// Give back what was reserved when the answer failed.
export async function refund(uid, r) {
  const f = { updatedAt: Date.now() };
  if (r.kind === "sub") { f.subCost = FieldValue.increment(-r.reserved); if (r.deep) f.subDeep = FieldValue.increment(-r.deep); }
  if (r.kind === "ticket") f.tickets = FieldValue.increment(r.n);
  if (r.kind === "free") { await decIfSameDay(uid, "freeDay", "freeUsed", r.day); return; }
  if (r.kind === "subHaiku") { await decIfSameDay(uid, "haikuDay", "haikuUsed", r.day); return; }
  await ref(uid).set(f, { merge: true });
}

async function decIfSameDay(uid, dayField, countField, day) {
  await store().runTransaction(async (tx) => {
    const d = (await tx.get(ref(uid))).data() || {};
    if (d[dayField] === day && (d[countField] || 0) > 0) tx.set(ref(uid), { [countField]: d[countField] - 1 }, { merge: true });
  });
}

// What the app shows: remaining free answers, tickets, and how much of the plan is left.
export async function status(uid) {
  const d = (await ref(uid).get()).data() || {};
  return summarize(d);
}

export function summarize(d, now = Date.now()) {
  const today = jstDay(now);
  const active = subActive(d, now);
  const use = subUsage(d);
  return {
    freeLeft: Math.max(0, LIMITS.freePerDay - (d.freeDay === today ? d.freeUsed || 0 : 0)),
    tickets: d.tickets || 0,
    sub: active
      ? {
          expiresAt: d.sub.expiresAt,
          planLeftPct: Math.max(0, Math.round(100 * (1 - use.cost / LIMITS.subCostYen))),
          deepLeft: Math.max(0, LIMITS.subDeepPerPeriod - use.deep),
        }
      : null,
  };
}

// Purchases: idempotent, and a purchase token can only ever belong to one account.
export async function grantSubscription(uid, token, s) {
  const pref = store().collection("purchases").doc(hashToken(token));
  await store().runTransaction(async (tx) => {
    const p = (await tx.get(pref)).data();
    if (p && p.uid !== uid) throw new Paywall("owned", "この購入は別のアカウントで使われています");
    tx.set(pref, { uid, type: "sub", productId: s.productId, at: Date.now() }, { merge: true });
    tx.set(ref(uid), { sub: { token, productId: s.productId, expiresAt: s.expiresAt, periodKey: s.expiresAt }, updatedAt: Date.now() }, { merge: true });
  });
}

// Returns true if tickets were added now (false if this token was already credited).
export async function grantTickets(uid, token, productId, n) {
  const pref = store().collection("purchases").doc(hashToken(token));
  return store().runTransaction(async (tx) => {
    const p = (await tx.get(pref)).data();
    if (p) {
      if (p.uid !== uid) throw new Paywall("owned", "この購入は別のアカウントで使われています");
      return false;
    }
    tx.set(pref, { uid, type: "tickets", productId, n, at: Date.now() });
    tx.set(ref(uid), { tickets: FieldValue.increment(n), updatedAt: Date.now() }, { merge: true });
    return true;
  });
}

const hashToken = (t) => createHash("sha256").update(String(t)).digest("hex");
