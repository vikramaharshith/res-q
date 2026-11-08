import { createHash } from "node:crypto";

import { redactServerText } from "@/lib/security/redact";
import { MemoryImportLedger } from "@/lib/simulation-import/ledger";
import {
  DEMO_SCENARIO_ID,
  MemoryStagingStore,
  planBelongsToRun,
  stageValidatedChaosText,
  type ChaosEmergencyRow,
  type ChaosImportRunRow,
  type ChaosOperationalRow,
  type ChaosPublicAssignmentRow,
  type ChaosSourceIdRow,
  type ChaosStagingPlan,
  type ChaosUnitRow,
  type StageRejectionCode,
  type StagingStore,
} from "@/lib/simulation-import/stage-plan";
import { FORBIDDEN_SIMULATION_KEYS, type ImportLedger } from "@/lib/simulation-import/types";

/**
 * Prepares the two-report handoff export for stage_chaos_import.
 * Dry-run is the default. This module does not open a database connection.
 */

export const STAGE_CHAOS_IMPORT_RPC = "stage_chaos_import";
export const SAMPLE_CHAOS_DESTINATION = "scn_chaos_sample";
export const SAMPLE_IMPORT_APPROVAL = "sample-two-report";
export const SAMPLE_CHAOS_RUN_ID = "run_19kluv9nadmt1";
export const SAMPLE_CHAOS_SOURCE_SCENARIO_ID = "cli-flood-v1";
export const SAMPLE_CHAOS_DIGEST_HEX = "dd07bf2c2799731bd1ef2054766b605ddc020c3a00f165fdbce003b5825f862f";
export const SAMPLE_CHAOS_BYTES = 8394;
export const SAMPLE_CHAOS_SEED = "resq-handoff-sample";
export const SAMPLE_REPORT_IDS = [
  "rpt_19kluv9nadmt1_0000000_13zzmfq",
  "rpt_19kluv9nadmt1_0000001_1fd2h9f",
] as const;

export const CHAOS_PAYLOAD_KEYS = [
  "destinationScenarioId",
  "run",
  "emergencyObservations",
  "operationalObservations",
  "units",
  "chaosPublicAssignments",
  "sourceIds",
] as const;

export const CHAOS_RUN_COLUMNS = [
  "id",
  "schema_version",
  "engine_version",
  "run_id",
  "digest_algorithm",
  "digest_hex",
  "idempotency_key",
  "byte_length",
  "source_scenario_id",
  "source_seed",
  "source_label",
  "fictional",
  "difficulty",
  "simulation_start",
  "simulation_export",
  "simulation_status",
  "emergency_count",
  "operational_count",
  "unit_count",
  "assignment_count",
  "first_received_at",
  "last_received_at",
  "replay_manifest",
] as const;

export const CHAOS_EMERGENCY_COLUMNS = [
  "import_run_id",
  "ordinal",
  "local_id",
  "report_id",
  "category",
  "source_type",
  "observed_at",
  "submitted_at",
  "received_at",
  "narrative",
  "claims",
  "status",
  "urgency",
  "source_metadata",
  "fictional",
  "coordinate_system",
  "grid_x",
  "grid_y",
  "district",
  "primary_reference",
  "secondary_reference",
  "description",
  "precision",
] as const;

export const CHAOS_OPERATIONAL_COLUMNS = [
  "import_run_id",
  "ordinal",
  "local_id",
  "observation_id",
  "unit_id",
  "assignment_id",
  "message_type",
  "observed_at",
  "submitted_at",
  "received_at",
  "source",
  "delivery_status",
  "availability_state",
  "task_status",
  "travel_status",
  "communication_state",
  "fictional",
  "coordinate_system",
  "grid_x",
  "grid_y",
  "district",
  "primary_reference",
  "secondary_reference",
  "description",
  "precision",
  "route_version",
  "fatigue",
  "equipment_item",
  "equipment_condition",
  "inventory",
] as const;

export const CHAOS_UNIT_COLUMNS = [
  "import_run_id",
  "unit_id",
  "local_id",
  "callsign",
  "latest_observed_at",
  "latest_received_at",
  "availability_state",
  "assignment_id",
  "task_status",
  "travel_status",
  "communication_state",
  "fictional",
  "coordinate_system",
  "grid_x",
  "grid_y",
  "district",
  "primary_reference",
  "secondary_reference",
  "description",
  "precision",
] as const;

