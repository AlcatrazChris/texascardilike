import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/visual",
  testMatch: "*.spec.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: {
    timeout: 5000,
    toHaveScreenshot: { animations: "disabled", maxDiffPixels: 0 },
  },
  snapshotPathTemplate:
    "{testDir}/baselines/{projectName}-{platform}/{arg}{ext}",
  outputDir: "test-results",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3005",
    browserName: "chromium",
    channel:
      process.env.PW_CHANNEL ||
      (process.platform === "win32" ? "msedge" : undefined),
    reducedMotion: "reduce",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium" },
    ...(process.env.PW_WEBKIT
      ? [{ name: "webkit", use: { browserName: "webkit", channel: undefined } }]
      : []),
  ],
  webServer: {
    command: '"' + process.execPath + '" server.mjs',
    url: "http://localhost:3005",
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: "3005",
      DEEPSEEK_POLICY: "off",
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
    },
  },
});
