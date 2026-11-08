/** Run against a production Next build + the disposable local PostgreSQL adapter. */
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import https from "node:https";
import { readFileSync, writeFileSync } from "node:fs";
const base = process.env.RESQ_TEST_BASE_URL ?? "http://127.0.0.1:3100";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))
  throw new Error("Browser benchmark is loopback-only.");
const stats = () =>
  new Promise((resolve, reject) => {
    https
      .get(
        "https://127.0.0.1:5443/test-stats",
        { ca: readFileSync(process.env.RESQ_TEST_CERT) },
        (res) => {
          let s = "";
          res.on("data", (c) => (s += c));
          res.on("end", () => resolve(JSON.parse(s)));
        },
      )
      .on("error", reject);
  });
const browser = await chromium.launch({
  executablePath: process.env.RESQ_TEST_CHROMIUM ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("https://*.tile.openstreetmap.org/**", (route) =>
  route.abort(),
);
const initial = await stats(),
  run = initial.summary.importRunId;
const target = `${base}/?scenario=chaos&run=${run}`;
const timings = [];
for (let i = 0; i < 5; i++) {
  const start = performance.now();
  await page.goto(target, { waitUntil: "networkidle" });
  await page.getByTestId("emergency-count").waitFor();
  timings.push(performance.now() - start);
  assert.equal(await page.getByTestId("emergency-count").innerText(), "7,864");
  assert.equal(await page.locator("[data-emergency-report]").count(), 50);
  assert.ok((await page.locator("[data-grid-cell]").count()) <= 400);
}
const beforeIdle = await stats();
await page.waitForTimeout(1200);
const afterIdle = await stats();
assert.deepEqual(
  afterIdle.counts,
  beforeIdle.counts,
  "Idle browser must not poll database",
);
const frameMs = await page.evaluate(async () => {
  const deltas = [];
  let last = performance.now();
  for (let i = 0; i < 90; i++) {
    await new Promise(requestAnimationFrame);
    const now = performance.now();
    deltas.push(now - last);
    last = now;
    window.scrollBy(0, 80);
  }
  return deltas;
});
await page.getByRole("link", { name: "Next", exact: true }).click();
await page.waitForURL(/page=1/);
await page.locator("[data-emergency-report]").first().waitFor();
assert.equal(await page.locator("[data-emergency-report]").count(), 50);
const source = JSON.parse(
  readFileSync(
    new URL("../../resq-handoff/large-chaos-simulation.json", import.meta.url),
    "utf8",
  ),
).emergencyObservations[0].reportId;
await page.getByRole("searchbox").fill(source);
const searchStart = performance.now();
await page.getByRole("button", { name: "Search / filter" }).click();
await page.waitForURL(/search=/);
await page.waitForLoadState("networkidle");
assert.equal(await page.locator("[data-emergency-report]").count(), 1);
const searchMs = performance.now() - searchStart;
await page.getByRole("searchbox").fill("b7nonexistentwordxyz");
await page.getByRole("button", { name: "Search / filter" }).click();
await page.waitForLoadState("networkidle");
assert.equal(await page.locator("[data-emergency-report]").count(), 0);
await page.goto(target);
await page.getByTestId("emergency-count").waitFor();
await page
  .getByRole("combobox", { name: "Urgency", exact: true })
  .selectOption("CRITICAL");
await page.getByRole("button", { name: "Search / filter" }).click();
await page.waitForLoadState("networkidle");
assert.ok((await page.locator("[data-emergency-report]").count()) > 0);
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(target);
await page.getByTestId("emergency-count").waitFor();
assert.ok(
  await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  ),
  "Mobile layout overflow",
);
await page.screenshot({ path: "/tmp/resq-large-mobile.png", fullPage: false });
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(target);
await page.getByTestId("emergency-count").waitFor();
await page.screenshot({ path: "/tmp/resq-large-desktop.png", fullPage: false });
await page
  .getByRole("combobox", { name: "Imported Chaos run" })
  .selectOption("cimp_run_dd07bf2c2799731bd1ef2054766b605d");
await page.getByRole("button", { name: "Open run" }).click();
await page.waitForLoadState("networkidle");
assert.equal(await page.locator('[data-scenario="chaos"]').first().count(), 1);
assert.equal(
  await page
    .getByRole("region", { name: "Emergency observations", exact: true })
    .locator("article")
    .count(),
  2,
);
await page.goto(base, { waitUntil: "networkidle" });
assert.ok((await page.locator("body").innerText()).includes("Urban Flood"));
// Approval and Nemotron paths remain closed without explicit local opt-in / operator selection.
const denied = await page.request.post(`${base}/api/approvals`, { data: {} });
assert.ok(denied.status() >= 400);
const badAdvisory = await page.request.post(`${base}/api/chaos-investigation`, {
  data: {
    scenario_id: "scn_chaos_large_flood_20261108_v1",
    observation_kind: "emergency",
    observation_id: source,
  },
});
assert.ok(badAdvisory.status() >= 400);
const fresh = await browser.newContext({
  viewport: { width: 390, height: 844 },
  reducedMotion: "no-preference",
});
const freshPage = await fresh.newPage();
await freshPage.goto(target, { waitUntil: "networkidle" });
assert.notEqual(
  await freshPage.evaluate(
    () => getComputedStyle(document.documentElement).overflow,
  ),
  "hidden",
);
await fresh.close();
assert.deepEqual(errors, []);
const final = await stats();
const sorted = [...timings].sort((a, b) => a - b);
const report = {
  environment:
    "Production Next.js; headless Chromium; local PGlite PostgreSQL with HTTPS read adapter (not hosted Supabase)",
  samples: timings.length,
  pageReadyIncludingNetworkIdleMs: timings,
  medianPageReadyMs: sorted[2],
  searchIncludingNetworkIdleMs: searchMs,
  scrollFrames: frameMs.length,
  maxFrameGapMs: Math.max(...frameMs),
  framesOver50Ms: frameMs.filter((x) => x > 50).length,
  initialPageDatabaseCalls: {
    runs:
      beforeIdle.counts.chaos_dashboard_runs -
      (initial.counts.chaos_dashboard_runs ?? 0),
    pages:
      beforeIdle.counts.chaos_dashboard_page -
      (initial.counts.chaos_dashboard_page ?? 0),
  },
  idleDatabaseCalls: 0,
  recordLimit: 50,
  gridCellLimit: 400,
  browserErrors: errors,
  localDatabase: final,
};
writeFileSync(
  process.env.RESQ_TEST_REPORT ?? "/tmp/resq-large-benchmark.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify({ ...report, localDatabase: undefined }, null, 2));
await browser.close();
