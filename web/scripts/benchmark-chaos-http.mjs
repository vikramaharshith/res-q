/** Production SSR timings only. This does not measure browser rendering or scrolling. */
import assert from "node:assert/strict";
import https from "node:https";
import { readFileSync, writeFileSync } from "node:fs";
const base = "http://127.0.0.1:3100";
const stats = () =>
  new Promise((resolve, reject) =>
    https
      .get(
        "https://127.0.0.1:5443/test-stats",
        { ca: readFileSync(process.env.RESQ_TEST_CERT) },
        (res) => {
          let text = "";
          res.on("data", (c) => (text += c));
          res.on("end", () => resolve(JSON.parse(text)));
        },
      )
      .on("error", reject),
  );
const initial = await stats(),
  run = initial.summary.importRunId;
const request = async (path) => {
  const start = performance.now(),
    response = await fetch(base + path),
    headerMs = performance.now() - start,
    html = await response.text();
  assert.equal(response.status, 200);
  return {
    totalMs: performance.now() - start,
    headerMs,
    bytes: Buffer.byteLength(html),
    html,
  };
};
const samples = [];
for (let i = 0; i < 5; i++) {
  const r = await request(`/?scenario=chaos&run=${run}`);
  assert.match(r.html, /7,864/);
  assert.equal(
    (r.html.match(/<article[^>]*data-emergency-report/g) ?? []).length,
    50,
  );
  assert.ok(!/replay_manifest|source_seed|hiddenGroundTruth/.test(r.html));
  samples.push({ ...r, html: undefined });
}
const counted = await stats();
assert.equal(
  counted.counts.chaos_dashboard_page -
    (initial.counts.chaos_dashboard_page ?? 0),
  5,
);
assert.equal(
  counted.counts.chaos_dashboard_runs -
    (initial.counts.chaos_dashboard_runs ?? 0),
  5,
);
const next = await request(`/?scenario=chaos&run=${run}&page=157`);
assert.equal(
  (next.html.match(/<article[^>]*data-emergency-report/g) ?? []).length,
  14,
);
const source = JSON.parse(
  readFileSync(
    new URL("../../resq-handoff/large-chaos-simulation.json", import.meta.url),
    "utf8",
  ),
).emergencyObservations[0].reportId;
const search = await request(`/?scenario=chaos&run=${run}&search=${source}`);
assert.equal(
  (search.html.match(/<article[^>]*data-emergency-report/g) ?? []).length,
  1,
);
const empty = await request(
  `/?scenario=chaos&run=${run}&search=b7nonexistentwordxyz`,
);
assert.equal(
  (empty.html.match(/<article[^>]*data-emergency-report/g) ?? []).length,
  0,
);
const sample = await request(
  "/?scenario=chaos&run=cimp_run_dd07bf2c2799731bd1ef2054766b605d",
);
assert.match(sample.html, /Two received reports/);
const flood = await request("/");
assert.match(flood.html, /Urban Flood/);
const rejected = await fetch(base + "/api/chaos-investigation", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    mode: "advise",
    scenario_id: "scn_chaos_large_flood_20261108_v1",
    observation_kind: "emergency",
    observation_id: source,
  }),
});
assert.ok(rejected.status >= 400);
const approvals = await fetch(base + "/api/approvals", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
assert.ok(approvals.status >= 400);
const final = await stats();
const result = {
  environment:
    "Production Next.js HTTP SSR + local PGlite PostgreSQL HTTPS adapter, no browser or hosted Supabase",
  samples,
  searchMs: search.totalMs,
  lastPageMs: next.totalMs,
  emptySearchMs: empty.totalMs,
  recordsRenderedPerPage: 50,
  lastPageRecords: 14,
  databaseCallsPerPage: 2,
  approvalHttpStatus: approvals.status,
  largeAdvisoryHttpStatus: rejected.status,
  sampleVerified: true,
  urbanFloodFallbackVerified: true,
  browserVerified: false,
  localDatabase: final,
};
writeFileSync(
  process.env.RESQ_TEST_REPORT ?? "/tmp/resq-large-http-benchmark.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify({ ...result, localDatabase: undefined }, null, 2));
