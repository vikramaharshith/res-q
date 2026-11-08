import "server-only";

import {
  assembleChaosSimulation,
  CHAOS_SAMPLE_IMPORT_RUN_ID,
  ChaosReadError,
  type ChaosDashboardLoad,
  type ChaosSampleRows,
} from "@/lib/chaos/read-model";
import { redactServerText } from "@/lib/security/redact";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Reads the confirmed two-report Chaos sample.
 * Selects only. There is no insert, update, delete, or import call.
 */

const READ_LIMIT = 32;

const RUN_COLUMNS =
  "id, schema_version, engine_version, run_id, digest_hex, source_scenario_id, source_label, fictional, difficulty, simulation_start, simulation_export, simulation_status, emergency_count, operational_count, unit_count, assignment_count";

const EMERGENCY_COLUMNS =
  "import_run_id, ordinal, report_id, category, source_type, observed_at, submitted_at, received_at, narrative, claims, status, urgency, source_metadata, fictional, coordinate_system, grid_x, grid_y, district, primary_reference, secondary_reference, description, precision";

const OPERATIONAL_COLUMNS =
  "import_run_id, ordinal, observation_id, unit_id, assignment_id, message_type, observed_at, submitted_at, received_at, source, delivery_status, availability_state, task_status, travel_status, communication_state, fictional, coordinate_system, grid_x, grid_y, district, primary_reference, secondary_reference, description, precision, route_version, fatigue, equipment_item, equipment_condition, inventory";

const UNIT_COLUMNS =
  "import_run_id, unit_id, callsign, latest_observed_at, latest_received_at, availability_state, assignment_id, task_status, travel_status, communication_state, fictional, coordinate_system, grid_x, grid_y, district, primary_reference, secondary_reference, description, precision";

const ASSIGNMENT_COLUMNS =
  "import_run_id, ordinal, assignment_id, unit_id, first_received_at";

interface QueryError {
  code?: string;
  message?: string;
}

function readFailed(table: string, error: QueryError): ChaosReadError {
  const code = typeof error.code === "string" && error.code ? error.code : "unknown";
  const message = redactServerText(typeof error.message === "string" ? error.message : "read failed").slice(0, 200);
  return new ChaosReadError(`${table} read failed (${code}): ${message}`);
}

function completeList(table: string, value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length >= READ_LIMIT) {
    throw new ChaosReadError(`${table} read was not a complete list`);
  }
  return value;
}

async function readChaosSampleRows(): Promise<ChaosSampleRows> {
  const client = createSupabaseServerClient();
  const runId = CHAOS_SAMPLE_IMPORT_RUN_ID;
  const [runResult, emergencyResult, operationalResult, unitResult, assignmentResult] = await Promise.all([
    client.from("chaos_import_runs").select(RUN_COLUMNS).eq("id", runId).limit(2),
    client
      .from("chaos_emergency_observations")
      .select(EMERGENCY_COLUMNS)
      .eq("import_run_id", runId)
      .order("ordinal")
      .limit(READ_LIMIT),
    client
      .from("chaos_operational_observations")
      .select(OPERATIONAL_COLUMNS)
      .eq("import_run_id", runId)
      .order("ordinal")
      .limit(READ_LIMIT),
    client.from("chaos_units").select(UNIT_COLUMNS).eq("import_run_id", runId).order("unit_id").limit(READ_LIMIT),
    client
      .from("chaos_public_assignments")
      .select(ASSIGNMENT_COLUMNS)
      .eq("import_run_id", runId)
      .order("ordinal")
      .limit(READ_LIMIT),
  ]);
  if (runResult.error) throw readFailed("chaos_import_runs", runResult.error);
  if (emergencyResult.error) throw readFailed("chaos_emergency_observations", emergencyResult.error);
  if (operationalResult.error) throw readFailed("chaos_operational_observations", operationalResult.error);
  if (unitResult.error) throw readFailed("chaos_units", unitResult.error);
  if (assignmentResult.error) throw readFailed("chaos_public_assignments", assignmentResult.error);
  const runs = completeList("chaos_import_runs", runResult.data);
  if (runs.length !== 1) throw new ChaosReadError("chaos_import_runs read was not the confirmed sample");
  return {
    run: runs[0],
    emergencyObservations: completeList("chaos_emergency_observations", emergencyResult.data),
    operationalObservations: completeList("chaos_operational_observations", operationalResult.data),
    units: completeList("chaos_units", unitResult.data),
    publicAssignments: completeList("chaos_public_assignments", assignmentResult.data),
  };
}

export async function loadChaosSimulation(): Promise<ChaosDashboardLoad> {
  try {
    const board = assembleChaosSimulation(await readChaosSampleRows());
    console.info(
      `[resq-chaos] source=supabase run=${board.importRunId} emergency=${board.emergencyObservations.length} operational=${board.operationalObservations.length} units=${board.units.length} assignments=${board.publicAssignments.length}`,
    );
    return { ok: true, board };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "read failed";
    console.error(`[resq-chaos] source=read-failed detail=${redactServerText(detail).slice(0, 300)}`);
    return {
      ok: false,
      message: "The staged Chaos sample could not be read. The Urban Flood dashboard was left unchanged.",
    };
  }
}