export const CHAOS_ASSIGNMENT_COLUMNS = [
  "import_run_id",
  "ordinal",
  "local_id",
  "assignment_id",
  "unit_id",
  "first_received_at",
] as const;

export const CHAOS_SOURCE_COLUMNS = ["import_run_id", "entity_kind", "source_id", "local_id"] as const;

const RPC_MESSAGES = {
  PAYLOAD_REJECTED: "The staging payload does not match the public import identity.",
  PAYLOAD_LIMIT: "The staging payload exceeds 33554432 bytes.",
  DESTINATION_FORBIDDEN: "scn_demo_flood cannot be an import destination.",
  EMERGENCY_LIMIT: "The first staging writer accepts at most 10000 emergency observations.",
  OPERATIONAL_LIMIT: "The staging writer accepts at most 10000 operational observations.",
  UNIT_LIMIT: "The staging writer accepts at most 10000 units.",
  ASSIGNMENT_LIMIT: "The staging writer accepts at most 10000 public assignments.",
  SOURCE_LIMIT: "The staging writer accepts at most 40001 source-id rows.",
  CROSS_RUN_REJECTED: "Staging rows must belong to this import run.",
  CHILD_ID_CONFLICT: "A staging identifier collided with an existing row. Nothing was written.",
  DUPLICATE_IMPORT: "This artifact was already imported.",
  RUN_DIGEST_CONFLICT: "A different artifact for this run was already imported and requires manual review.",
} as const;

const REJECTION_CODES = new Set<string>([
  "PAYLOAD_REJECTED",
  "PAYLOAD_LIMIT",
  "DESTINATION_FORBIDDEN",
  "EMERGENCY_LIMIT",
  "OPERATIONAL_LIMIT",
  "UNIT_LIMIT",
  "ASSIGNMENT_LIMIT",
  "SOURCE_LIMIT",
  "CROSS_RUN_REJECTED",
  "CHILD_ID_CONFLICT",
]);

const FORBIDDEN_PAYLOAD_KEYS = new Set<string>([...FORBIDDEN_SIMULATION_KEYS, "latitude", "longitude", "publicAssignmentWrites"]);

export interface StageChaosImportPayload {
  readonly destinationScenarioId: string;
  readonly run: ChaosImportRunRow;
  readonly emergencyObservations: readonly ChaosEmergencyRow[];
  readonly operationalObservations: readonly ChaosOperationalRow[];
  readonly units: readonly ChaosUnitRow[];
  readonly chaosPublicAssignments: readonly ChaosPublicAssignmentRow[];
  readonly sourceIds: readonly ChaosSourceIdRow[];
}

export interface ChaosImportSummary {
  readonly rpc: typeof STAGE_CHAOS_IMPORT_RPC;
  readonly destinationScenarioId: string;
  readonly importRunId: string;
  readonly runId: string;
  readonly schemaVersion: string;
  readonly digestAlgorithm: "SHA-256";
  readonly digestHex: string;
  readonly idempotencyKey: string;
  readonly byteLength: number;
  readonly sourceScenarioId: string;
  readonly emergencyCount: number;
  readonly operationalCount: number;
  readonly unitCount: number;
  readonly assignmentCount: number;
  readonly reportIds: readonly string[];
  readonly payloadBytes: number;
  readonly payloadSha256: string;
}

export type ChaosImportCode =
  | StageRejectionCode
  | "SAMPLE_SHAPE"
  | "APPLY_REFUSED"
  | "RPC_FAILED"
  | "DRY_RUN"
  | "STAGED";

export interface ChaosImportRpcResponse {
  readonly data: unknown;
  readonly error: { readonly code?: string; readonly message?: string } | null;
}

export type ChaosImportExecutor = (payload: StageChaosImportPayload) => Promise<ChaosImportRpcResponse>;

