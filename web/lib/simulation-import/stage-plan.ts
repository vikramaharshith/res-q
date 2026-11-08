import { createHash } from "node:crypto";

import {
  MAX_IMPORT_BYTES,
  type ImportLedger,
  type PublicLocation,
  type SimulationImport,
} from "@/lib/simulation-import/types";
import { importSimulationText } from "@/lib/simulation-import/import-simulation";

export const DEMO_SCENARIO_ID = "scn_demo_flood";
export const MAX_STAGED_EMERGENCY_OBSERVATIONS = 10_000;
export const MAX_STAGED_OPERATIONAL_OBSERVATIONS = 10_000;
export const MAX_STAGED_UNITS = 10_000;
export const MAX_STAGED_ASSIGNMENTS = 10_000;
export const MAX_STAGED_SOURCE_IDS = 40_001;
export const MAX_STAGED_PAYLOAD_BYTES = MAX_IMPORT_BYTES;
export const RUN_ID_CONSTRAINT = "chaos_import_runs_run_uidx";
export const IDEMPOTENCY_CONSTRAINT = "chaos_import_runs_idempotency_uidx";

export interface ChaosImportRunRow {
  readonly id: string;
  readonly schema_version: string;
  readonly engine_version: string;
  readonly run_id: string;
  readonly digest_algorithm: "SHA-256";
  readonly digest_hex: string;
  readonly idempotency_key: string;
  readonly byte_length: number;
  readonly source_scenario_id: string;
  readonly source_seed: string;
  readonly source_label: string;
  readonly fictional: true;
  readonly difficulty: string | null;
  readonly simulation_start: string;
  readonly simulation_export: string;
  readonly simulation_status: string;
  readonly emergency_count: number;
  readonly operational_count: number;
  readonly unit_count: number;
  readonly assignment_count: number;
  readonly first_received_at: string | null;
  readonly last_received_at: string | null;
  readonly replay_manifest: SimulationImport["document"]["replayManifest"];
}

export interface ChaosGridColumns {
  readonly fictional: true | null;
  readonly coordinate_system: "SIMULATED_LOCAL_GRID" | null;
  readonly grid_x: number | null;
  readonly grid_y: number | null;
  readonly district: string | null;
  readonly primary_reference: string | null;
  readonly secondary_reference: string | null;
  readonly description: string | null;
  readonly precision: string | null;
}

export interface ChaosEmergencyRow extends ChaosGridColumns {
  readonly import_run_id: string;
  readonly ordinal: number;
  readonly local_id: string;
  readonly report_id: string;
  readonly category: string;
  readonly source_type: string;
  readonly observed_at: string;
  readonly submitted_at: string;
  readonly received_at: string;
  readonly narrative: string;
  readonly claims: SimulationImport["document"]["emergencyObservations"][number]["claims"];
  readonly status: "RECEIVED";
  readonly urgency: string | null;
  readonly source_metadata: SimulationImport["document"]["emergencyObservations"][number]["sourceMetadata"];
  readonly fictional: true;
  readonly coordinate_system: "SIMULATED_LOCAL_GRID";
  readonly grid_x: number;
  readonly grid_y: number;
  readonly description: string;
}

export interface ChaosOperationalRow extends ChaosGridColumns {
  readonly import_run_id: string;
  readonly ordinal: number;
  readonly local_id: string;
  readonly observation_id: string;
  readonly unit_id: string;
  readonly assignment_id: string | null;
  readonly message_type: string;
  readonly observed_at: string;
  readonly submitted_at: string;
  readonly received_at: string;
  readonly source: string;
  readonly delivery_status: "DELIVERED";
  readonly availability_state: string | null;
  readonly task_status: string | null;
  readonly travel_status: string | null;
  readonly communication_state: string | null;
  readonly route_version: number | null;
  readonly fatigue: number | null;
  readonly equipment_item: string | null;
  readonly equipment_condition: string | null;
  readonly inventory: Readonly<Record<string, number>> | null;
}

export interface ChaosUnitRow extends ChaosGridColumns {
  readonly import_run_id: string;
  readonly unit_id: string;
  readonly local_id: string;
  readonly callsign: string;
  readonly latest_observed_at: string;
  readonly latest_received_at: string;
  readonly availability_state: string | null;
  readonly assignment_id: string | null;
  readonly task_status: string | null;
  readonly travel_status: string | null;
  readonly communication_state: string | null;
}

