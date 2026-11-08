import "server-only";

import { createSupabaseServerClient, redactServerText } from "@/lib/supabase/server";
import {
  ASSIGNMENT_COLUMNS,
  INCIDENT_COLUMNS,
  REPORT_COLUMNS,
  RESPONDER_COLUMNS,
  SCENARIO_COLUMNS,
  STANDARD_DEMO_ID,
  STANDARD_DEMO_READ_LIMIT,
  ScenarioDataError,
  assembleStandardDemo,
  idsFrom,
} from "@/lib/supabase/standard-demo-parse";
import type { Scenario } from "@/lib/demo/types";

export {
  STANDARD_DEMO_ID,
  ScenarioDataError,
  assembleStandardDemo,
} from "@/lib/supabase/standard-demo-parse";

/**
 * Reads the imported Standard Demo (`scn_demo_flood`) with the server secret.
 * Parsing lives in `standard-demo-parse.ts` so tests can validate rows
 * without opening a database connection.
 */

interface QueryError {
  code?: string;
  message?: string;
}

function queryError(table: string, error: QueryError): ScenarioDataError {
  const code = typeof error.code === "string" && error.code ? error.code : "unknown";
  const message = redactServerText(
    typeof error.message === "string" ? error.message : "read failed",
  ).slice(0, 300);
  return new ScenarioDataError(`${table} read failed (${code}): ${message}`);
}

export async function fetchStandardDemoScenario(): Promise<Scenario> {
  const client = createSupabaseServerClient();
  const [scenarioResult, incidentResult, reportResult, responderResult] =
    await Promise.all([
      client
        .from("scenarios")
        .select(SCENARIO_COLUMNS)
        .eq("id", STANDARD_DEMO_ID)
        .limit(2),
      client
        .from("incidents")
        .select(INCIDENT_COLUMNS)
        .eq("scenario_id", STANDARD_DEMO_ID)
        .order("id")
        .limit(STANDARD_DEMO_READ_LIMIT),
      client
        .from("reports")
        .select(REPORT_COLUMNS)
        .eq("scenario_id", STANDARD_DEMO_ID)
        .order("id")
        .limit(STANDARD_DEMO_READ_LIMIT),
      client
        .from("responders")
        .select(RESPONDER_COLUMNS)
        .eq("scenario_id", STANDARD_DEMO_ID)
        .order("id")
        .limit(STANDARD_DEMO_READ_LIMIT),
    ]);

  if (scenarioResult.error) throw queryError("scenarios", scenarioResult.error);
  if (incidentResult.error) throw queryError("incidents", incidentResult.error);
  if (reportResult.error) throw queryError("reports", reportResult.error);
  if (responderResult.error) throw queryError("responders", responderResult.error);

  const incidentIds = idsFrom(incidentResult.data);
  if (incidentIds.length === 0) {
    throw new ScenarioDataError("Standard demo incidents are missing");
  }

  const assignmentResult = await client
    .from("assignments")
    .select(ASSIGNMENT_COLUMNS)
    .in("incident_id", incidentIds)
    .order("id")
    .limit(STANDARD_DEMO_READ_LIMIT);
  if (assignmentResult.error) throw queryError("assignments", assignmentResult.error);

  return assembleStandardDemo({
    scenario: scenarioResult.data,
    incidents: incidentResult.data,
    reports: reportResult.data,
    responders: responderResult.data,
    assignments: assignmentResult.data,
  });
}
