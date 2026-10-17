// Google Play Developer API: verify, acknowledge and consume purchases.
// Uses the same service account as Firebase; it must be invited in Play Console
// (Users and permissions → "View financial data" + "Manage orders and subscriptions").
// Env: PLAY_PACKAGE_NAME (e.g. jp.fromscratch.hitorimondo)
import { JWT } from "google-auth-library";
import { serviceAccount } from "./firebase.js";

const BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
let client = null;

function pkg() {
  const p = process.env.PLAY_PACKAGE_NAME;
  if (!p) throw new Error("PLAY_PACKAGE_NAME is not set");
  return encodeURIComponent(p);
}

async function call(method, path, body) {
  if (!client) {
    const sa = serviceAccount();
    if (!sa) throw new Error("FIREBASE_SERVICE_ACCOUNT is missing");
    client = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ["https://www.googleapis.com/auth/androidpublisher"] });
  }
  const res = await client.request({ url: `${BASE}/${pkg()}/${path}`, method, data: body, validateStatus: () => true });
  if (res.status >= 400) {
    const err = new Error(`Play API ${res.status}: ${JSON.stringify(res.data).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.data;
}

const tok = (t) => encodeURIComponent(t);

// Subscription: { active, expiresAt(ms), productId, needsAck }
export async function getSubscription(purchaseToken) {
  const s = await call("GET", `purchases/subscriptionsv2/tokens/${tok(purchaseToken)}`);
  const line = (s.lineItems || [])[0] || {};
  const expiresAt = line.expiryTime ? Date.parse(line.expiryTime) : 0;
  const okStates = ["SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_CANCELED"];
  return {
    active: okStates.includes(s.subscriptionState) && expiresAt > Date.now(),
    expiresAt,
    productId: line.productId || "",
    needsAck: s.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING",
  };
}

export const ackSubscription = (productId, purchaseToken) =>
  call("POST", `purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${tok(purchaseToken)}:acknowledge`, {});

// One-time product: { purchased, consumed }
export async function getProduct(productId, purchaseToken) {
  const p = await call("GET", `purchases/products/${encodeURIComponent(productId)}/tokens/${tok(purchaseToken)}`);
  return { purchased: p.purchaseState === 0, consumed: p.consumptionState === 1 };
}

export const consumeProduct = (productId, purchaseToken) =>
  call("POST", `purchases/products/${encodeURIComponent(productId)}/tokens/${tok(purchaseToken)}:consume`, {});