export interface ChaosPublicAssignmentRow {
  readonly import_run_id: string;
  readonly ordinal: number;
  readonly local_id: string;
  readonly assignment_id: string;
  readonly unit_id: string;
  readonly first_received_at: string;
}

export interface ChaosSourceIdRow {
  readonly import_run_id: string;
  readonly entity_kind: "run" | "emergency_observation" | "operational_observation" | "unit" | "public_assignment";
  readonly source_id: string;
  readonly local_id: string;
}

export interface ChaosStagingPlan {
  readonly destinationScenarioId: string;
  readonly run: ChaosImportRunRow;
  readonly emergencyObservations: readonly ChaosEmergencyRow[];
  readonly operationalObservations: readonly ChaosOperationalRow[];
  readonly units: readonly ChaosUnitRow[];
  readonly chaosPublicAssignments: readonly ChaosPublicAssignmentRow[];
  readonly sourceIds: readonly ChaosSourceIdRow[];
  readonly publicAssignmentWrites: readonly never[];
}

export interface StagingSnapshot {
  readonly runs: readonly ChaosImportRunRow[];
  readonly emergencyObservations: readonly ChaosEmergencyRow[];
  readonly operationalObservations: readonly ChaosOperationalRow[];
  readonly units: readonly ChaosUnitRow[];
  readonly chaosPublicAssignments: readonly ChaosPublicAssignmentRow[];
  readonly sourceIds: readonly ChaosSourceIdRow[];
}

export interface StagingStore {
  findRun(schemaVersion: string, runId: string): ChaosImportRunRow | undefined;
  commit(plan: ChaosStagingPlan): void;
  read(): StagingSnapshot;
}

export type StageRejectionCode =
  | "DESTINATION_FORBIDDEN"
  | "EMERGENCY_LIMIT"
  | "OPERATIONAL_LIMIT"
  | "UNIT_LIMIT"
  | "ASSIGNMENT_LIMIT"
  | "SOURCE_LIMIT"
  | "PAYLOAD_LIMIT"
  | "PAYLOAD_REJECTED"
  | "CROSS_RUN_REJECTED"
  | "CHILD_ID_CONFLICT"
  | "DUPLICATE_IMPORT"
  | "RUN_DIGEST_CONFLICT"
  | "COMMIT_FAILED";

export interface StagePlanOptions {
  readonly maxPayloadBytes?: number;
}

export interface StagingIdentity {
  readonly digest_hex: string;
  readonly idempotency_key: string;
}

export type StageDecision =
  | { readonly ok: true; readonly outcome: "staged"; readonly plan: ChaosStagingPlan }
  | { readonly ok: false; readonly outcome: "duplicate" | "review" | "rejected"; readonly code: StageRejectionCode; readonly message: string };

function rejection(outcome: "duplicate" | "review" | "rejected", code: StageRejectionCode, message: string): StageDecision {
  return Object.freeze({ ok: false, outcome, code, message });
}

function localId(kind: string, digestHex: string, ordinal: number): string {
  return `cimp_${kind}_${digestHex.slice(0, 12)}_${ordinal}`;
}

function presentGrid(location: PublicLocation): ChaosGridColumns & {
  readonly fictional: true;
  readonly coordinate_system: "SIMULATED_LOCAL_GRID";
  readonly grid_x: number;
  readonly grid_y: number;
  readonly description: string;
} {
  return {
    fictional: true,
    coordinate_system: "SIMULATED_LOCAL_GRID",
    grid_x: location.x,
    grid_y: location.y,
    district: location.district,
    primary_reference: location.primaryReference,
    secondary_reference: location.secondaryReference,
    description: location.description,
    precision: location.precision,
  };
}

function grid(location: PublicLocation | null): ChaosGridColumns {
  if (location === null) {
    return Object.freeze({
      fictional: null,
      coordinate_system: null,
      grid_x: null,
      grid_y: null,
      district: null,
      primary_reference: null,
      secondary_reference: null,
      description: null,
      precision: null,
    });
  }
  return Object.freeze({
    fictional: true,
    coordinate_system: "SIMULATED_LOCAL_GRID",
    grid_x: location.x,
    grid_y: location.y,
    district: location.district,
    primary_reference: location.primaryReference,
    secondary_reference: location.secondaryReference,
    description: location.description,
    precision: location.precision,
  });
}

