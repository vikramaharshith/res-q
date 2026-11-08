/** Loopback read adapter over real disposable PostgreSQL rows. Not Supabase/PostgREST. */
import https from "node:https";
import { readFileSync, writeFileSync } from "node:fs";
import { createChaosTestDb } from "@/scripts/large-chaos-test-db";
const { db, prepared, timings } = await createChaosTestDb();
const counts: Record<string, number> = {},
  latency: Record<string, number[]> = {};
const tables = new Set([
  "chaos_import_runs",
  "chaos_emergency_observations",
  "chaos_operational_observations",
  "chaos_units",
  "chaos_public_assignments",
]);
const server = https.createServer(
  {
    key: readFileSync(process.env.RESQ_TEST_KEY!),
    cert: readFileSync(process.env.RESQ_TEST_CERT!),
  },
  async (req, res) => {
    const url = new URL(req.url ?? "/", "https://127.0.0.1");
    res.setHeader("content-type", "application/json");
    const send = (code: number, data: unknown) => {
      res.statusCode = code;
      res.end(JSON.stringify(data));
    };
    if (url.pathname === "/test-stats")
      return send(200, { counts, latency, timings, summary: prepared.summary });
    const name = url.pathname.split("/").pop() ?? "";
    counts[name] = (counts[name] ?? 0) + 1;
    const start = performance.now();
    try {
      let result: unknown;
      if (
        req.method === "POST" &&
        ["chaos_dashboard_runs", "chaos_dashboard_page"].includes(name)
      ) {
        let text = "";
        for await (const chunk of req) {
          text += chunk;
          if (text.length > 2000) throw new Error("Request limit");
        }
        const p = JSON.parse(text || "{}");
        result =
          name === "chaos_dashboard_runs"
            ? (
                await db.query<{ r: unknown }>(
                  "SELECT chaos_dashboard_runs() r",
                )
              ).rows[0].r
            : (
                await db.query<{ r: unknown }>(
                  "SELECT chaos_dashboard_page($1,$2,$3,$4,$5) r",
                  [p.p_run, p.p_page, p.p_search, p.p_category, p.p_urgency],
                )
              ).rows[0].r;
      } else if (req.method === "GET" && tables.has(name)) {
        const columns = url.searchParams.get("select") ?? "",
          order = url.searchParams.get("order")?.split(".")[0] ?? "id";
        if (!/^[a-z_,]+$/.test(columns) || !/^[a-z_]+$/.test(order))
          throw new Error("Invalid projection");
        const key = name === "chaos_import_runs" ? "id" : "import_run_id",
          value = url.searchParams.get(key);
        if (!value?.startsWith("eq.cimp_run_"))
          throw new Error("Missing scope");
        const limit = Math.min(32, Number(url.searchParams.get("limit") ?? 32));
        result = (
          await db.query(
            `SELECT ${columns} FROM ${name} WHERE ${key}=$1 ORDER BY ${order} LIMIT $2`,
            [value.slice(3), limit],
          )
        ).rows;
      } else
        return send(405, {
          message: "Local fixture only supports scoped Chaos reads",
        });
      (latency[name] ??= []).push(performance.now() - start);
      send(200, result);
    } catch {
      send(400, { message: "Local fixture query failed" });
    }
  },
);
server.listen(5443, "127.0.0.1", () => {
  writeFileSync(
    "/tmp/resq-fixture-ready.json",
    JSON.stringify({ summary: prepared.summary, timings }),
  );
  console.log("Disposable Chaos test database ready on loopback:5443");
});
process.on("SIGTERM", () =>
  server.close(() => {
    void db.close().then(() => process.exit(0));
  }),
);
