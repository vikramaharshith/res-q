import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFileSync } from "node:fs";
import { createChaosTestDb, destination } from "@/scripts/large-chaos-test-db";
import {
  largeImportApproved,
  prepareLargeChaosImport,
} from "@/lib/simulation-import/large-chaos-import";
import {
  parseChaosLargePage,
  parseChaosPageQuery,
  parseChaosRuns,
} from "@/lib/chaos/large-read-model";
import {
  CHAOS_SAMPLE_IMPORT_RUN_ID,
  assembleChaosSimulation,
} from "@/lib/chaos/read-model";
let fixture: Awaited<ReturnType<typeof createChaosTestDb>>;
before(async () => {
  fixture = await createChaosTestDb();
});
after(async () => {
  await fixture?.db.close();
});
async function page(page = 0, search = "", category = "", urgency = "") {
  const query = {
    run: fixture.prepared.summary.importRunId,
    page,
    search,
    category,
    urgency,
  };
  const result = await fixture.db.query<{ value: unknown }>(
    "SELECT chaos_dashboard_page($1,$2,$3,$4,$5) value",
    [query.run, page, search, category, urgency],
  );
  return parseChaosLargePage(result.rows[0].value, query);
}
test("actual engine counts, bounded pages, map aggregation and preserved coordinates", async () => {
  const p = await page();
  assert.deepEqual(p.counts, {
    emergency: 7864,
    operational: 718,
    units: 80,
    assignments: 80,
  });
  assert.equal(p.reports.length, 50);
  assert.ok(p.cells.length <= 400);
  assert.equal(
    p.cells.reduce((s, c) => s + c.n, 0),
    7864,
  );
  const next = await page(1),
    last = await page(157);
  assert.ok(next.reports[0].ordinal > p.reports[49].ordinal);
  assert.equal(last.reports.length, 14);
  const doc = JSON.parse(
    readFileSync(
      new URL(
        "../../../resq-handoff/large-chaos-simulation.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const source = doc.emergencyObservations.find(
    (r: { reportId: string }) => r.reportId === p.reports[0].report_id,
  );
  assert.equal(p.reports[0].grid_x, source.location.x);
  assert.equal(p.reports[0].grid_y, source.location.y);
});
test("PostgreSQL search, category, urgency, empty results and final page", async () => {
  const report = (await page()).reports[0],
    found = await page(0, report.report_id);
  assert.equal(found.matched, 1);
  assert.equal(found.reports[0].report_id, report.report_id);
  const filtered = await page(0, "", report.category, "CRITICAL");
  assert.ok(
    filtered.reports.every(
      (r) => r.category === report.category && r.urgency === "CRITICAL",
    ),
  );
  const none = await page(0, "b7nonexistentwordxyz");
  assert.equal(none.matched, 0);
  assert.equal(none.cells.length, 0);
  assert.equal((await page(199)).reports.length, 0);
});
test("two-report sample remains unchanged and passes original strict read model", async () => {
  const { db } = fixture;
  const run = (
    await db.query(
      "SELECT id,schema_version,engine_version,run_id,digest_hex,source_scenario_id,source_label,fictional,difficulty,simulation_start,simulation_export,simulation_status,emergency_count,operational_count,unit_count,assignment_count FROM chaos_import_runs WHERE id=$1",
      [CHAOS_SAMPLE_IMPORT_RUN_ID],
    )
  ).rows[0];
  const rows = async (table: string) =>
    (
      await db.query(
        `SELECT * FROM ${table} WHERE import_run_id=$1 ORDER BY ${table === "chaos_units" ? "unit_id" : "ordinal"}`,
        [CHAOS_SAMPLE_IMPORT_RUN_ID],
      )
    ).rows;
  const board = assembleChaosSimulation({
    run,
    emergencyObservations: await rows("chaos_emergency_observations"),
    operationalObservations: await rows("chaos_operational_observations"),
    units: await rows("chaos_units"),
    publicAssignments: await rows("chaos_public_assignments"),
  });
  assert.equal(board.emergencyObservations.length, 2);
  assert.equal(board.operationalObservations.length, 7);
});
test("new destination and duplicate protection preserve all stored rows", async () => {
  const { db, prepared } = fixture;
  const call = async (payload: unknown) =>
    (
      await db.query<{ r: { code: string } }>(
        "SELECT stage_large_chaos_import($1::jsonb) r",
        [JSON.stringify(payload)],
      )
    ).rows[0].r;
  assert.equal((await call(prepared.payload)).code, "DESTINATION_EXISTS");
  assert.equal(
    (
      await call({
        ...prepared.payload,
        destinationScenarioId: destination + "_other",
      })
    ).code,
    "DUPLICATE_IMPORT",
  );
  for (const id of ["scn_demo_flood", "scn_chaos_sample"])
    assert.equal(
      (await call({ ...prepared.payload, destinationScenarioId: id })).code,
      "DESTINATION_FORBIDDEN",
    );
  assert.equal(
    (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM chaos_run_destinations",
      )
    ).rows[0].n,
    1,
  );
  assert.equal((await page()).counts.emergency, 7864);
});
test("public read allowlist excludes seed, replay and private metadata", async () => {
  const runs = parseChaosRuns(
    (await fixture.db.query<{ r: unknown }>("SELECT chaos_dashboard_runs() r"))
      .rows[0].r,
  );
  assert.equal(runs.length, 2);
  assert.equal(
    runs.find((r) => r.id === fixture.prepared.summary.importRunId)
      ?.destination,
    destination,
  );
  const p = await page();
  assert.ok(!/replay|seed|digest|hidden/i.test(JSON.stringify(p)));
  assert.throws(() =>
    parseChaosLargePage(
      { ...p, replay_manifest: {} },
      { run: p.run.id, page: 0, search: "", category: "", urgency: "" },
    ),
  );
});
test("query bounds, arrays, bad enums and oversized search are refused", () => {
  const run = fixture.prepared.summary.importRunId;
  for (const bad of [
    { page: "200" },
    { page: "-1" },
    { page: ["0"] },
    { run: "scn_demo_flood" },
    { category: "bad" },
    { urgency: "bad" },
    { search: "x".repeat(121) },
  ])
    assert.throws(() => parseChaosPageQuery(bad, run));
});
test("large import preserves schema/private-field rejection, sample guards and approval binding", () => {
  const sample = readFileSync(
    new URL("../../../resq-handoff/sample-simulation.json", import.meta.url),
    "utf8",
  );
  assert.throws(() => prepareLargeChaosImport(sample, destination));
  assert.throws(() => prepareLargeChaosImport(sample, "scn_demo_flood"));
  const doc = JSON.parse(sample);
  doc.hiddenGroundTruth = {};
  assert.throws(() =>
    prepareLargeChaosImport(JSON.stringify(doc), destination),
  );
  const digest = fixture.prepared.summary.sha256;
  assert.equal(
    largeImportApproved(
      "dry-run",
      digest,
      destination,
      `${digest}:${destination}`,
    ),
    false,
  );
  assert.equal(
    largeImportApproved("apply", digest, destination, "sample-two-report"),
    false,
  );
  assert.equal(
    largeImportApproved(
      "apply",
      digest,
      destination,
      `${digest}:${destination}`,
    ),
    true,
  );
});
test("database roles deny public access and service-role overwrite", async () => {
  const { db } = fixture;
  await db.exec("RESET ROLE");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(() => db.query("SELECT chaos_dashboard_runs()"));
    await assert.rejects(() => db.query("SELECT * FROM chaos_import_runs"));
    await assert.rejects(() =>
      db.query("SELECT stage_large_chaos_import('{}')"),
    );
    await db.exec("RESET ROLE");
  }
  await db.exec("SET ROLE service_role");
  await assert.rejects(() =>
    db.query("UPDATE chaos_import_runs SET source_label='bad'"),
  );
  await assert.rejects(() =>
    db.query("DELETE FROM chaos_emergency_observations"),
  );
});

