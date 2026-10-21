// GET /api/me — remaining free answers, tickets and plan status for the signed-in user.
import { verifyUser } from "../lib/firebase.js";
import { storeConfigured } from "../lib/store.js";
import { status, refreshSubscription } from "../lib/ledger.js";

const json = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });

export async function GET(request) {
  if (!storeConfigured()) return json(503, { error: "not_configured" });
  const user = await verifyUser(request);
  if (!user) return json(401, { error: "login" });
  try {
    await refreshSubscription(user.uid);
    return json(200, { quota: await status(user.uid) });
  } catch (e) {
    console.error(e);
    return json(500, { error: "server" });
  }
}
