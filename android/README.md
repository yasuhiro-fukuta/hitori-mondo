# Google Play 版（TWA）

本番 https://hitori-mondo.vercel.app をそのまま包む Android アプリ。パッケージ名 `jp.fromscratch.hitorimondo`。

## 作り方（Claude が実行）

1. Android SDK（build-tools 35, platform 35）と JDK 17 以上を用意
2. `npm i @bubblewrap/core` → `NODE_USE_ENV_PROXY=1 node gen.js`（`app/` に Gradle プロジェクトが出る）
3. `app/local.properties` に `sdk.dir=...` を書き、`./gradlew bundleRelease assembleRelease`
4. アップロード鍵（`upload-key.jks`, 別名 `upload`）で署名：AAB は `jarsigner`、APK は `zipalign` → `apksigner`

アップロード鍵とパスワードは Google ドライブ「Claude共有_事業全般 / 15_クロード自走_アプリ / 鍵」にある（リポジトリには置かない）。

## サイト側

- `/.well-known/assetlinks.json` にアップロード鍵の SHA-256 を登録済み。
  Play Console で「Play アプリ署名」の SHA-256 が出たら、同じ配列に追記する（追記しないとアプリ上部に URL バーが出る）。
- アプリ内課金は Digital Goods API（`com.android.vending.BILLING` 権限・playBilling 機能を有効化済み）。
