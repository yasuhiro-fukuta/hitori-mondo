// Firebase Admin: verifies the user's Google login and reads/writes the billing ledger.
// Env: FIREBASE_SERVICE_ACCOUNT = the service-account key JSON (one line).
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

export function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, "\n");
    return sa;
  } catch {
    return null;
  }
}

function app() {
  if (getApps().length) return getApps()[0];
  const sa = serviceAccount();
  if (!sa) throw new Error("FIREBASE_SERVICE_ACCOUNT is missing or invalid");
  return initializeApp({ credential: cert(sa), projectId: sa.project_id });
}

export const db = () => getFirestore(app());

// Returns { uid, email } for a valid Firebase ID token, otherwise null.
export async function verifyUser(request) {
  const h = request.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const t = await getAuth(app()).verifyIdToken(m[1]);
    return { uid: t.uid, email: t.email || "" };
  } catch {
    return null;
  }
}
