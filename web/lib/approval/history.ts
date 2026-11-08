import "server-only";

import type { AgentRunDto } from "@/lib/ai/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { STANDARD_DEMO_ID } from "@/lib/supabase/standard-demo-parse";
import { fromAgentRunRow, toAgentRunRow, type AgentRunRow } from "@/lib/approval/rows";
import {
  emptyHistory,
  type ApprovalDecisionDto,
  type ApprovalHistory,
} from "@/lib/approval/types";

const BLOCKED =
  "Audit storage is not ready. Apply web/scripts/2026-11-07-human-approval.sql in Supabase, then restart. Investigations still work, and nothing is assigned.";

function migrationError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42501" ||
    error.code === "42703" ||
    error.code === "PGRST204" ||
    error.code === "PGRST205"
  );
}

export async function rememberInvestigation(run: AgentRunDto): Promise<AgentRunDto> {
  if (run.recorded_by !== "server") return run;
  try {
    const client = createSupabaseServerClient();
    const row = toAgentRunRow(run);
    const { error } = await client.from("agent_runs").insert(row);
    if (!error || error.code === "23505") {
      return { ...run, stored: true, storage_code: "stored" };
    }
    console.error(`[resq-approval] persist_run code=${error.code ?? "unknown"}`);
    return {
      ...run,
      stored: false,
      storage_code: migrationError(error) ? "migration_required" : "not_stored",
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    console.error(`[resq-approval] persist_run_threw=${name}`);
    return { ...run, stored: false, storage_code: "not_stored" };
  }
}

export async function loadStoredHistory(): Promise<ApprovalHistory> {
  try {
    const client = createSupabaseServerClient();
    const [runsResult, decisionResult] = await Promise.all([
      client
        .from("agent_runs")
        .select("id, incident_id, scenario_id, model_id, status, recommendation, tool_trace, created_at")
        .eq("scenario_id", STANDARD_DEMO_ID)
        .order("created_at", { ascending: false })
        .limit(200),
      client
        .from("approval_actions")
        .select("id, result")
        .eq("scenario_id", STANDARD_DEMO_ID)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
    if (migrationError(runsResult.error) || migrationError(decisionResult.error)) {
      return emptyHistory(BLOCKED);
    }
    if (runsResult.error || decisionResult.error) {
      console.error(
        `[resq-approval] history_read code=${runsResult.error?.code ?? decisionResult.error?.code ?? "unknown"}`,
      );
      return emptyHistory(
        "The audit history could not be read. Scenario viewing still works, and nothing was changed.",
      );
    }
    const runs = (Array.isArray(runsResult.data) ? runsResult.data : [])
      .map((row) => fromAgentRunRow(row as AgentRunRow))
      .filter((run): run is AgentRunDto => run !== null);
    const decisions = (Array.isArray(decisionResult.data) ? decisionResult.data : [])
      .map((row) => readDecision(row))
      .filter((decision): decision is ApprovalDecisionDto => decision !== null);
    return {
      storage: "ready",
      storageMessage: null,
      runs,
      decisions,
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "Error";
    console.error(`[resq-approval] history_threw=${name}`);
    return emptyHistory(
      "The audit store is unavailable. The dashboard is showing scenario data only.",
    );
  }
}

function readDecision(row: unknown): ApprovalDecisionDto | null {
  if (!row || typeof row !== "object") return null;
  const result = (row as { result?: unknown }).result;
  if (!result || typeof result !== "object") return null;
  const decision = result as ApprovalDecisionDto;
  if (decision.humanDecision !== true || decision.simulation !== true) return null;
  if (decision.operatorLabel !== "local_demo_operator") return null;
  if (decision.scenarioId !== STANDARD_DEMO_ID) return null;
  return decision;
}