test("same run with a changed digest is refused without a second destination", async () => {
  const { db } = fixture;
  const document = JSON.parse(
    readFileSync(
      new URL(
        "../../../resq-handoff/large-chaos-simulation.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  document.scenario.label += " changed artifact for conflict test";
  const { payload } = prepareLargeChaosImport(
    JSON.stringify(document),
    destination + "_conflict",
  );
  const result = await db.query<{ r: { code: string } }>(
    "SELECT stage_large_chaos_import($1::jsonb) r",
    [JSON.stringify(payload)],
  );
  assert.equal(result.rows[0].r.code, "RUN_DIGEST_CONFLICT");
  assert.equal(
    (
      await db.query<{ n: number }>(
        "SELECT count(*)::int n FROM chaos_run_destinations",
      )
    ).rows[0].n,
    1,
  );
});

test("database cap rejects malformed large payload before writing", async () => {
  const { db, prepared } = fixture;
  for (const observations of [
    null,
    prepared.payload.emergencyObservations.slice(0, 4999),
  ]) {
    const payload = {
      ...prepared.payload,
      destinationScenarioId: destination + "_short",
      emergencyObservations: observations,
    };
    const result = await db.query<{ r: { ok: boolean } }>(
      "SELECT stage_large_chaos_import($1::jsonb) r",
      [JSON.stringify(payload)],
    );
    assert.equal(result.rows[0].r.ok, false);
  }
  assert.equal((await page()).counts.emergency, 7864);
});

test("transport exceptions are not retried or exposed as raw diagnostics", async () => {
  const { executeLargeChaosImport } =
    await import("@/lib/simulation-import/large-chaos-import");
  let attempts = 0;
  await assert.rejects(
    () =>
      executeLargeChaosImport(fixture.prepared, async () => {
        attempts++;
        throw new Error("untrusted diagnostic");
      }),
    /commit outcome unknown/,
  );
  assert.equal(attempts, 1);
});
