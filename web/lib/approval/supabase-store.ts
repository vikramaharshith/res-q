import "server-only";

import { reloadCommandScenario } from "@/lib/demo/load-scenario";
import { redactServerText } from "@/lib/security/redact";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toCommandSnapshot } from "@/lib/approval/snapshot";
import type { ApprovalStore, StoreApplyInput, StoreApplyResult } from "@/lib/approval/handle-decision";
import type { ApprovalDecisionDto } from "@/lib/approval/types";

const MIGRATION_MESSAGE =
  "The human-approval database function is not available. Apply web/scripts/2026-11-07-human-approval.sql and reload the API schema. Nothing was assigned.";

function migrationError(error: { code?: string; message?: string }): boolean {
  const message = error.message?.toLowerCase() ?? "";
  const tablePrivilege =
    message.includes("permission denied for table") ||
    message.includes("permission denied for relation");
  if (tablePrivilege) return false;
  return (
    error.code === "42501" ||
    error.code === "42883" ||
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    message.includes("apply_human_decision") ||
    message.includes("permission denied")
  );
}

function asDecision(value: unknown): ApprovalDecisionDto | null {
  if (!value || typeof value !== "object") return null;
  const decision = value as ApprovalDecisionDto;
  if (decision.humanDecision !== true || decision.simulation !== true) return null;
  if (decision.operatorLabel !== "local_demo_operator") return null;
  if (typeof decision.id !== "string" || typeof decision.agentRunId !== "string") return null;
  return decision;
}

export const supabaseApprovalStore: ApprovalStore = {
  async apply(input: StoreApplyInput): Promise<StoreApplyResult> {
    const client = createSupabaseServerClient();
    const { data, error } = await client.rpc("apply_human_decision", {
      payload: {
        operator_label: input.operatorLabel,
        scenario_id: input.scenarioId,
        incident_id: input.incidentId,
        agent_run_id: input.agentRunId,
        action: input.request.action,
        confirmed: input.request.confirmed,
        reason: input.request.reason,
        idempotency_key: input.request.idempotencyKey,
        selected_priority: input.request.selectedPriority,
        selected_responder_id: input.request.selectedResponderId,
      },
    });
    if (error) {
      if (migrationError(error)) {
        return { type: "migration_required", message: MIGRATION_MESSAGE };
      }
      console.error(`[resq-approval] rpc code=${error.code ?? "unknown"}`);
      return {
        type: "unavailable",
        message: `The decision could not be saved. Nothing was confirmed. ${redactServerText(error.message ?? "")}`.slice(0, 400),
      };
    }
    if (!data || typeof data !== "object") {
      return {
        type: "unavailable",
        message: "The decision function returned an empty result. Refresh before trying again. Do not assume an assignment was created.",
      };
    }
    const body = data as {
      ok?: unknown;
      http_status?: unknown;
      code?: unknown;
      message?: unknown;
      assignment_created?: unknown;
      replay?: unknown;
      decision?: unknown;
    };
    const code = typeof body.code === "string" ? body.code : "DATABASE_UNAVAILABLE";
    const message =
      typeof body.message === "string"
        ? body.message
        : "The decision function returned an unreadable result. Nothing was confirmed.";
    if (body.ok !== true) {
      const status = typeof body.http_status === "number" ? body.http_status : 409;
      return {
        type: "refused",
        httpStatus: status >= 400 && status <= 499 ? status : 409,
        code,
        message,
      };
    }
    const decision = asDecision(body.decision);
    if (!decision || typeof body.assignment_created !== "boolean") {
      return {
        type: "unavailable",
        message:
          "The decision function reported success without a readable audit record. Refresh the board before trying again.",
      };
    }
    if (decision.assignmentCreated !== body.assignment_created) {
      return {
        type: "unavailable",
        message:
          "The decision result disagreed with itself about whether an assignment was created. Refresh before trying again.",
      };
    }
    let snapshot = null;
    try {
      const loaded = await reloadCommandScenario();
      if (loaded.source === "supabase") snapshot = toCommandSnapshot(loaded.scenario);
    } catch (reloadError) {
      const name = reloadError instanceof Error ? reloadError.name : "Error";
      console.error(`[resq-approval] reload_failed=${name}`);
    }
    return {
      type: "committed",
      httpStatus: 200,
      code,
      message,
      assignmentCreated: body.assignment_created,
      decision,
      snapshot,
      replay: body.replay === true,
    };
  },
};
