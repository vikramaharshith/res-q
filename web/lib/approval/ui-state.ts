import type { AgentRunDto } from "@/lib/ai/types";
import type { Assignment, Incident, IncidentPriority, Responder } from "@/lib/demo/types";
import { INCIDENT_PRIORITIES } from "@/lib/demo/types";
import { capabilityFits, capabilityGap } from "@/lib/approval/capabilities";
import { planHumanDecision } from "@/lib/approval/plan";
import type { ApprovalDecisionDto, DecisionRun } from "@/lib/approval/types";

export interface ActionPreview {
  enabled: boolean;
  reason: string;
}

export interface ResponderChoice {
  responder: Responder;
  disabled: boolean;
  reason: string;
}

export interface ApprovalPreview {
  approve: ActionPreview;
  reject: ActionPreview;
  override: ActionPreview;
  responders: ResponderChoice[];
  decision: ApprovalDecisionDto | null;
}

const SAMPLE_KEY = "00000000-0000-4000-8000-000000000001";

function blocked(reason: string): ActionPreview {
  return { enabled: false, reason };
}

function runOf(run: AgentRunDto | null): DecisionRun | null {
  if (!run || run.status !== "COMPLETED" || !run.recommendation) return null;
  return {
    id: run.run_id,
    status: run.status,
    incidentId: run.incident_id,
    scenarioId: run.scenario_id,
    recommendation: run.recommendation,
  };
}

export function responderChoices(
  incident: Incident,
  responders: Responder[],
  assignments: Assignment[],
): ResponderChoice[] {
  return [...responders]
    .sort((left, right) => left.callsign.localeCompare(right.callsign))
    .map((responder) => {
      if (responder.scenarioId !== incident.scenarioId) {
        return {
          responder,
          disabled: true,
          reason: "This unit belongs to another scenario.",
        };
      }
      if (responder.availability === "OFFLINE") {
        return { responder, disabled: true, reason: "Offline in the simulation." };
      }
      if (responder.availability !== "AVAILABLE") {
        return {
          responder,
          disabled: true,
          reason: "Busy with another simulated assignment.",
        };
      }
      const open = assignments.find(
        (assignment) =>
          assignment.responderId === responder.id && assignment.status !== "COMPLETED",
      );
      if (open) {
        return {
          responder,
          disabled: true,
          reason: `Already on ${open.id}.`,
        };
      }
      if (!capabilityFits(incident.category, responder.capabilities)) {
        return {
          responder,
          disabled: true,
          reason: capabilityGap(incident.category, responder.capabilities),
        };
      }
      return { responder, disabled: false, reason: "Available for this case." };
    });
}

export function previewApproval(input: {
  incident: Incident;
  responders: Responder[];
  assignments: Assignment[];
  run: AgentRunDto | null;
  decisions: ApprovalDecisionDto[];
  storageReady: boolean;
  approvalsOptIn: boolean;
}): ApprovalPreview {
  const responders = responderChoices(input.incident, input.responders, input.assignments);
  const existing =
    input.decisions.find((decision) => decision.agentRunId === input.run?.run_id) ?? null;
  if (!input.approvalsOptIn) {
    const reason =
      "Local approval writes are off. Set RESQ_LOCAL_APPROVALS=1 and restart. Nothing will be assigned.";
    return {
      approve: blocked(reason),
      reject: blocked(reason),
      override: blocked(reason),
      responders,
      decision: existing,
    };
  }
  if (!input.storageReady) {
    const reason =
      "Audit storage is not ready. Apply the human-approval migration before deciding. Nothing will be assigned.";
    return {
      approve: blocked(reason),
      reject: blocked(reason),
      override: blocked(reason),
      responders,
      decision: existing,
    };
  }
  const run = runOf(input.run);
  if (!run) {
    const reason = "Review starts after a stored, accepted Nemotron recommendation.";
    return {
      approve: blocked(reason),
      reject: blocked(reason),
      override: blocked(reason),
      responders,
      decision: existing,
    };
  }
  const base = {
    incident: input.incident,
    responders: input.responders,
    assignments: input.assignments,
    run,
    decisions: input.decisions,
    now: "2026-11-08T04:00:00.000Z",
    decisionId: "appr_preview",
    assignmentId: "asn_h_00000000000000000000000000000001",
  };
  const approve = planHumanDecision(base, {
    action: "approve",
    confirmed: true,
    reason: "",
    idempotencyKey: SAMPLE_KEY,
    selectedPriority: null,
    selectedResponderId: null,
  });
  const reject = planHumanDecision(base, {
    action: "reject",
    confirmed: true,
    reason: "Preview reason",
    idempotencyKey: SAMPLE_KEY,
    selectedPriority: null,
    selectedResponderId: null,
  });
  const alternative = alternativePriority(run.recommendation?.proposed_priority ?? "MEDIUM");
  const override = planHumanDecision(base, {
    action: "override",
    confirmed: true,
    reason: "Preview reason",
    idempotencyKey: SAMPLE_KEY,
    selectedPriority: alternative,
    selectedResponderId: null,
  });
  return {
    approve: toPreview(approve, "Approve the suggested unit and priority."),
    reject: toPreview(reject, "Reject the draft and leave assignments unchanged."),
    override: toPreview(override, "Record a different priority or unit."),
    responders,
    decision: existing,
  };
}

function alternativePriority(current: IncidentPriority): IncidentPriority {
  return INCIDENT_PRIORITIES.find((priority) => priority !== current) ?? "LOW";
}

function toPreview(
  outcome: ReturnType<typeof planHumanDecision>,
  success: string,
): ActionPreview {
  if (outcome.ok && outcome.replay) {
    return {
      enabled: false,
      reason: "This investigation already has a human decision.",
    };
  }
  if (outcome.ok) return { enabled: true, reason: success };
  return { enabled: false, reason: outcome.message };
}
