// POST /api/chat — Claude answers the latest question in a thread.
// Env: ANTHROPIC_API_KEY (required), APP_PASSCODE (required), ANTHROPIC_MODEL (optional).
// Response: NDJSON lines {t:"delta",text} / {t:"reset"} / {t:"done",text} / {t:"refusal"} / {t:"error",message}.
import { createHash, timingSafeEqual } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
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
  if (!expected || typeof given !== "string") return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
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
  if (!process.env.ANTHROPIC_API_KEY || !process.env.APP_PASSCODE) {
    return json(503, { error: "not_configured", message: "サーバーに ANTHROPIC_API_KEY と APP_PASSCODE が設定されていません" });
  }
  if (!passcodeOk(request.headers.get("x-passcode"))) {
    return json(401, { error: "passcode", message: "合言葉が違います" });
  }

  let body;
  try { body = await request.json(); } catch { return json(400, { error: "bad_request", message: "リクエストが読めません" }); }
  const thread = Array.isArray(body?.messages) ? body.messages : null;
  if (!thread || JSON.stringify(thread).length > MAX_CHARS) {
    return json(400, { error: "bad_request", message: "問答が長すぎるか、形式が違います" });
  }
  const messages = toApiMessages(thread);
  if (!messages) return json(400, { error: "bad_request", message: "最後が問いになっていません" });

  const client = new Anthropic();
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      try {
        const s = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 16000,
          output_config: { effort: "medium" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: SYSTEM,
          messages,
        }, { signal: request.signal });

        for await (const event of s) {
          if (event.type === "content_block_start" && event.content_block.type === "fallback") {
            send({ t: "reset" }); // another model takes over; drop the partial text
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ t: "delta", text: event.delta.text });
          }
        }
        const final = await s.finalMessage();
        if (final.stop_reason === "refusal") { send({ t: "refusal" }); return; }
        // keep only the text written after the last model switch
        let start = 0;
        final.content.forEach((b, i) => { if (b.type === "fallback") start = i + 1; });
        const text = final.content.slice(start).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
        send({ t: "done", text, truncated: final.stop_reason === "max_tokens" });
      } catch (err) {
        let message = "Claude から返事を受け取れませんでした";
        if (err instanceof Anthropic.AuthenticationError) message = "API キーが正しくありません（サーバーの設定を確認してください）";
        else if (err instanceof Anthropic.PermissionDeniedError) message = "この API キーではこのモデルを使えません";
        else if (err instanceof Anthropic.RateLimitError) message = "混み合っています。少し待ってからもう一度送ってください";
        else if (err instanceof Anthropic.BadRequestError) message = "リクエストが受け付けられませんでした: " + err.message;
        else if (err instanceof Anthropic.APIError) message = `Claude 側のエラーです（${err.status ?? "通信"}）。もう一度送ってください`;
        else if (err?.name === "AbortError") return;
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
