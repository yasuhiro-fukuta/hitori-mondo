// node --test test/ — developer passphrase (lib/devpass.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkDevPassphrase, isDevOwner } from "../lib/devpass.js";
import { toApiMessages, trimThread } from "../api/chat.js";

const env = { DEV_PASSPHRASE: "ひらけごま-42" };
const q = (t, extra = {}) => ({ r: "q", t, ...extra });
const owner = { uid: "u-owner", email: "ravnicaguild@gmail.com", emailVerified: true };

test("disabled when DEV_PASSPHRASE is empty or unset", () => {
  assert.equal(checkDevPassphrase([q("ひらけごま-42 こんにちは")], {}).ok, false);
  assert.equal(checkDevPassphrase([q("ひらけごま-42 こんにちは")], { DEV_PASSPHRASE: "  " }).ok, false);
});

test("passphrase at the start of the first message unlocks and is removed", () => {
  const r = checkDevPassphrase([q("ひらけごま-42\n人生とは？")], env);
  assert.equal(r.ok, true);
  assert.equal(r.messages[0].t, "人生とは？");
  assert.ok(!JSON.stringify(toApiMessages(r.messages)).includes("ひらけごま"));
});

test("stays valid for the whole conversation (later messages, after trimming)", () => {
  const long = "あ".repeat(20_000);
  const thread = [q("ひらけごま-42 最初の問い"), { r: "a", by: "claude", t: long }, q("次の問い")];
  const r = checkDevPassphrase(thread, env);
  assert.equal(r.ok, true);
  const { thread: trimmed } = trimThread(r.messages);
  assert.ok(!JSON.stringify(trimmed).includes("ひらけごま"));
});

test("mismatch, wrong position, or passphrase as a prefix of a longer word → normal limits", () => {
  assert.equal(checkDevPassphrase([q("ひらけごま-41 問い")], env).ok, false);
  assert.equal(checkDevPassphrase([q("問い ひらけごま-42")], env).ok, false);
  assert.equal(checkDevPassphrase([q("ひらけごま-42x 問い")], env).ok, false);
  assert.equal(checkDevPassphrase([q("最初"), q("ひらけごま-42 二通目")], env).ok, false);
  assert.equal(checkDevPassphrase([], env).ok, false);
});

test("passphrase alone leaves nothing to send", () => {
  const r = checkDevPassphrase([q("  ひらけごま-42  ")], env);
  assert.equal(r.ok, true);
  assert.equal(toApiMessages(r.messages), null);
});

test("only the developer's verified Google account counts", () => {
  assert.equal(isDevOwner(owner, {}), true);
  assert.equal(isDevOwner({ ...owner, email: "RavnicaGuild@gmail.com" }, {}), true);
  assert.equal(isDevOwner({ ...owner, emailVerified: false }, {}), false);
  assert.equal(isDevOwner({ uid: "x", email: "someone@gmail.com", emailVerified: true }, {}), false);
  assert.equal(isDevOwner(null, {}), false);
  assert.equal(isDevOwner({ uid: "u-9", email: "", emailVerified: false }, { DEV_OWNER_UIDS: "u-1, u-9" }), true);
  assert.equal(isDevOwner(owner, { DEV_OWNER_EMAILS: "other@example.com" }), false);
});
