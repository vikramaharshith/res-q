import {
  FORBIDDEN_SIMULATION_KEYS,
  REPORT_CATEGORIES,
  URGENCY_LEVELS,
} from "@/lib/simulation-import/types";
export const IMPORT_RUN_PATTERN = /^cimp_run_[a-f0-9]{32}$/;
export interface ChaosRunOption {
  id: string;
  label: string;
  runId: string;
  destination: string | null;
}
export interface ChaosPageQuery {
  run: string;
  page: number;
  search: string;
  category: string;
  urgency: string;
}
export interface ChaosReportSummary {
  ordinal: number;
  report_id: string;
  category: string;
  urgency: string | null;
  narrative: string;
  received_at: string;
  grid_x: number;
  grid_y: number;
  district: string | null;
}
export interface ChaosLargePage {
  run: { id: string; label: string; runId: string };
  counts: {
    emergency: number;
    operational: number;
    units: number;
    assignments: number;
  };
  matched: number;
  page: number;
  pageSize: 50;
  reports: ChaosReportSummary[];
  bounds: {
    xmin: number | null;
    xmax: number | null;
    ymin: number | null;
    ymax: number | null;
  };
  cells: { cx: number; cy: number; n: number }[];
}
export type ChaosLargeLoad =
  | { ok: true; data: ChaosLargePage; query: ChaosPageQuery }
  | { ok: false; message: string };
export function parseChaosPageQuery(
  params: Record<string, unknown>,
  defaultRun: string,
): ChaosPageQuery {
  const run = params.run ?? defaultRun,
    page = params.page ?? "0",
    search = params.search ?? "",
    category = params.category ?? "",
    urgency = params.urgency ?? "";
  if (
    typeof run !== "string" ||
    !IMPORT_RUN_PATTERN.test(run) ||
    typeof page !== "string" ||
    !/^(0|[1-9][0-9]{0,2})$/.test(page) ||
    Number(page) > 199 ||
    typeof search !== "string" ||
    search.length > 120 ||
    typeof category !== "string" ||
    (category !== "" &&
      !REPORT_CATEGORIES.includes(
        category as (typeof REPORT_CATEGORIES)[number],
      )) ||
    typeof urgency !== "string" ||
    (urgency !== "" &&
      !URGENCY_LEVELS.includes(urgency as (typeof URGENCY_LEVELS)[number]))
  )
    throw new Error("Invalid Chaos filters or page.");
  return { run, page: Number(page), search: search.trim(), category, urgency };
}
const forbidden = new Set<string>([
  ...FORBIDDEN_SIMULATION_KEYS,
  "replay_manifest",
  "replayManifest",
  "source_seed",
  "seed",
  "latitude",
  "longitude",
]);
function scan(value: unknown, depth = 0): void {
  if (depth > 12) throw new Error("Invalid public read depth.");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) throw new Error("Private metadata in public read.");
    scan(child, depth + 1);
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid public read.");
  return value as Record<string, unknown>;
}
function str(value: unknown, max = 200): string {
  if (typeof value !== "string" || !value.length || value.length > max)
    throw new Error("Invalid public text.");
  return value;
}
function num(value: unknown, min: number, max: number, integer = true): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new Error("Invalid public number.");
  return value;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error("Unbounded public list.");
  return value;
}
export function parseChaosRuns(value: unknown): ChaosRunOption[] {
  scan(value);
  const runs = list(value, 100).map((item) => {
    const r = record(item),
      id = str(r.id);
    if (!IMPORT_RUN_PATTERN.test(id)) throw new Error("Invalid import run.");
    return {
      id,
      label: str(r.label, 2000),
      runId: str(r.runId),
      destination: r.destination === null ? null : str(r.destination),
    };
  });
  if (new Set(runs.map((r) => r.id)).size !== runs.length)
    throw new Error("Duplicate runs.");
  return runs;
}
export function parseChaosLargePage(
  value: unknown,
  query: ChaosPageQuery,
): ChaosLargePage {
  scan(value);
  const v = record(value),
    run = record(v.run),
    c = record(v.counts),
    b = record(v.bounds);
  if (run.id !== query.run || v.page !== query.page || v.pageSize !== 50)
    throw new Error("Cross-run or page response.");
  const counts = {
    emergency: num(c.emergency, 0, 10000),
    operational: num(c.operational, 0, 10000),
    units: num(c.units, 0, 10000),
    assignments: num(c.assignments, 0, 10000),
  };
  const matched = num(v.matched, 0, counts.emergency);
  const reports = list(v.reports, 50).map((item) => {
    const r = record(item),
      category = str(r.category),
      urgency = r.urgency === null ? null : str(r.urgency);
    if (
      !REPORT_CATEGORIES.includes(
        category as (typeof REPORT_CATEGORIES)[number],
      ) ||
      (urgency !== null &&
        !URGENCY_LEVELS.includes(urgency as (typeof URGENCY_LEVELS)[number]))
    )
      throw new Error("Invalid public enum.");
    return {
      ordinal: num(r.ordinal, 0, 9999),
      report_id: str(r.report_id),
      category,
      urgency,
      narrative: str(r.narrative, 20000),
      received_at: str(r.received_at, 40),
      grid_x: num(r.grid_x, -1000000, 1000000, false),
      grid_y: num(r.grid_y, -1000000, 1000000, false),
      district: r.district === null ? null : str(r.district, 2000),
    };
  });
  if (
    reports.length !== Math.min(50, Math.max(0, matched - query.page * 50)) ||
    reports.some((r, i) => i > 0 && r.ordinal <= reports[i - 1].ordinal)
  )
    throw new Error("Incomplete public page.");
  const cells = list(v.cells, 400).map((item) => {
    const c = record(item);
    return {
      cx: num(c.cx, 0, 19),
      cy: num(c.cy, 0, 19),
      n: num(c.n, 1, 10000),
    };
  });
  if (
    cells.reduce((sum, c) => sum + c.n, 0) !== matched ||
    new Set(cells.map((c) => `${c.cx}:${c.cy}`)).size !== cells.length
  )
    throw new Error("Incomplete grid aggregate.");
  const bound = (value: unknown) =>
    value === null && matched === 0
      ? null
      : num(value, -1000000, 1000000, false);
  return {
    run: { id: query.run, label: str(run.label, 2000), runId: str(run.runId) },
    counts,
    matched,
    page: query.page,
    pageSize: 50,
    reports,
    bounds: {
      xmin: bound(b.xmin),
      xmax: bound(b.xmax),
      ymin: bound(b.ymin),
      ymax: bound(b.ymax),
    },
    cells,
  };
}
export function chaosPageHref(query: ChaosPageQuery, page: number): string {
  return `/?${new URLSearchParams({ scenario: "chaos", run: query.run, page: String(page), search: query.search, category: query.category, urgency: query.urgency })}`;
}
