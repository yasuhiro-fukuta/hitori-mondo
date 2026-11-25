// Developer passphrase: if the first message of a conversation starts with DEV_PASSPHRASE
// and the signed-in Google account is the developer's, that conversation skips all limits.
// The passphrase only ever lives in the server's environment; it is never logged.
import { createHash, timingSafeEqual } from "node:crypto";

const DEFAULT_OWNER_EMAILS = ["ravnicaguild@gmail.com"];

const sha = (s) => createHash("sha256").update(String(s), "utf8").digest();
const eq = (a, b) => timingSafeEqual(sha(a), sha(b)); // fixed-length digests → constant time

function expected(env) {
  const p = String(env.DEV_PASSPHRASE || "").trim();
  return p || null;
}

// Is this Firebase user the developer? DEV_OWNER_UIDS / DEV_OWNER_EMAILS (comma-separated) override the default.
export function isDevOwner(user, env = process.env) {
  if (!user) return false;
  const uids = String(env.DEV_OWNER_UIDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (uids.length && uids.includes(user.uid)) return true;
  const emails = (env.DEV_OWNER_EMAILS ? String(env.DEV_OWNER_EMAILS).split(",") : DEFAULT_OWNER_EMAILS)
    .map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!(user.email && user.emailVerified && emails.includes(user.email.toLowerCase()));
}

// Looks at the first message the user wrote in the thread (not Claude's).
// Returns { ok, messages } where messages has the passphrase removed when ok.
export function checkDevPassphrase(messages, env = process.env) {
  const pass = expected(env);
  if (!pass || !Array.isArray(messages)) return { ok: false, messages };
  const i = messages.findIndex((m) => m && m.by !== "claude" && String(m.t ?? "").trim());
  if (i < 0) return { ok: false, messages };
  const text = String(messages[i].t).replace(/^\s+/, "");
  const head = text.slice(0, pass.length);
  const rest = text.slice(pass.length);
  // compare first (constant time), then require the passphrase to stand alone (end / space / newline)
  const match = eq(head, pass) && (rest === "" || /^\s/.test(rest));
  if (!match) return { ok: false, messages };
  const out = messages.slice();
  out[i] = { ...messages[i], t: rest.replace(/^\s+/, "") };
  return { ok: true, messages: out };
}