function expectedKey(simulation: SimulationImport): string {
  return `${simulation.document.schemaVersion}:${simulation.document.runId}:${simulation.source.digestHex}`;
}

function collides(existing: readonly string[], incoming: readonly string[]): boolean {
  const seen = new Set(existing);
  for (const id of incoming) {
    if (seen.has(id)) return true;
    seen.add(id);
  }
  return false;
}

/**
 * Builds the six staging row sets for one validated public export.
 * This function does not open a database connection.
 */
export function planChaosImport(
  simulation: SimulationImport,
  destinationScenarioId: string,
  store: StagingStore,
  options: StagePlanOptions = {},
): StageDecision {
  const maxPayloadBytes = options.maxPayloadBytes ?? MAX_STAGED_PAYLOAD_BYTES;
  if (destinationScenarioId === DEMO_SCENARIO_ID) {
    return rejection("rejected", "DESTINATION_FORBIDDEN", "scn_demo_flood cannot be an import destination.");
  }
  if (!Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 1) {
    return rejection("rejected", "PAYLOAD_REJECTED", "The staging payload does not match the public import identity.");
  }
  const emergencyCount = simulation.document.emergencyObservations.length;
  const operationalCount = simulation.document.operationalObservations.length;
  const unitCount = simulation.document.units.length;
  const assignmentCount = simulation.document.assignments.length;
  if (emergencyCount > MAX_STAGED_EMERGENCY_OBSERVATIONS || simulation.document.summary.emergencyObservationCount > MAX_STAGED_EMERGENCY_OBSERVATIONS) {
    return rejection("rejected", "EMERGENCY_LIMIT", "The first staging writer accepts at most 10000 emergency observations.");
  }
  if (operationalCount > MAX_STAGED_OPERATIONAL_OBSERVATIONS || simulation.document.summary.operationalObservationCount > MAX_STAGED_OPERATIONAL_OBSERVATIONS) {
    return rejection("rejected", "OPERATIONAL_LIMIT", "The staging writer accepts at most 10000 operational observations.");
  }
  if (unitCount > MAX_STAGED_UNITS || simulation.document.summary.unitCount > MAX_STAGED_UNITS) {
    return rejection("rejected", "UNIT_LIMIT", "The staging writer accepts at most 10000 units.");
  }
  if (assignmentCount > MAX_STAGED_ASSIGNMENTS || simulation.document.summary.assignmentCount > MAX_STAGED_ASSIGNMENTS) {
    return rejection("rejected", "ASSIGNMENT_LIMIT", "The staging writer accepts at most 10000 public assignments.");
  }
  if (!Number.isSafeInteger(simulation.source.byteLength) || simulation.source.byteLength < 0) {
    return rejection("rejected", "PAYLOAD_REJECTED", "The staging payload does not match the public import identity.");
  }
  if (simulation.source.byteLength > maxPayloadBytes) {
    return rejection("rejected", "PAYLOAD_LIMIT", "The staging payload exceeds 33554432 bytes.");
  }
  if (
    simulation.source.digestAlgorithm !== "SHA-256"
    || simulation.source.idempotencyKey !== expectedKey(simulation)
    || simulation.document.scenario.fictional !== true
    || simulation.document.summary.emergencyObservationCount !== emergencyCount
    || simulation.document.summary.operationalObservationCount !== operationalCount
    || simulation.document.summary.unitCount !== unitCount
    || simulation.document.summary.assignmentCount !== assignmentCount
  ) {
    return rejection("rejected", "PAYLOAD_REJECTED", "The staging payload does not match the public import identity.");
  }

  const existing = store.findRun(simulation.document.schemaVersion, simulation.document.runId);
  if (existing !== undefined) {
    if (existing.digest_hex === simulation.source.digestHex && existing.idempotency_key === simulation.source.idempotencyKey) {
      return rejection("duplicate", "DUPLICATE_IMPORT", "This artifact was already imported.");
    }
    return rejection("review", "RUN_DIGEST_CONFLICT", "A different artifact for this run was already imported and requires manual review.");
  }

  const digestHex = simulation.source.digestHex;
  const importRunId = `cimp_run_${digestHex.slice(0, 32)}`;
  const document = simulation.document;
  const sourceIds: ChaosSourceIdRow[] = [{
    import_run_id: importRunId,
    entity_kind: "run",
    source_id: document.runId,
    local_id: importRunId,
  }];
  const emergencyObservations = document.emergencyObservations.map((item, ordinal): ChaosEmergencyRow => {
    const local_id = localId("emg", digestHex, ordinal);
    sourceIds.push({ import_run_id: importRunId, entity_kind: "emergency_observation", source_id: item.reportId, local_id });
    return Object.freeze({
      import_run_id: importRunId,
      ordinal,
      local_id,
      report_id: item.reportId,
      category: item.category,
      source_type: item.sourceType,
      observed_at: item.observedAt,
      submitted_at: item.submittedAt,
      received_at: item.receivedAt,
      narrative: item.narrative,
      claims: item.claims,
      status: "RECEIVED",
      urgency: item.urgency,
      source_metadata: item.sourceMetadata,
      ...presentGrid(item.location),
    });
  });
  const units = document.units.map((item, ordinal): ChaosUnitRow => {
    const local_id = localId("unit", digestHex, ordinal);
    sourceIds.push({ import_run_id: importRunId, entity_kind: "unit", source_id: item.unitId, local_id });
    return Object.freeze({
      import_run_id: importRunId,
      unit_id: item.unitId,
      local_id,
      callsign: item.callsign,
      latest_observed_at: item.latestObservedAt,
      latest_received_at: item.latestReceivedAt,
      availability_state: item.availabilityState,
      assignment_id: item.assignmentId,
      task_status: item.taskStatus,
      travel_status: item.travelStatus,
      communication_state: item.communicationState,
      ...grid(item.location),
    });
  });
  const chaosPublicAssignments = document.assignments.map((item, ordinal): ChaosPublicAssignmentRow => {
    const local_id = localId("asg", digestHex, ordinal);
    sourceIds.push({ import_run_id: importRunId, entity_kind: "public_assignment", source_id: item.assignmentId, local_id });
    return Object.freeze({
      import_run_id: importRunId,
      ordinal,
      local_id,
      assignment_id: item.assignmentId,
      unit_id: item.unitId,
      first_received_at: item.firstReceivedAt,
    });
  });
  const operationalObservations = document.operationalObservations.map((item, ordinal): ChaosOperationalRow => {
    const local_id = localId("opr", digestHex, ordinal);
    sourceIds.push({ import_run_id: importRunId, entity_kind: "operational_observation", source_id: item.observationId, local_id });
    return Object.freeze({
      import_run_id: importRunId,
      ordinal,
      local_id,
      observation_id: item.observationId,
      unit_id: item.unitId,
      assignment_id: item.assignmentId,
      message_type: item.messageType,
      observed_at: item.observedAt,
      submitted_at: item.submittedAt,
      received_at: item.receivedAt,
      source: item.source,
      delivery_status: "DELIVERED",
      availability_state: item.content.availabilityState,
      task_status: item.content.taskStatus,
      travel_status: item.content.travelStatus,
      communication_state: item.content.communicationState,
      route_version: item.content.routeVersion,
      fatigue: item.content.fatigue,
      equipment_item: item.content.equipmentItem,
      equipment_condition: item.content.equipmentCondition,
      inventory: item.content.inventory,
      ...grid(item.content.location),
    });
  });
  const run: ChaosImportRunRow = Object.freeze({
    id: importRunId,
    schema_version: document.schemaVersion,
    engine_version: document.engineVersion,
    run_id: document.runId,
    digest_algorithm: "SHA-256",
    digest_hex: digestHex,
    idempotency_key: simulation.source.idempotencyKey,
    byte_length: simulation.source.byteLength,
    source_scenario_id: document.scenario.scenarioId,
    source_seed: document.scenario.seed,
    source_label: document.scenario.label,
    fictional: true,
    difficulty: document.scenario.difficulty,
    simulation_start: document.simulationTime.startTime,
    simulation_export: document.simulationTime.exportTime,
    simulation_status: document.simulationTime.status,
    emergency_count: document.summary.emergencyObservationCount,
    operational_count: document.summary.operationalObservationCount,
    unit_count: document.summary.unitCount,
    assignment_count: document.summary.assignmentCount,
    first_received_at: document.summary.firstReceivedAt,
    last_received_at: document.summary.lastReceivedAt,
    replay_manifest: document.replayManifest,
  });
  const plan: ChaosStagingPlan = Object.freeze({
    destinationScenarioId,
    run,
    emergencyObservations: Object.freeze(emergencyObservations),
    operationalObservations: Object.freeze(operationalObservations),
    units: Object.freeze(units),
    chaosPublicAssignments: Object.freeze(chaosPublicAssignments),
    sourceIds: Object.freeze(sourceIds),
    publicAssignmentWrites: Object.freeze([]),
  });
  if (!planBelongsToRun(plan)) {
    return rejection("rejected", "CROSS_RUN_REJECTED", "Staging rows must belong to this import run.");
  }
  if (plan.sourceIds.length > MAX_STAGED_SOURCE_IDS) {
    return rejection("rejected", "SOURCE_LIMIT", "The staging writer accepts at most 40001 source-id rows.");
  }
  if (Buffer.byteLength(JSON.stringify(plan)) > maxPayloadBytes) {
    return rejection("rejected", "PAYLOAD_LIMIT", "The staging payload exceeds 33554432 bytes.");
  }
  return Object.freeze({ ok: true, outcome: "staged", plan });
}

