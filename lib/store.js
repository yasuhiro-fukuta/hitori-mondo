// Billing storage on Upstash Redis (connected from the Vercel Marketplace; no keys to copy by hand).
// Gives lib/ledger.js a tiny Firestore-like API: collection().doc().get()/set(merge, increment)
// and runTransaction() with a per-document lock.
// Env (set automatically by the Vercel integration): KV_REST_API_URL + KV_REST_API_TOKEN
// or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
import { Redis } from "@upstash/redis";

export const increment = (n) => ({ __inc: n });
const isInc = (v) => v && typeof v === "object" && "__inc" in v;

export function storeConfigured() {
  return !!((process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) ||
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN));
}

let redis = null;
function client() {
  if (!redis) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return redis;
}

export function merge(cur, fields) {
  const out = { ...(cur || {}) };
  for (const [k, v] of Object.entries(fields)) out[k] = isInc(v) ? (Number(out[k]) || 0) + v.__inc : v;
  return out;
}

const keyOf = (col, id) => `hm:${col}:${id}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function read(key) {
  const v = await client().get(key);
  return v == null ? undefined : typeof v === "string" ? JSON.parse(v) : v;
}
const write = (key, obj) => client().set(key, JSON.stringify(obj));

async function lock(key) {
  const lk = key + ":lock", token = Math.random().toString(36).slice(2);
  for (let i = 0; i < 60; i++) {
    if (await client().set(lk, token, { nx: true, px: 8000 })) return { lk, token };
    await sleep(50 + Math.random() * 50);
  }
  throw new Error("store busy");
}
async function unlock({ lk, token }) {
  const cur = await client().get(lk);
  if (cur === token) await client().del(lk);
}

export function redisDb() {
  const doc = (col, id) => {
    const key = keyOf(col, id);
    return {
      key,
      get: async () => { const d = await read(key); return { data: () => d }; },
      // non-transactional merge: short lock so it can't interleave with a transaction
      set: async (fields) => {
        const l = await lock(key);
        try { await write(key, merge(await read(key), fields)); } finally { await unlock(l); }
      },
    };
  };
  return {
    collection: (c) => ({ doc: (id) => doc(c, id) }),
    async runTransaction(fn) {
      const locks = new Map(), cache = new Map(), pending = new Map();
      try {
        const result = await fn({
          get: async (ref) => {
            if (!locks.has(ref.key)) locks.set(ref.key, await lock(ref.key));
            if (!cache.has(ref.key)) cache.set(ref.key, await read(ref.key));
            return { data: () => cache.get(ref.key) };
          },
          set: (ref, fields) => {
            if (!pending.has(ref.key)) pending.set(ref.key, []);
            pending.get(ref.key).push(fields);
          },
        });
        for (const [key, updates] of pending) {
          if (!locks.has(key)) { locks.set(key, await lock(key)); cache.set(key, await read(key)); }
          await write(key, updates.reduce(merge, cache.get(key)));
        }
        return result;
      } finally {
        for (const l of locks.values()) await unlock(l).catch(() => {});
      }
    },
  };
}
