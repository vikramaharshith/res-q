import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEMO_SCENARIO } from "@/lib/demo/scenario";
import {
  INCIDENT_CATEGORIES,
  INCIDENT_PRIORITIES,
  INCIDENT_STATUSES,
  RESPONDER_AVAILABILITIES,
  SAMPLE_KEYS,
  type Scenario,
} from "@/lib/demo/types";

/**
 * Upserts the deterministic Demo City flood into Supabase.
 * The default is a dry-run: validate the generated scenario and print the
 * column mapping, without opening a connection. `--apply` writes with a
 * server-only secret key. The publishable key is never read, and RLS is
 * left unchanged.
 */

const SCENARIO_ID = "scn_demo_flood";
const EXPECTED_COUNTS = {
  incidents: 67,
  reports: 100,
  responders: 12,
  assignments: 9,
} as const;

const ASSIGNMENT_STATUSES = ["ASSIGNED", "IN_PROGRESS", "COMPLETED"] as const;
const WRITE_ORDER = [
  "scenarios",
  "incidents",
  "responders",
  "reports",
  "assignments",
] as const;

type WriteTable = (typeof WRITE_ORDER)[number];
type SqlValue = string | number | boolean | null | string[];
type SqlRow = Record<string, SqlValue>;

const WRITABLE_COLUMNS: Record<WriteTable, readonly string[]> = {
  scenarios: ["id", "name", "description", "seed", "is_active"],
  incidents: [
    "id",
    "scenario_id",
    "title",
    "description",
    "category",
    "district",
    "latitude",
    "longitude",
    "priority",
    "priority_basis",
    "status",
    "low_detail",
    "sample_key",
    "report_ids",
    "created_at",
    "updated_at",
  ],
  responders: [
    "id",
    "scenario_id",
    "callsign",
    "name",
    "capabilities",
    "specialty",
    "availability",
    "status",
    "latitude",
    "longitude",
    "updated_at",
  ],
  reports: [
    "id",
    "scenario_id",
    "incident_id",
    "source",
    "raw_text",
    "message",
    "reported_lat",
    "reported_lon",
    "latitude",
    "longitude",
    "received_at",
    "analysis_status",
  ],
  assignments: [
    "id",
    "incident_id",
    "responder_id",
    "status",
    "assigned_at",
    "origin",
    "note",
  ],
};

const SERVER_ENV_KEYS = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

type ServerEnvKey = (typeof SERVER_ENV_KEYS)[number];

interface ImportPlan {
  rows: Record<WriteTable, SqlRow[]>;
}

class ImportUsageError extends Error {}

function webRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function sameColumns(row: SqlRow, columns: readonly string[]): boolean {
  const actual = Object.keys(row).sort();
  const expected = [...columns].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function hasMember(values: readonly string[], value: string): boolean {
  return values.some((item) => item === value);
}

function requireText(value: string, label: string, errors: string[]): void {
  if (!value.trim()) errors.push(`${label} is empty`);
}

function requireFinite(value: number, label: string, errors: string[]): void {
  if (!Number.isFinite(value)) errors.push(`${label} is not a finite number`);
}

function requireTimestamp(value: string, label: string, errors: string[]): void {
  if (!Number.isFinite(Date.parse(value))) errors.push(`${label} is not a timestamp`);
}

function requireCoordinate(lat: number, lon: number, label: string, errors: string[]): void {
  requireFinite(lat, `${label} latitude`, errors);
  requireFinite(lon, `${label} longitude`, errors);
  if (lat < -90 || lat > 90) errors.push(`${label} latitude is out of range`);
  if (lon < -180 || lon > 180) errors.push(`${label} longitude is out of range`);
}

function duplicateIds(rows: SqlRow[], label: string): string | null {
  const seen = new Set<string>();
  for (const row of rows) {
    const id = row.id;
    if (typeof id !== "string" || !id) return `${label} row is missing id`;
    if (seen.has(id)) return `${label} id ${id} is duplicated`;
    seen.add(id);
  }
  return null;
}

function buildPlan(scenario: Scenario): ImportPlan {
  return {
    rows: {
      scenarios: [
        {
          id: scenario.id,
          name: scenario.name,
          description: scenario.description,
          seed: scenario.seed,
          is_active: true,
        },
      ],
      incidents: scenario.incidents.map((incident) => ({
        id: incident.id,
        scenario_id: incident.scenarioId,
        title: incident.summary,
        description: incident.summary,
        category: incident.category,
        district: incident.district,
        latitude: incident.lat,
        longitude: incident.lon,
        priority: incident.priority,
        priority_basis: incident.priorityBasis,
        status: incident.status,
        low_detail: incident.lowDetail,
        sample_key: incident.sampleKey ?? null,
        report_ids: [...incident.reportIds],
        created_at: incident.createdAt,
        updated_at: incident.updatedAt,
      })),
      responders: scenario.responders.map((responder) => ({
        id: responder.id,
        scenario_id: responder.scenarioId,
        callsign: responder.callsign,
        name: responder.callsign,
        capabilities: [...responder.capabilities],
        specialty: responder.capabilities.join(", "),
        availability: responder.availability,
        status: responder.availability,
        latitude: responder.lat,
        longitude: responder.lon,
        updated_at: responder.updatedAt,
      })),
      reports: scenario.reports.map((report) => ({
        id: report.id,
        scenario_id: report.scenarioId,
        incident_id: report.incidentId,
        source: report.source,
        raw_text: report.rawText,
        message: report.rawText,
        reported_lat: report.reportedLat,
        reported_lon: report.reportedLon,
        latitude: report.reportedLat,
        longitude: report.reportedLon,
        received_at: report.receivedAt,
        analysis_status: report.analysisStatus,
      })),
      assignments: scenario.assignments.map((assignment) => ({
        id: assignment.id,
        incident_id: assignment.incidentId,
        responder_id: assignment.responderId,
        status: assignment.status,
        assigned_at: assignment.assignedAt,
        origin: assignment.origin,
        note: assignment.note,
      })),
    },
  };
}

function validate(scenario: Scenario, plan: ImportPlan): string[] {
  const errors: string[] = [];
  if (scenario.id !== SCENARIO_ID) errors.push(`scenario id is ${scenario.id}`);
  if (scenario.incidents.length !== EXPECTED_COUNTS.incidents) {
    errors.push(`expected ${EXPECTED_COUNTS.incidents} incidents, found ${scenario.incidents.length}`);
  }
  if (scenario.reports.length !== EXPECTED_COUNTS.reports) {
    errors.push(`expected ${EXPECTED_COUNTS.reports} reports, found ${scenario.reports.length}`);
  }
  if (scenario.responders.length !== EXPECTED_COUNTS.responders) {
    errors.push(`expected ${EXPECTED_COUNTS.responders} responders, found ${scenario.responders.length}`);
  }
  if (scenario.assignments.length !== EXPECTED_COUNTS.assignments) {
    errors.push(`expected ${EXPECTED_COUNTS.assignments} assignments, found ${scenario.assignments.length}`);
  }
  requireText(scenario.name, "scenario name", errors);
  requireText(scenario.description, "scenario description", errors);
  if (!Number.isInteger(scenario.seed)) errors.push("scenario seed is not an integer");

  for (const table of WRITE_ORDER) {
    const columns = WRITABLE_COLUMNS[table];
    for (const row of plan.rows[table]) {
      if (!sameColumns(row, columns)) {
        errors.push(`${table} payload does not match the column map`);
        break;
      }
    }
    const duplicate = duplicateIds(plan.rows[table], table);
    if (duplicate) errors.push(duplicate);
  }

  const incidentIds = new Set(scenario.incidents.map((incident) => incident.id));
  const reportIds = new Set(scenario.reports.map((report) => report.id));
  const responderIds = new Set(scenario.responders.map((responder) => responder.id));

  for (const incident of scenario.incidents) {
    if (incident.scenarioId !== scenario.id) errors.push(`${incident.id} scenario mismatch`);
    if (!incident.id.startsWith("inc_")) errors.push(`${incident.id} has an unexpected id`);
    requireText(incident.summary, `${incident.id} summary`, errors);
    requireText(incident.district, `${incident.id} district`, errors);
    requireText(incident.priorityBasis, `${incident.id} priority basis`, errors);
    requireCoordinate(incident.lat, incident.lon, incident.id, errors);
    requireTimestamp(incident.createdAt, `${incident.id} createdAt`, errors);
    requireTimestamp(incident.updatedAt, `${incident.id} updatedAt`, errors);
    if (!hasMember(INCIDENT_CATEGORIES, incident.category)) {
      errors.push(`${incident.id} category ${incident.category}`);
    }
    if (!hasMember(INCIDENT_PRIORITIES, incident.priority)) {
      errors.push(`${incident.id} priority ${incident.priority}`);
    }
    if (!hasMember(INCIDENT_STATUSES, incident.status)) {
      errors.push(`${incident.id} status ${incident.status}`);
    }
    if (incident.sampleKey !== undefined && !hasMember(SAMPLE_KEYS, incident.sampleKey)) {
      errors.push(`${incident.id} sample ${incident.sampleKey}`);
    }
    if (incident.reportIds.length === 0) errors.push(`${incident.id} has no reports`);
    const linked = scenario.reports.filter((report) => report.incidentId === incident.id);
    if (linked.length !== incident.reportIds.length) {
      errors.push(`${incident.id} report link count mismatch`);
    }
    for (const reportId of incident.reportIds) {
      if (!reportIds.has(reportId)) errors.push(`${incident.id} missing ${reportId}`);
    }
  }

  for (const report of scenario.reports) {
    if (report.scenarioId !== scenario.id) errors.push(`${report.id} scenario mismatch`);
    if (!report.id.startsWith("rpt_")) errors.push(`${report.id} has an unexpected id`);
    if (!incidentIds.has(report.incidentId)) errors.push(`${report.id} incident is missing`);
    if (report.source !== "seed") errors.push(`${report.id} source is ${report.source}`);
    if (report.analysisStatus !== "NOT_AI_REVIEWED") {
      errors.push(`${report.id} analysis status is ${report.analysisStatus}`);
    }
    requireText(report.rawText, `${report.id} text`, errors);
    requireCoordinate(report.reportedLat, report.reportedLon, report.id, errors);
    requireTimestamp(report.receivedAt, `${report.id} receivedAt`, errors);
  }

  for (const responder of scenario.responders) {
    if (responder.scenarioId !== scenario.id) errors.push(`${responder.id} scenario mismatch`);
    if (!responder.id.startsWith("unit_")) errors.push(`${responder.id} has an unexpected id`);
    requireText(responder.callsign, `${responder.id} callsign`, errors);
    if (responder.capabilities.length === 0) errors.push(`${responder.id} has no capabilities`);
    for (const capability of responder.capabilities) requireText(capability, `${responder.id} capability`, errors);
    if (!hasMember(RESPONDER_AVAILABILITIES, responder.availability)) {
      errors.push(`${responder.id} availability ${responder.availability}`);
    }
    requireCoordinate(responder.lat, responder.lon, responder.id, errors);
    requireTimestamp(responder.updatedAt, `${responder.id} updatedAt`, errors);
  }

  for (const assignment of scenario.assignments) {
    if (!assignment.id.startsWith("asn_")) errors.push(`${assignment.id} has an unexpected id`);
    if (!incidentIds.has(assignment.incidentId)) errors.push(`${assignment.id} incident is missing`);
    if (!responderIds.has(assignment.responderId)) errors.push(`${assignment.id} responder is missing`);
    if (!hasMember(ASSIGNMENT_STATUSES, assignment.status)) {
      errors.push(`${assignment.id} status ${assignment.status}`);
    }
    if (assignment.origin !== "scenario_baseline") errors.push(`${assignment.id} origin ${assignment.origin}`);
    requireText(assignment.note, `${assignment.id} note`, errors);
    requireTimestamp(assignment.assignedAt, `${assignment.id} assignedAt`, errors);
  }

  return errors;
}

function printPlan(plan: ImportPlan): void {
  console.log("RES-Q demo scenario import");
  console.log("Mode: dry-run");
  console.log("Writes: none");
  console.log("");
  console.log(`Scenario: ${SCENARIO_ID}`);
  console.log("Upsert order, by primary key id:");
  for (const table of WRITE_ORDER) {
    const count = String(plan.rows[table].length).padStart(3, " ");
    console.log(`  ${count}  ${table}`);
  }
  console.log("");
  console.log("Columns written:");
  for (const table of WRITE_ORDER) {
    console.log(`  ${table}: ${WRITABLE_COLUMNS[table].join(", ")}`);
  }
  console.log("");
  console.log("Derived columns:");
  console.log("  scenarios.is_active = true for this scenario row only");
  console.log("  incidents.title and incidents.description = summary");
  console.log("  incidents.latitude/longitude = lat/lon");
  console.log("  reports.message = rawText");
  console.log("  reports.latitude/longitude = reportedLat/reportedLon");
  console.log("  responders.name = callsign");
  console.log("  responders.specialty = capabilities joined with a comma");
  console.log("  responders.status = availability");
  console.log("");
  console.log("Not stored on scenarios, because those columns do not exist:");
  console.log("  disasterType, fictionalLocation, mapCenter");
  console.log("");
  console.log("Left unchanged: other scenarios, agent_runs, approval_actions, and created_at values already stored.");
  console.log("No connection was opened.");
}

function redact(value: string): string {
  return value
    .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

function readEnvFile(filePath: string, into: Map<ServerEnvKey, string>): void {
  let text = "";
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    if (!hasMember(SERVER_ENV_KEYS, name)) continue;
    const key = name as ServerEnvKey;
    if (into.has(key)) continue;
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) into.set(key, value);
  }
}