/**
 * Classifies a unique-index failure after its writes have been rolled back.
 * A child identifier collision stays a child collision even when another digest exists.
 */
export function classifyUniqueViolation(
  constraintName: string,
  existing: StagingIdentity | undefined,
  incoming: StagingIdentity,
): StageDecision {
  const sameArtifact = existing !== undefined
    && existing.digest_hex === incoming.digest_hex
    && existing.idempotency_key === incoming.idempotency_key;
  const runIdentity = constraintName === RUN_ID_CONSTRAINT || constraintName === IDEMPOTENCY_CONSTRAINT;
  if (runIdentity && sameArtifact) {
    return rejection("duplicate", "DUPLICATE_IMPORT", "This artifact was already imported.");
  }
  if (constraintName === RUN_ID_CONSTRAINT && existing !== undefined) {
    return rejection("review", "RUN_DIGEST_CONFLICT", "A different artifact for this run was already imported and requires manual review.");
  }
  return rejection("rejected", "CHILD_ID_CONFLICT", "A staging identifier collided with an existing row. Nothing was written.");
}

/** Every staged row carries the same run id. */
export function planBelongsToRun(plan: ChaosStagingPlan): boolean {
  const importRunId = plan.run.id;
  const rows = [
    ...plan.emergencyObservations,
    ...plan.operationalObservations,
    ...plan.units,
    ...plan.chaosPublicAssignments,
    ...plan.sourceIds,
  ];
  return rows.every((row) => row.import_run_id === importRunId);
}

