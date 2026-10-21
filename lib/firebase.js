// Verifies the user's Firebase (Google) login without any secret key:
// Firebase ID tokens are checked against Google's public signing keys.
import { createRemoteJWKSet, jwtVerify } from "jose";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "hitori-mondo";
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

// Returns { uid, email } for a valid Firebase ID token, otherwise null.
export async function verifyUser(request) {
  const h = request.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const { payload } = await jwtVerify(m[1], JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
      algorithms: ["RS256"],
    });
    if (!payload.sub) return null;
    return { uid: String(payload.sub), email: String(payload.email || "") };
  } catch {
    return null;
  }
}
