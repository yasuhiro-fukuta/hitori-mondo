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

## Claude 連携の設定（Vercel → Settings → Environment Variables）

| 名前 | 値 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Console で作った API キー |
| `APP_PASSCODE` | アプリで入力する合言葉（他人に API を使われないため） |
| `ANTHROPIC_MODEL` | 任意。省略時 `claude-opus-5-5` |

設定後に再デプロイ。Production と Preview の両方にチェックを入れる。