export type ChaosImportAttempt =
  | {
      readonly ok: true;
      readonly mode: "dry-run";
      readonly outcome: "ready";
      readonly code: "DRY_RUN";
      readonly invoked: false;
      readonly databaseWrites: false;
      readonly externalCalls: false;
      readonly remoteChecked: false;
      readonly payload: StageChaosImportPayload;
      readonly summary: ChaosImportSummary;
    }
  | {
      readonly ok: false;
      readonly mode: "dry-run" | "apply";
      readonly outcome: "duplicate" | "review" | "rejected";
      readonly code: ChaosImportCode;
      readonly message: string;
      readonly invoked: boolean;
      readonly databaseWrites: false;
      readonly externalCalls: boolean;
      readonly remoteChecked: boolean;
    }
  | {
      readonly ok: true;
      readonly mode: "apply";
      readonly outcome: "staged";
      readonly code: "STAGED";
      readonly invoked: true;
      readonly databaseWrites: true;
      readonly externalCalls: true;
      readonly remoteChecked: true;
      readonly importRunId: string;
    };

export interface PreparedChaosImport {
  readonly ok: true;
  readonly payload: StageChaosImportPayload;
  readonly summary: ChaosImportSummary;
}

interface PreparedFailure {
  readonly ok: false;
  readonly outcome: "duplicate" | "review" | "rejected";
  readonly code: ChaosImportCode;
  readonly message: string;
}

export type SamplePreparation = PreparedChaosImport | PreparedFailure;

function failure(
  outcome: "duplicate" | "review" | "rejected",
  code: ChaosImportCode,
  message: string,
): PreparedFailure {
  return { ok: false, outcome, code, message };
}

function sameColumns(value: object, columns: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === columns.length && columns.every((column) => keys.includes(column));
}

function unsafeValue(value: unknown): boolean {
  if (value === DEMO_SCENARIO_ID) return true;
  if (typeof value === "string" && value.startsWith("asn_")) return true;
  if (Array.isArray(value)) return value.some((item) => unsafeValue(item));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_PAYLOAD_KEYS.has(key) || unsafeValue(child));
}

function localIdentifiers(payload: StageChaosImportPayload): string[] {
  return [
    payload.run.id,
    ...payload.emergencyObservations.map((row) => row.local_id),
    ...payload.operationalObservations.map((row) => row.local_id),
    ...payload.units.map((row) => row.local_id),
    ...payload.chaosPublicAssignments.map((row) => row.local_id),
    ...payload.sourceIds.map((row) => row.local_id),
  ];
}

/** The JSON object stage_chaos_import reads. Extra plan fields stay out. */
export function stageChaosImportPayload(plan: ChaosStagingPlan): StageChaosImportPayload {
  const payload = {
    destinationScenarioId: plan.destinationScenarioId,
    run: plan.run,
    emergencyObservations: plan.emergencyObservations,
    operationalObservations: plan.operationalObservations,
    units: plan.units,
    chaosPublicAssignments: plan.chaosPublicAssignments,
    sourceIds: plan.sourceIds,
  };
  return JSON.parse(JSON.stringify(payload)) as StageChaosImportPayload;
}

export function isSampleChaosPayload(payload: StageChaosImportPayload): boolean {
  const reportIds = payload.emergencyObservations.map((row) => row.report_id);
  const importRunId = `cimp_run_${SAMPLE_CHAOS_DIGEST_HEX.slice(0, 32)}`;
  const rowsBelong = [
    ...payload.emergencyObservations,
    ...payload.operationalObservations,
    ...payload.units,
    ...payload.chaosPublicAssignments,
    ...payload.sourceIds,
  ].every((row) => row.import_run_id === payload.run.id);
  return (
    Object.keys(payload).join(",") === CHAOS_PAYLOAD_KEYS.join(",")
    && payload.destinationScenarioId === SAMPLE_CHAOS_DESTINATION
    && sameColumns(payload.run, CHAOS_RUN_COLUMNS)
    && payload.emergencyObservations.every((row) => sameColumns(row, CHAOS_EMERGENCY_COLUMNS))
    && payload.operationalObservations.every((row) => sameColumns(row, CHAOS_OPERATIONAL_COLUMNS))
    && payload.units.every((row) => sameColumns(row, CHAOS_UNIT_COLUMNS))
    && payload.chaosPublicAssignments.every((row) => sameColumns(row, CHAOS_ASSIGNMENT_COLUMNS))
    && payload.sourceIds.every((row) => sameColumns(row, CHAOS_SOURCE_COLUMNS))
    && payload.run.id === importRunId
    && payload.run.schema_version === "resq.simulation.v1"
    && payload.run.engine_version === "0.1.0"
    && payload.run.run_id === SAMPLE_CHAOS_RUN_ID
    && payload.run.digest_algorithm === "SHA-256"
    && payload.run.digest_hex === SAMPLE_CHAOS_DIGEST_HEX
    && payload.run.idempotency_key === `resq.simulation.v1:${SAMPLE_CHAOS_RUN_ID}:${SAMPLE_CHAOS_DIGEST_HEX}`
    && payload.run.byte_length === SAMPLE_CHAOS_BYTES
    && payload.run.source_scenario_id === SAMPLE_CHAOS_SOURCE_SCENARIO_ID
    && payload.run.source_seed === SAMPLE_CHAOS_SEED
    && payload.run.fictional === true
    && payload.run.emergency_count === 2
    && payload.run.operational_count === 7
    && payload.run.unit_count === 1
    && payload.run.assignment_count === 1
    && payload.emergencyObservations.length === 2
    && payload.operationalObservations.length === 7
    && payload.units.length === 1
    && payload.chaosPublicAssignments.length === 1
    && payload.sourceIds.length === 12
    && reportIds[0] === SAMPLE_REPORT_IDS[0]
    && reportIds[1] === SAMPLE_REPORT_IDS[1]
    && rowsBelong
    && localIdentifiers(payload).every((id) => id.startsWith("cimp_") && !id.startsWith("asn_"))
    && !unsafeValue(payload)
  );
}

