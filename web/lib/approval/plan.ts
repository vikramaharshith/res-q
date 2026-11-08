import { STANDARD_DEMO_ID } from "@/lib/supabase/standard-demo-parse";
import type { RecommendationDto } from "@/lib/ai/types";
import type {
  Assignment,
  Incident,
  IncidentPriority,
  IncidentStatus,
  Responder,
} from "@/lib/demo/types";
import { capabilityFits, capabilityGap } from "@/lib/approval/capabilities";
import {
  LOCAL_OPERATOR_LABEL,
  type ApprovalDecisionDto,
  type DecisionRequest,
  type DecisionRun,
  type StateSnapshot,
} from "@/lib/approval/types";

/**
 * Pure decision rules. The SQL function `apply_human_decision` repeats these
 * checks inside one database transaction. Keep the two copies aligned.
 *
 * A recommendation never becomes an assignment here. The caller must pass an
 * explicit human request.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ASSIGNABLE_STATUSES: readonly IncidentStatus[] = ["NEW", "NEEDS_REVIEW"];
const PRIORITY_OVERRIDE_STATUSES: readonly IncidentStatus[] = [
  "NEW",
  "NEEDS_REVIEW",
  "ASSIGNED",
  "IN_PROGRESS",
];

export interface DecisionContext {
  incident: Incident;
  responders: Responder[];
  assignments: Assignment[];
  run: DecisionRun;
  decisions: ApprovalDecisionDto[];
  now: string;
  decisionId: string;
  assignmentId: string;
}

export interface MutationPlan {
  decision: ApprovalDecisionDto;
  incidentPriority: IncidentPriority | null;
  incidentStatus: IncidentStatus | null;
  responderIdToBusy: string | null;
  assignment: Assignment | null;
}

export type PlanOutcome =
  | { ok: true; replay: false; plan: MutationPlan }
  | { ok: true; replay: true; decision: ApprovalDecisionDto }
  | { ok: false; httpStatus: number; code: string; message: string };

function refuse(
  httpStatus: number,
  code: string,
  message: string,
): PlanOutcome {
  return { ok: false, httpStatus, code, message };
}

export function decisionFingerprint(input: {
  action: DecisionRequest["action"];
  incidentId: string;
  runId: string;
  scenarioId: string;
  selectedPriority: IncidentPriority | null;
  selectedResponderId: string | null;
  reason: string;
}): string {
  return [
    input.action,
    input.scenarioId,
    input.incidentId,
    input.runId,
    input.selectedPriority ?? "",
    input.selectedResponderId ?? "",
    input.reason,
  ].join("|");
}

function snapshotFor(
  incident: Incident,
  responder: Responder | null,
  assignment: Assignment | null,
): StateSnapshot {
  return {
    incidentStatus: incident.status,
    incidentPriority: incident.priority,
    responderId: responder?.id ?? null,
    responderAvailability: responder?.availability ?? null,
    assignmentId: assignment?.id ?? null,
    assignmentStatus: assignment?.status ?? null,
    assignmentOrigin: assignment?.origin ?? null,
  };
}

function openAssignment(assignments: Assignment[], incidentId: string): Assignment | undefined {
  return assignments.find((assignment) => assignment.incidentId === incidentId);
}

function responderOpenAssignment(
  assignments: Assignment[],
  responderId: string,
): Assignment | undefined {
  return assignments.find(
    (assignment) =>
      assignment.responderId === responderId && assignment.status !== "COMPLETED",
  );
}

function sameDecision(
  existing: ApprovalDecisionDto,
  fingerprint: string,
): boolean {
  return existing.fingerprint === fingerprint;
}

export function planHumanDecision(
  context: DecisionContext,
  request: DecisionRequest,
): PlanOutcome {
  const { incident, run } = context;
  if (!UUID_PATTERN.test(request.idempotencyKey)) {
    return refuse(400, "INVALID_REQUEST", "The decision needs a new idempotency key. Nothing was assigned.");
  }
  if (request.reason.length > 500) {
    return refuse(400, "INVALID_REQUEST", "The reason must be 500 characters or fewer. Nothing was assigned.");
  }
  if (request.confirmed !== true) {
    return refuse(
      400,
      "CONFIRMATION_REQUIRED",
      "Confirm the decision explicitly. Nothing was assigned.",
    );
  }
  if (incident.scenarioId !== STANDARD_DEMO_ID || run.scenarioId !== STANDARD_DEMO_ID) {
    return refuse(
      403,
      "SCENARIO_MISMATCH",
      "This decision is bound to the standard demo scenario. Nothing was assigned.",
    );
  }
  if (incident.scenarioId !== run.scenarioId || incident.id !== run.incidentId) {
    return refuse(
      403,
      "SCENARIO_MISMATCH",
      "The investigation does not belong to this incident. Nothing was assigned.",
    );
  }
  if (run.status !== "COMPLETED" || !run.recommendation) {
    return refuse(
      409,
      "RECOMMENDATION_MISSING",
      "This investigation has no accepted recommendation to review. Nothing was assigned.",
    );
  }
  if (run.recommendation.incident_id !== incident.id || run.recommendation.advisory !== true) {
    return refuse(
      409,
      "RECOMMENDATION_MISSING",
      "The stored recommendation is not an advisory result for this incident. Nothing was assigned.",
    );
  }

  const recommendation = run.recommendation;
  const selected = selectionFor(request, recommendation);
  if (!selected.ok) return selected.outcome;
  const reason = request.reason.trim();
  if (
    (request.action === "reject" || request.action === "override") &&
    reason.length === 0
  ) {
    return refuse(
      400,
      "REASON_REQUIRED",
      "A reason is required to reject or override a recommendation. Nothing was assigned.",
    );
  }

  const fingerprint = decisionFingerprint({
    action: request.action,
    incidentId: incident.id,
    runId: run.id,
    scenarioId: incident.scenarioId,
    selectedPriority: selected.priority,
    selectedResponderId: selected.responderId,
    reason,
  });
  const byKey = context.decisions.find(
    (decision) => decision.idempotencyKey === request.idempotencyKey,
  );
  const byRun = context.decisions.find((decision) => decision.agentRunId === run.id);
  const existing = byKey ?? byRun;
  if (existing) {
    if (!sameDecision(existing, fingerprint)) {
      return refuse(
        409,
        "DECISION_CONFLICT",
        "This investigation already has a different human decision. The earlier decision was kept.",
      );
    }
    return { ok: true, replay: true, decision: existing };
  }

  const currentAssignment = openAssignment(context.assignments, incident.id);
  const assigning = selected.responderId !== null;
  if (assigning) {
    const eligibility = assignmentEligibility(incident, currentAssignment);
    if (!eligibility.ok) return eligibility.outcome;
    const responder = context.responders.find((item) => item.id === selected.responderId);
    const responderCheck = validateResponder(
      incident,
      responder,
      context.assignments,
    );
    if (!responderCheck.ok) return responderCheck.outcome;
    return commit({
      context,
      request,
      recommendation,
      reason,
      fingerprint,
      priority: selected.priority ?? recommendation.proposed_priority,
      responder: responderCheck.responder,
      createAssignment: true,
    });
  }

  if (request.action === "reject") {
    return commit({
      context,
      request,
      recommendation,
      reason,
      fingerprint,
      priority: null,
      responder: null,
      createAssignment: false,
    });
  }

  if (incident.status === "RESOLVED") {
    return refuse(
      409,
      "INCIDENT_NOT_ELIGIBLE",
      "This incident is resolved. The simulation will not reopen it or change its priority.",
    );
  }
  if (!PRIORITY_OVERRIDE_STATUSES.includes(incident.status)) {
    return refuse(
      409,
      "INCIDENT_NOT_ELIGIBLE",
      "This incident cannot take a priority change. Nothing was assigned.",
    );
  }
  if (!selected.priority || selected.priority === incident.priority) {
    return refuse(
      400,
      "OVERRIDE_UNCHANGED",
      "Choose a different priority or a responder. Nothing was assigned.",
    );
  }
  return commit({
    context,
    request,
    recommendation,
    reason,
    fingerprint,
    priority: selected.priority,
    responder: null,
    createAssignment: false,
  });
}

function selectionFor(
  request: DecisionRequest,
  recommendation: RecommendationDto,
):
  | { ok: true; priority: IncidentPriority | null; responderId: string | null }
  | { ok: false; outcome: PlanOutcome } {
  if (request.action === "approve") {
    if (!recommendation.recommended_responder_id) {
      return {
        ok: false,
        outcome: refuse(
          409,
          "RECOMMENDATION_HAS_NO_UNIT",
          "Nemotron did not suggest a unit. Approve cannot create an assignment. Choose an override or reject the draft.",
        ),
      };
    }
    return {
      ok: true,
      priority: recommendation.proposed_priority,
      responderId: recommendation.recommended_responder_id,
    };
  }
  if (request.action === "reject") {
    return { ok: true, priority: null, responderId: null };
  }
  const priority = request.selectedPriority;
  const responderId = request.selectedResponderId;
  if (!priority && !responderId) {
    return {
      ok: false,
      outcome: refuse(
        400,
        "OVERRIDE_UNCHANGED",
        "An override needs a different priority, a responder, or both. Nothing was assigned.",
      ),
    };
  }
  const samePriority = !priority || priority === recommendation.proposed_priority;
  const sameResponder =
    (responderId ?? null) === (recommendation.recommended_responder_id ?? null);
  if (samePriority && (responderId === null || sameResponder)) {
    return {
      ok: false,
      outcome: refuse(
        400,
        "OVERRIDE_UNCHANGED",
        "That selection matches the Nemotron draft. Approve it, or change the priority or the unit.",
      ),
    };
  }
  return { ok: true, priority, responderId };
}

function assignmentEligibility(
  incident: Incident,
  currentAssignment: Assignment | undefined,
): { ok: true } | { ok: false; outcome: PlanOutcome } {
  if (currentAssignment) {
    const baseline =
      currentAssignment.origin === "scenario_baseline"
        ? " The scenario baseline assignment was left in place."
        : "";
    return {
      ok: false,
      outcome: refuse(
        409,
        "ALREADY_ASSIGNED",
        `This incident already has simulated assignment ${currentAssignment.id}.${baseline} Nothing was replaced.`,
      ),
    };
  }
  if (incident.status === "RESOLVED") {
    return {
      ok: false,
      outcome: refuse(
        409,
        "INCIDENT_NOT_ELIGIBLE",
        "This incident is resolved. The simulation will not reopen it.",
      ),
    };
  }
  if (!ASSIGNABLE_STATUSES.includes(incident.status)) {
    return {
      ok: false,
      outcome: refuse(
        409,
        "INCIDENT_NOT_ELIGIBLE",
        "Only a new or needs-review incident can receive a simulated assignment. Nothing was assigned.",
      ),
    };
  }
  return { ok: true };
}

function validateResponder(
  incident: Incident,
  responder: Responder | undefined,
  assignments: Assignment[],
):
  | { ok: true; responder: Responder }
  | { ok: false; outcome: PlanOutcome } {
  if (!responder || responder.scenarioId !== incident.scenarioId) {
    return {
      ok: false,
      outcome: refuse(
        404,
        "RESPONDER_NOT_FOUND",
        "That simulated unit is not in this scenario. Nothing was assigned.",
      ),
    };
  }
  if (responder.availability === "OFFLINE") {
    return {
      ok: false,
      outcome: refuse(
        409,
        "RESPONDER_OFFLINE",
        `${responder.callsign} is offline in the simulation. Nothing was assigned.`,
      ),
    };
  }
  if (responder.availability !== "AVAILABLE") {
    return {
      ok: false,
      outcome: refuse(
        409,
        "RESPONDER_BUSY",
        `${responder.callsign} is ${responder.availability.toLowerCase()} and cannot be double-booked. Nothing was assigned.`,
      ),
    };
  }
  const open = responderOpenAssignment(assignments, responder.id);
  if (open) {
    return {
      ok: false,
      outcome: refuse(
        409,
        "RESPONDER_BUSY",
        `${responder.callsign} already has open assignment ${open.id}. Nothing was assigned.`,
      ),
    };
  }
  if (!capabilityFits(incident.category, responder.capabilities)) {
    return {
      ok: false,
      outcome: refuse(
        409,
        "RESPONDER_INCOMPATIBLE",
        capabilityGap(incident.category, responder.capabilities),
      ),
    };
  }
  return { ok: true, responder };
}

function commit(input: {
  context: DecisionContext;
  request: DecisionRequest;
  recommendation: RecommendationDto;
  reason: string;
  fingerprint: string;
  priority: IncidentPriority | null;
  responder: Responder | null;
  createAssignment: boolean;
}): PlanOutcome {
  const { incident } = input.context;
  const existingAssignment =
    input.context.assignments.find((item) => item.incidentId === incident.id) ?? null;
  const previous = snapshotFor(incident, input.responder, existingAssignment);
  const nextStatus = input.createAssignment ? "ASSIGNED" : incident.status;
  const nextPriority = input.priority ?? incident.priority;
  const created: Assignment | null =
    input.createAssignment && input.responder
      ? {
          id: input.context.assignmentId,
          incidentId: incident.id,
          responderId: input.responder.id,
          status: "ASSIGNED",
          assignedAt: input.context.now,
          origin:
            input.request.action === "override" ? "human_override" : "human_approval",
          note: assignmentNote(input.request.action, input.reason),
        }
      : null;
  const resulting = snapshotFor(
    { ...incident, status: nextStatus, priority: nextPriority },
    input.responder
      ? {
          ...input.responder,
          availability: input.createAssignment ? "BUSY" : input.responder.availability,
        }
      : null,
    created ?? existingAssignment,
  );
  const decision: ApprovalDecisionDto = {
    id: input.context.decisionId,
    idempotencyKey: input.request.idempotencyKey,
    fingerprint: input.fingerprint,
    agentRunId: input.context.run.id,
    incidentId: incident.id,
    scenarioId: incident.scenarioId,
    action: input.request.action,
    reason: input.reason,
    operatorLabel: LOCAL_OPERATOR_LABEL,
    selectedPriority: input.priority,
    selectedResponderId: input.responder?.id ?? null,
    originalRecommendation: input.recommendation,
    previousState: previous,
    resultingState: resulting,
    assignmentId: created?.id ?? null,
    assignmentCreated: created !== null,
    createdAt: input.context.now,
    simulation: true,
    humanDecision: true,
  };
  return {
    ok: true,
    replay: false,
    plan: {
      decision,
      incidentPriority: input.priority,
      incidentStatus: input.createAssignment ? "ASSIGNED" : null,
      responderIdToBusy: input.createAssignment ? input.responder?.id ?? null : null,
      assignment: created,
    },
  };
}

function assignmentNote(action: DecisionRequest["action"], reason: string): string {
  const lead =
    action === "override"
      ? "Human override in the local simulation. Not a real dispatch."
      : "Human approval of a Nemotron draft in the local simulation. Not a real dispatch.";
  const suffix = reason ? ` Reason: ${reason}` : "";
  return `${lead}${suffix}`.slice(0, 2_000);
}
