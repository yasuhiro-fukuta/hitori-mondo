const { TwaManifest, TwaGenerator, ConsoleLog } = require("@bubblewrap/core");
const { fetchUtils } = require("@bubblewrap/core"); fetchUtils.fetch = (u) => fetch(String(u), { redirect: "follow" });
(async () => {
  const url = new URL("https://hitori-mondo.vercel.app/manifest.webmanifest");
  const m = await TwaManifest.fromWebManifest(url);
  m.packageId = "jp.fromscratch.hitorimondo";
  m.name = "ひとり問答";
  m.launcherName = "ひとり問答";
  m.themeColor = m.themeColor; m.navigationColor = m.backgroundColor;
  m.appVersionCode = 1; m.appVersionName = "1.0.0";
  m.signingKey = { path: "/home/claude/twa-build/upload-key.jks", alias: "upload" };
  m.features = { playBilling: { enabled: true } };
  m.fallbackType = "customtabs";
  m.enableNotifications = false;
  m.minSdkVersion = 24;
  await m.saveToFile("/home/claude/twa-build/app/twa-manifest.json");
  await new TwaGenerator().createTwaProject("/home/claude/twa-build/app", m, new ConsoleLog("gen"));
  console.log("generated", m.host, m.startUrl, m.iconUrl);
})().catch((e) => { console.error(e); process.exit(1); });
