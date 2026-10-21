// POST /api/purchase — the app sends a Google Play purchase; the server verifies it with Play
// and credits the account. Safe to call again for the same purchase (restore).
// Body: { productId, purchaseToken }
import { verifyUser } from "../lib/firebase.js";
import { storeConfigured } from "../lib/store.js";
import { grantSubscription, grantTickets, status, Paywall } from "../lib/ledger.js";
import { getSubscription, ackSubscription, getProduct, consumeProduct } from "../lib/play.js";
import { PRODUCTS, TICKETS_PER_PACK } from "../lib/pricing.js";

const json = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });

export async function POST(request) {
  if (!storeConfigured() || !process.env.PLAY_SERVICE_ACCOUNT || !process.env.PLAY_PACKAGE_NAME) {
    return json(503, { error: "not_configured", message: "購入の確認がまだ設定されていません" });
  }
  const user = await verifyUser(request);
  if (!user) return json(401, { error: "login", message: "Google でログインしてから購入してください" });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: "bad_request", message: "リクエストが読めません" }); }
  const productId = String(body?.productId || ""), token = String(body?.purchaseToken || "");
  if (!productId || !token) return json(400, { error: "bad_request", message: "購入情報が足りません" });

  try {
    if (productId === PRODUCTS.monthly) {
      const s = await getSubscription(token);
      if (!s.active) return json(402, { error: "inactive", message: "このプランは有効ではありません" });
      await grantSubscription(user.uid, token, s);
      if (s.needsAck) await ackSubscription(productId, token);
      return json(200, { ok: true, quota: await status(user.uid) });
    }
    if (productId === PRODUCTS.tickets20) {
      const p = await getProduct(productId, token);
      if (!p.purchased) return json(402, { error: "inactive", message: "支払いが完了していません" });
      const added = await grantTickets(user.uid, token, productId, TICKETS_PER_PACK);
      if (!p.consumed) await consumeProduct(productId, token).catch((e) => console.error("consume", e.message));
      return json(200, { ok: true, added, quota: await status(user.uid) });
    }
    return json(400, { error: "bad_request", message: "知らない商品です" });
  } catch (e) {
    if (e instanceof Paywall) return json(409, { error: e.code, message: e.message });
    console.error(e);
    return json(502, { error: "play", message: "Google Play で購入を確認できませんでした。少し待ってから「購入を復元」を押してください" });
  }
}
