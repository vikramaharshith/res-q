/** Disposable embedded PostgreSQL; never connects to Supabase. */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { prepareLargeChaosImport } from "@/lib/simulation-import/large-chaos-import";
import { prepareSampleChaosImport } from "@/lib/simulation-import/chaos-import";
export const destination = "scn_chaos_large_flood_20261108_v1";
export async function createChaosTestDb() {
  const db = new PGlite();
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; GRANT USAGE ON SCHEMA public TO service_role;",
  );
  await db.exec(
    readFileSync(
      new URL("./2026-11-08-chaos-import-staging.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL("./2026-11-08-large-chaos.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec("SET ROLE service_role");
  const sample = prepareSampleChaosImport(
    readFileSync(
      new URL("../../resq-handoff/sample-simulation.json", import.meta.url),
      "utf8",
    ),
  );
  if (!sample.ok) throw new Error("Sample preparation failed");
  await db.query("SELECT stage_chaos_import($1::jsonb)", [
    JSON.stringify(sample.payload),
  ]);
  const start = performance.now();
  const prepared = prepareLargeChaosImport(
    readFileSync(
      new URL(
        "../../resq-handoff/large-chaos-simulation.json",
        import.meta.url,
      ),
      "utf8",
    ),
    destination,
  );
  const validationMs = performance.now() - start,
    imported = performance.now();
  const result = await db.query<{ result: { code: string } }>(
    "SELECT stage_large_chaos_import($1::jsonb) result",
    [JSON.stringify(prepared.payload)],
  );
  const importMs = performance.now() - imported;
  if (result.rows[0]?.result.code !== "STAGED")
    throw new Error("Local import failed");
  // Simulate the post-import statistics refresh without granting application roles maintenance rights.
  await db.exec(
    "RESET ROLE; ANALYZE public.chaos_emergency_observations; ANALYZE public.chaos_import_runs; SET ROLE service_role;",
  );
  return { db, prepared, timings: { validationMs, importMs } };
}