function summarize(payload: StageChaosImportPayload): ChaosImportSummary {
  const encoded = JSON.stringify(payload);
  return {
    rpc: STAGE_CHAOS_IMPORT_RPC,
    destinationScenarioId: payload.destinationScenarioId,
    importRunId: payload.run.id,
    runId: payload.run.run_id,
    schemaVersion: payload.run.schema_version,
    digestAlgorithm: "SHA-256",
    digestHex: payload.run.digest_hex,
    idempotencyKey: payload.run.idempotency_key,
    byteLength: payload.run.byte_length,
    sourceScenarioId: payload.run.source_scenario_id,
    emergencyCount: payload.run.emergency_count,
    operationalCount: payload.run.operational_count,
    unitCount: payload.run.unit_count,
    assignmentCount: payload.run.assignment_count,
    reportIds: payload.emergencyObservations.map((row) => row.report_id),
    payloadBytes: Buffer.byteLength(encoded),
    payloadSha256: createHash("sha256").update(encoded).digest("hex"),
  };
}

export function prepareSampleChaosImport(
  text: string,
  options: {
    readonly destinationScenarioId?: string;
    readonly store?: StagingStore;
    readonly ledger?: ImportLedger;
  } = {},
): SamplePreparation {
  const destinationScenarioId = options.destinationScenarioId ?? SAMPLE_CHAOS_DESTINATION;
  const store = options.store ?? new MemoryStagingStore();
  const ledger = options.ledger ?? new MemoryImportLedger();
  if (destinationScenarioId === DEMO_SCENARIO_ID) {
    return failure("rejected", "DESTINATION_FORBIDDEN", "scn_demo_flood cannot be an import destination.");
  }
  if (destinationScenarioId !== SAMPLE_CHAOS_DESTINATION) {
    return failure("rejected", "SAMPLE_SHAPE", "The sample import must be the two-report handoff export.");
  }
  const decision = stageValidatedChaosText(text, destinationScenarioId, store, ledger);
  if (!decision.ok) return failure(decision.outcome, decision.code, decision.message);
  if (!planBelongsToRun(decision.plan)) {
    return failure("rejected", "CROSS_RUN_REJECTED", "Staging rows must belong to this import run.");
  }
  const payload = stageChaosImportPayload(decision.plan);
  if (!isSampleChaosPayload(payload)) {
    return failure("rejected", "SAMPLE_SHAPE", "The sample import must be the two-report handoff export.");
  }
  return { ok: true, payload, summary: summarize(payload) };
}

function refused(
  mode: "dry-run" | "apply",
  outcome: "duplicate" | "review" | "rejected",
  code: ChaosImportCode,
  message: string,
  invoked = false,
): Extract<ChaosImportAttempt, { ok: false }> {
  return {
    ok: false,
    mode,
    outcome,
    code,
    message,
    invoked,
    databaseWrites: false,
    externalCalls: invoked,
    remoteChecked: invoked,
  };
}