function serverEnv(): Map<ServerEnvKey, string> {
  const values = new Map<ServerEnvKey, string>();
  for (const key of SERVER_ENV_KEYS) {
    const current = process.env[key]?.trim();
    if (current) values.set(key, current);
  }
  const root = webRoot();
  readEnvFile(path.join(root, ".env.local"), values);
  readEnvFile(path.join(root, "..", ".env.local"), values);
  return values;
}

function jwtRole(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
      role?: unknown;
    };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function serverCredential(values: Map<ServerEnvKey, string>): string {
  const secret = values.get("SUPABASE_SECRET_KEY") || values.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!secret) {
    throw new Error(
      "Set SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY in the server environment. The publishable key is not used, and no rows were written.",
    );
  }
  if (secret.startsWith("sb_publishable_") || secret.startsWith("sb_anon_")) {
    throw new Error(
      "The server credential is a publishable key. Set SUPABASE_SECRET_KEY to the server-only secret. No rows were written.",
    );
  }
  if (secret.startsWith("eyJ")) {
    const role = jwtRole(secret);
    if (role !== "service_role") {
      throw new Error(
        "The server credential is not a Supabase service-role key. No rows were written.",
      );
    }
  }
  return secret;
}

function supabaseUrl(values: Map<ServerEnvKey, string>): string {
  const raw = values.get("SUPABASE_URL") || values.get("NEXT_PUBLIC_SUPABASE_URL") || "";
  if (!raw) {
    throw new Error(
      "Set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL. No rows were written.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("The Supabase URL is not a valid URL. No rows were written.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search) {
    throw new Error("The Supabase URL must be an https origin without credentials. No rows were written.");
  }
  return parsed.origin;
}

function chunks<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function upsertTable(
  client: SupabaseClient,
  table: WriteTable,
  rows: SqlRow[],
): Promise<void> {
  for (const batch of chunks(rows, 100)) {
    const first = batch[0]?.id;
    const last = batch[batch.length - 1]?.id;
    const { error } = await client.from(table).upsert(batch, {
      onConflict: "id",
      defaultToNull: false,
    });
    if (error) {
      const detail = redact(
        [error.code, error.message, error.details, error.hint].filter(Boolean).join(" — "),
      ).slice(0, 500);
      throw new Error(`${table} ${String(first)}..${String(last)} failed: ${detail}`);
    }
  }
}

async function applyPlan(plan: ImportPlan): Promise<void> {
  const values = serverEnv();
  const url = supabaseUrl(values);
  const credential = serverCredential(values);
  const client = createClient(url, credential, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  console.log("RES-Q demo scenario import");
  console.log("Mode: apply");
  console.log(`Host: ${new URL(url).host}`);
  for (const table of WRITE_ORDER) {
    await upsertTable(client, table, plan.rows[table]);
    console.log(`Upserted ${plan.rows[table].length} ${table}`);
  }
  console.log("Other scenarios, agent_runs, and approval_actions were not modified.");
}

function parseMode(argv: string[]): "dry-run" | "apply" {
  const unknown = argv.filter((arg) => arg !== "--dry-run" && arg !== "--apply");
  if (unknown.length > 0) {
    throw new ImportUsageError(`Unknown argument ${unknown[0]}. Use --dry-run or --apply.`);
  }
  if (argv.includes("--dry-run") && argv.includes("--apply")) {
    throw new ImportUsageError("Use either --dry-run or --apply.");
  }
  return argv.includes("--apply") ? "apply" : "dry-run";
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const plan = buildPlan(DEMO_SCENARIO);
  const errors = validate(DEMO_SCENARIO, plan);
  if (errors.length > 0) {
    console.error("Scenario import failed validation:");
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  if (mode === "dry-run") {
    printPlan(plan);
    return;
  }
  await applyPlan(plan);
}

try {
  await main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : "Import failed";
  console.error(redact(message));
  process.exitCode = error instanceof ImportUsageError ? 2 : 1;
}
