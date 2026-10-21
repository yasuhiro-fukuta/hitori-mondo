#!/usr/bin/env python3
"""Upload AAB + store listing + images to Google Play (internal track, draft).
Run in Cloud Shell:  python3 publish.py ~/sa.json
Never publishes to production."""
import json, sys, os, time
from google.oauth2 import service_account
from google.auth.transport.requests import AuthorizedSession

PKG = "jp.fromscratch.hitorimondo"
HERE = os.path.dirname(os.path.abspath(__file__))
BASE = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PKG}"
UP = f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PKG}"
LANG = "ja-JP"

TITLE = "ひとり問答"
SHORT = "自分に問いかけ、自分で答える。考えを深める自問自答ノート。迷ったときはAIにも聞けます。"
FULL = """「本当は何がしたいんだろう？」
答えの出ない問いを、チャットの形で自分と話しながら整理するアプリです。

■ ひとりで問答する
・右上のスイッチで「質問者」と「回答者」を切り替えて書くだけ
・質問は右、答えは左に並ぶので、考えの流れがひと目でわかる
・「送信後に交代」をオンにすると、書くたびに話し手が入れ替わる

■ 迷ったら AI に聞く
・「AI が答える」をオンにすると、Anthropic 社の AI「Claude」が問いに答えます
・答えを押し付けず、別の見方や次の問いを返してくれます
・毎日3回まで無料。もっと使いたい方は月額プランか回数券で

■ 安心して書ける
・問答は端末に保存。Google でログインすると端末間で同期
・書き出し／読み込みでバックアップ、CSV でも保存できます
・広告は表示しません

■ 料金
・無料：AI の回答 1日3回
・月額プラン 480円：AI をたっぷり使える＋上位モデルでじっくり答える「深く考える」月30回
・回数券 20枚 240円：通常1回1枚、「深く考える」1回3枚（期限なし）

運営：合同会社From Scratch（長野県木曽郡南木曽町）"""

s = AuthorizedSession(service_account.Credentials.from_service_account_file(
    sys.argv[1], scopes=["https://www.googleapis.com/auth/androidpublisher"]))

def ok(r, what):
    if r.status_code >= 300:
        print(f"NG {what}: {r.status_code} {r.text[:600]}")
        sys.exit(1)
    print(f"OK {what}")
    return r.json() if r.text else {}

edit = ok(s.post(f"{BASE}/edits"), "edit")["id"]
E = f"{BASE}/edits/{edit}"; EU = f"{UP}/edits/{edit}"

aab = open(os.path.join(HERE, "hitori-mondo-1.0.0.aab"), "rb").read()
b = ok(s.post(f"{EU}/bundles?uploadType=media", data=aab,
              headers={"Content-Type": "application/octet-stream"}, timeout=600), "bundle")
vc = b["versionCode"]; print("versionCode", vc)

ok(s.put(f"{E}/tracks/internal", json={"track": "internal", "releases": [{
    "name": "1.0.0", "versionCodes": [str(vc)], "status": "draft",
    "releaseNotes": [{"language": LANG, "text": "最初のリリース"}]}]}), "track internal")

ok(s.patch(f"{E}/details", json={"defaultLanguage": LANG, "contactEmail": "llcfromscratch@gmail.com",
    "contactWebsite": "https://hitori-mondo.vercel.app"}), "details")
ok(s.put(f"{E}/listings/{LANG}", json={"language": LANG, "title": TITLE,
    "shortDescription": SHORT, "fullDescription": FULL}), "listing")

def img(kind, files):
    ok(s.delete(f"{E}/listings/{LANG}/{kind}"), f"clear {kind}")
    for f in files:
        ok(s.post(f"{EU}/listings/{LANG}/{kind}?uploadType=media",
                  data=open(os.path.join(HERE, "store", f), "rb").read(),
                  headers={"Content-Type": "image/png"}), f"{kind} {f}")
img("icon", ["icon-512.png"])
img("featureGraphic", ["feature.png"])
img("phoneScreenshots", ["1_empty.png", "2_self.png", "3_claude.png", "4_list.png"])

ok(s.post(f"{E}:validate"), "validate")
r = s.post(f"{E}:commit")
if r.status_code >= 300 and ("changesNotSentForReview" in r.text or "sent for review" in r.text):
    r = s.post(f"{E}:commit?changesNotSentForReview=true")
ok(r, "commit")
print("DONE versionCode", vc)