function publicRpcError(message: string | undefined): string {
  const base = "The staging call did not return a readable result. Nothing was written.";
  const redacted = redactServerText(message ?? "").replace(/\s+/g, " ").trim();
  if (!redacted || redacted.includes(SAMPLE_CHAOS_SEED)) return base;
  return `${base} ${redacted}`.slice(0, 400);
}

export function interpretStageChaosImportResult(data: unknown, importRunId: string): Exclude<ChaosImportAttempt, { mode: "dry-run" }> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return refused("apply", "rejected", "RPC_FAILED", "The staging call did not return a readable result. Nothing was written.", true);
  }
  const body = data as Record<string, unknown>;
  const code = typeof body.code === "string" ? body.code : "";
  if (
    body.ok === true
    && body.outcome === "staged"
    && code === "STAGED"
    && body.import_run_id === importRunId
  ) {
    return {
      ok: true,
      mode: "apply",
      outcome: "staged",
      code: "STAGED",
      invoked: true,
      databaseWrites: true,
      externalCalls: true,
      remoteChecked: true,
      importRunId,
    };
  }
  if (body.ok === false && body.outcome === "duplicate" && code === "DUPLICATE_IMPORT") {
    return refused("apply", "duplicate", "DUPLICATE_IMPORT", RPC_MESSAGES.DUPLICATE_IMPORT, true);
  }
  if (body.ok === false && body.outcome === "review" && code === "RUN_DIGEST_CONFLICT") {
    return refused("apply", "review", "RUN_DIGEST_CONFLICT", RPC_MESSAGES.RUN_DIGEST_CONFLICT, true);
  }
  if (body.ok === false && body.outcome === "rejected" && REJECTION_CODES.has(code)) {
    const known = RPC_MESSAGES[code as keyof typeof RPC_MESSAGES];
    return refused("apply", "rejected", code as StageRejectionCode, known, true);
  }
  return refused("apply", "rejected", "RPC_FAILED", "The staging call did not return a readable result. Nothing was written.", true);
}

/**
 * Validates the sample and returns its payload.
 * An executor runs only when mode is apply and local validation has already succeeded.
 */
export async function runControlledChaosImport(args: {
  readonly text: string;
  readonly destinationScenarioId?: string;
  readonly mode?: "dry-run" | "apply";
  readonly store?: StagingStore;
  readonly ledger?: ImportLedger;
  readonly execute?: ChaosImportExecutor;
}): Promise<ChaosImportAttempt> {
  const mode = args.mode ?? "dry-run";
  const prepared = prepareSampleChaosImport(args.text, {
    destinationScenarioId: args.destinationScenarioId,
    store: args.store,
    ledger: args.ledger,
  });
  if (!prepared.ok) return refused(mode, prepared.outcome, prepared.code, prepared.message);
  if (mode === "dry-run") {
    return {
      ok: true,
      mode: "dry-run",
      outcome: "ready",
      code: "DRY_RUN",
      invoked: false,
      databaseWrites: false,
      externalCalls: false,
      remoteChecked: false,
      payload: prepared.payload,
      summary: prepared.summary,
    };
  }
  if (!args.execute) {
    return refused("apply", "rejected", "APPLY_REFUSED", "Live import was not approved. Nothing was written.");
  }
  let response: ChaosImportRpcResponse;
  try {
    response = await args.execute(prepared.payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : undefined;
    return refused("apply", "rejected", "RPC_FAILED", publicRpcError(message), true);
  }
  if (response.error) return refused("apply", "rejected", "RPC_FAILED", publicRpcError(response.error.message), true);
  return interpretStageChaosImportResult(response.data, prepared.payload.run.id);
}

/** Live RPC is allowed only for an explicit apply plus the sample approval token. */
export function chaosServerCallAllowed(mode: string, approval: string | undefined): boolean {
  return mode === "apply" && approval === SAMPLE_IMPORT_APPROVAL;
}

/** The sample script accepts a dry-run and refuses every other argument. */
export function chaosImportCliMode(argv: readonly string[]): "dry-run" | "refused" {
  if (argv.every((arg) => arg === "--dry-run")) return "dry-run";
  return "refused";
}
