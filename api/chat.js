// POST /api/chat — Claude answers the latest question in a thread.
// Auth: "Authorization: Bearer <Firebase ID token>" (normal users, metered by lib/ledger.js)
//       or "x-passcode: <APP_PASSCODE>" (owner; unmetered).
// Body: { messages: [{r, t, by?}], mode: "normal" | "deep" }
// Env: ANTHROPIC_API_KEY, FIREBASE_SERVICE_ACCOUNT, APP_PASSCODE (optional), USD_JPY (optional).
// Response: NDJSON lines {t:"delta",text} / {t:"done",text,truncated,quota} / {t:"refusal"} / {t:"error",message}.
// Errors before streaming: 401 login, 402 {error:"paywall", code, message, quota}.
import { createHash, timingSafeEqual } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { verifyUser } from "../lib/firebase.js";
import { reserve, settle, refund, status, refreshSubscription, Paywall } from "../lib/ledger.js";
import { MODELS, LIMITS, costYen } from "../lib/pricing.js";

const MAX_CHARS = 300_000;

const SYSTEM = `あなたは、ユーザーの自問自答に付き合う対話相手です。
ユーザーはスマホのチャットアプリ「ひとり問答」で、自分に問いを立てて考えています。
ユーザーのメッセージ中の【問い】はユーザーが立てた問い、【自分の答え】はユーザー自身が書いた答えです。あなたの過去の返事はアシスタントのメッセージとして入っています。

最新の問いに日本語で率直に答えてください。答えを押し付けるより、ユーザー自身の考えが深まることを大事にしてください。役に立つときは、別の見方を一つ二つ示したり、考えを進める問いを一つ返したりしてかまいません。
スマホで読むので、短めの段落で書き、見出しや表は使わないでください。`;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

function passcodeOk(given) {
  const expected = process.env.APP_PASSCODE;
  if (!expected || typeof given !== "string" || !given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

// Keep only the most recent part of the thread (caps the cost of one answer).
export function trimThread(thread, maxChars = LIMITS.historyChars) {
  const out = [];
  let total = 0;
  for (let i = thread.length - 1; i >= 0; i--) {
    const len = String(thread[i].t ?? "").length;
    if (out.length && total + len > maxChars) break;
    out.unshift(len > maxChars ? { ...thread[i], t: String(thread[i].t).slice(-maxChars) } : thread[i]);
    total += Math.min(len, maxChars);
  }
  return { thread: out, chars: total };
}

// Thread messages -> API messages. The user's own questions and answers go in user turns,
// Claude's earlier replies go in assistant turns.
export function toApiMessages(thread) {
  const out = [];
  let chunk = [];
  for (const m of thread) {
    const text = String(m.t ?? "").trim();
    if (!text) continue;
    if (m.by === "claude") {
      if (chunk.length) { out.push({ role: "user", content: chunk.join("\n\n") }); chunk = []; }
      if (out.length) out.push({ role: "assistant", content: text });
    } else {
      chunk.push((m.r === "q" ? "【問い】\n" : "【自分の答え】\n") + text);
    }
  }
  if (!chunk.length) return null; // must end on the user's side
  out.push({ role: "user", content: chunk.join("\n\n") });
  return out;
}

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return json(503, { error: "not_configured", message: "サーバーに ANTHROPIC_API_KEY が設定されていません" });
  }

  let body;
  try { body = await request.json(); } catch { return json(400, { error: "bad_request", message: "リクエストが読めません" }); }
  const raw = Array.isArray(body?.messages) ? body.messages : null;
  if (!raw || JSON.stringify(raw).length > MAX_CHARS) {
    return json(400, { error: "bad_request", message: "問答が長すぎるか、形式が違います" });
  }
  const mode = body?.mode === "deep" ? "deep" : "normal";
  const { thread, chars } = trimThread(raw);
  const messages = toApiMessages(thread);
  if (!messages) return json(400, { error: "bad_request", message: "最後が問いになっていません" });

  // Who is asking, and which model they get.
  const owner = passcodeOk(request.headers.get("x-passcode"));
  let user = null, r = null;
  if (owner) {
    r = { kind: "owner", model: mode === "deep" ? "opus" : "sonnet" };
  } else {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
      return json(503, { error: "not_configured", message: "サーバーに FIREBASE_SERVICE_ACCOUNT が設定されていません" });
    }
    user = await verifyUser(request);
    if (!user) return json(401, { error: "login", message: "Claude に聞くには Google でログインしてください" });
    try {
      await refreshSubscription(user.uid);
      r = await reserve(user.uid, mode, chars);
    } catch (e) {
      if (e instanceof Paywall) return json(402, { error: "paywall", code: e.code, message: e.message, quota: await status(user.uid) });
      console.error(e);
      return json(500, { error: "server", message: "残り回数を確認できませんでした。もう一度送ってください" });
    }
  }

  const model = MODELS[r.model];
  const client = new Anthropic();
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      let charged = false;
      try {
        const s = client.messages.stream({
          model: model.id,
          max_tokens: model.maxOut,
          output_config: { effort: model.effort },
          system: SYSTEM,
          messages,
        }, { signal: request.signal });

        for await (const event of s) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ t: "delta", text: event.delta.text });
          }
        }
        const final = await s.finalMessage();
        const u = final.usage || {};
        const yen = costYen(r.model, (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), u.output_tokens || 0);
        if (user) { await settle(user.uid, r, yen); charged = true; }
        if (final.stop_reason === "refusal") { send({ t: "refusal" }); return; }
        const text = final.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
        send({ t: "done", text, model: r.model, truncated: final.stop_reason === "max_tokens", quota: user ? await status(user.uid) : null });
      } catch (err) {
        if (user && !charged) await refund(user.uid, r).catch((e) => console.error("refund", e));
        if (err?.name === "AbortError" || request.signal?.aborted) return;
        let message = "Claude から返事を受け取れませんでした";
        if (err instanceof Anthropic.AuthenticationError) message = "API キーが正しくありません（サーバーの設定を確認してください）";
        else if (err instanceof Anthropic.PermissionDeniedError) message = "この API キーではこのモデルを使えません";
        else if (err instanceof Anthropic.RateLimitError) message = "混み合っています。少し待ってからもう一度送ってください";
        else if (err instanceof Anthropic.BadRequestError) message = "リクエストが受け付けられませんでした: " + err.message;
        else if (err instanceof Anthropic.APIError) message = `Claude 側のエラーです（${err.status ?? "通信"}）。もう一度送ってください`;
        console.error(err);
        send({ t: "error", message });
      } finally {
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