/** SHA-256 of the exact UTF-8 bytes. This is independent of the import ledger. */
export function digestUtf8(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Validates the public JSON, recomputes its SHA-256, and only then stages it.
 * This is the application path that may later call stage_chaos_import.
 */
export function stageValidatedChaosText(
  text: string,
  destinationScenarioId: string,
  store: StagingStore,
  ledger: ImportLedger,
  options: StagePlanOptions = {},
): StageDecision {
  if (typeof text !== "string") {
    return rejection("rejected", "PAYLOAD_REJECTED", "The public simulation export was rejected.");
  }
  const recomputed = digestUtf8(text);
  const imported = importSimulationText(text, ledger);
  if (!imported.ok) {
    return rejection("rejected", "PAYLOAD_REJECTED", "The public simulation export was rejected.");
  }
  const simulation = imported.simulation;
  if (
    simulation.source.digestAlgorithm !== "SHA-256"
    || simulation.source.digestHex !== recomputed
    || simulation.source.idempotencyKey !== `${simulation.document.schemaVersion}:${simulation.document.runId}:${recomputed}`
  ) {
    return rejection("rejected", "PAYLOAD_REJECTED", "The public simulation digest did not match the original bytes.");
  }
  return stageChaosImport(simulation, destinationScenarioId, store, options);
}

/**
 * Plans one import and publishes it only when the plan is new.
 * A store commit that throws leaves the decision unsuccessful.
 */
export function stageChaosImport(
  simulation: SimulationImport,
  destinationScenarioId: string,
  store: StagingStore,
  options: StagePlanOptions = {},
): StageDecision {
  const decision = planChaosImport(simulation, destinationScenarioId, store, options);
  if (!decision.ok) return decision;
  try {
    store.commit(decision.plan);
  } catch (error) {
    if (error instanceof StagingConstraintError) {
      return classifyUniqueViolation(error.constraintName, store.findRun(decision.plan.run.schema_version, decision.plan.run.run_id), {
        digest_hex: decision.plan.run.digest_hex,
        idempotency_key: decision.plan.run.idempotency_key,
      });
    }
    return rejection("rejected", "COMMIT_FAILED", "Staging commit failed.");
  }
  return decision;
}

export class StagingConstraintError extends Error {
  readonly constraintName: string;

  constructor(constraintName: string) {
    super("staging constraint");
    this.name = "StagingConstraintError";
    this.constraintName = constraintName;
  }
}

export class MemoryStagingStore implements StagingStore {
  private snapshot: StagingSnapshot = Object.freeze({
    runs: Object.freeze([]),
    emergencyObservations: Object.freeze([]),
    operationalObservations: Object.freeze([]),
    units: Object.freeze([]),
    chaosPublicAssignments: Object.freeze([]),
    sourceIds: Object.freeze([]),
  });

  failNextCommit = false;

  findRun(schemaVersion: string, runId: string): ChaosImportRunRow | undefined {
    return this.snapshot.runs.find((run) => run.schema_version === schemaVersion && run.run_id === runId);
  }

  commit(plan: ChaosStagingPlan): void {
    const constraintName = this.constraintConflict(plan);
    if (constraintName !== undefined) throw new StagingConstraintError(constraintName);
    const next: StagingSnapshot = Object.freeze({
      runs: Object.freeze([...this.snapshot.runs, plan.run]),
      emergencyObservations: Object.freeze([...this.snapshot.emergencyObservations, ...plan.emergencyObservations]),
      operationalObservations: Object.freeze([...this.snapshot.operationalObservations, ...plan.operationalObservations]),
      units: Object.freeze([...this.snapshot.units, ...plan.units]),
      chaosPublicAssignments: Object.freeze([...this.snapshot.chaosPublicAssignments, ...plan.chaosPublicAssignments]),
      sourceIds: Object.freeze([...this.snapshot.sourceIds, ...plan.sourceIds]),
    });
    if (this.failNextCommit) {
      this.failNextCommit = false;
      throw new Error("commit failed");
    }
    this.snapshot = next;
  }

  private constraintConflict(plan: ChaosStagingPlan): string | undefined {
    if (this.snapshot.runs.some((run) => run.schema_version === plan.run.schema_version && run.run_id === plan.run.run_id)) {
      return RUN_ID_CONSTRAINT;
    }
    if (this.snapshot.runs.some((run) => run.idempotency_key === plan.run.idempotency_key)) return IDEMPOTENCY_CONSTRAINT;
    if (this.snapshot.runs.some((run) => run.id === plan.run.id)) return "chaos_import_runs_pkey";
    if (collides(this.snapshot.emergencyObservations.map((row) => row.local_id), plan.emergencyObservations.map((row) => row.local_id))) {
      return "chaos_emergency_local_uidx";
    }
    if (collides(this.snapshot.operationalObservations.map((row) => row.local_id), plan.operationalObservations.map((row) => row.local_id))) {
      return "chaos_operational_local_uidx";
    }
    if (collides(this.snapshot.units.map((row) => row.local_id), plan.units.map((row) => row.local_id))) return "chaos_units_local_uidx";
    if (collides(this.snapshot.chaosPublicAssignments.map((row) => row.local_id), plan.chaosPublicAssignments.map((row) => row.local_id))) {
      return "chaos_public_assignments_local_uidx";
    }
    if (collides(this.snapshot.sourceIds.map((row) => row.local_id), plan.sourceIds.map((row) => row.local_id))) {
      return "chaos_source_ids_local_uidx";
    }
    return undefined;
  }

  read(): StagingSnapshot {
    return this.snapshot;
  }
}
