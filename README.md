# ひとり問答

質問も回答も自分で書く、自問自答のためのチャットアプリ（PWA）。

- 右上のスイッチで「質問者」「回答者」を切り替える。質問者は右の吹き出し、回答者は左の吹き出し。
- 「送信後に交代」をオンにすると、送るたびに話し手が入れ替わる。
- 吹き出しをタップ → コピー / 反対側へ移す / 削除。
- 会話は端末内（localStorage）にだけ保存。左上メニューの「書き出す / 読み込む」で JSON バックアップ。
- ホーム画面に追加すると全画面アプリとして起動し、オフラインでも開ける。
- 「Claude が答える」をオンにすると、質問に Claude（Anthropic API）が答える。問いの吹き出しをタップ →「Claude に答えてもらう」で再送。

## 構成

ビルド不要の静的サイト。

```
index.html            アプリ本体（HTML/CSS/JS 1枚）
manifest.webmanifest  PWA マニフェスト
api/chat.js           Claude への中継（Vercel Function。API キーはサーバー側だけに置く）
sw.js                 Service Worker（オフライン対応。更新時は VERSION を上げる）
icons/                アプリアイコン（icon.svg が原本）
vercel.json           sw.js をキャッシュさせないヘッダー
```

## デプロイ

Vercel にインポート（Framework Preset: Other、ビルドコマンドなし）。`main` = 本番、`staging` = プレビュー。

## 料金のしくみ（2026-10-17〜）

- 無料：1日3回（Haiku）。Google ログイン必須。
- 月額 ¥480（Play 定期購入 `monthly_480`）：Sonnet。原価 ¥250/月で頭打ち、超えたら Haiku（1日50回まで）。「深く考える」（Opus）は月30回。
- 回数券 ¥240/20枚（Play 消費型 `tickets_20`）：Sonnet 1枚、Opus 3枚。
- 1回の重さに上限：直近 15,000 字だけ送る、返事は Sonnet 1,500 / Opus 3,000 トークンまで → 最大原価 Sonnet 約¥9、Opus 約¥22。
- 原価は毎回の実使用トークンから円換算して `billing/{uid}`（サーバー専用）に記録。数字は `lib/pricing.js`。
- `npm test` で「どの使い方でも赤字にならない」ことを確認できる。

## 構成（追加分）

```
api/chat.js      回答（ログイン確認 → 枠の予約 → Claude → 実原価で精算）
api/me.js        残り回数
api/purchase.js  Google Play の購入確認・付与（復元も同じ）
lib/             料金・Firebase Admin・Play API・台帳
firestore.rules  Firestore のルール（billing / purchases はサーバー専用）
privacy.html / terms.html / tokushoho.html
```

## 環境変数（Vercel → Settings → Environment Variables）

| 名前 | 値 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Console の API キー |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase のサービスアカウント鍵（JSON を1行で） |
| `PLAY_PACKAGE_NAME` | Play のパッケージ名（例 `jp.fromscratch.hitorimondo`） |
| `APP_PASSCODE` | 任意。オーナー用の合言葉（入れると無制限） |
| `USD_JPY` | 任意。原価計算の為替（既定 160） |

設定後に再デプロイ。Production と Preview の両方にチェックを入れる。
