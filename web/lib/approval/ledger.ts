import type { Assignment, Incident, Responder } from "@/lib/demo/types";
import {
  planHumanDecision,
  type DecisionContext,
  type PlanOutcome,
} from "@/lib/approval/plan";
import type { ApprovalDecisionDto, DecisionRequest, DecisionRun } from "@/lib/approval/types";

/**
 * In-memory model of the database transaction. Production writes go through
 * the SQL function instead. Tests use this to prove rollback, locking, and
 * idempotency without touching Supabase.
 */

export interface LedgerState {
  incidents: Incident[];
  responders: Responder[];
  assignments: Assignment[];
  runs: DecisionRun[];
  decisions: ApprovalDecisionDto[];
}

export interface LedgerHooks {
  afterLock?: () => Promise<void>;
  beforePublish?: () => void;
}

interface Waiter {
  keys: string[];
  grant: () => void;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class DecisionLedger {
  private state: LedgerState;
  private held = new Set<string>();
  private waiters: Waiter[] = [];
  private counter = 0;

  constructor(state: LedgerState) {
    this.state = clone(state);
  }

  snapshot(): LedgerState {
    return clone(this.state);
  }

  async apply(
    runId: string,
    request: DecisionRequest,
    hooks: LedgerHooks = {},
  ): Promise<PlanOutcome> {
    const run = this.state.runs.find((item) => item.id === runId);
    if (!run) {
      return {
        ok: false,
        httpStatus: 404,
        code: "RUN_NOT_FOUND",
        message: "That investigation is not stored. Nothing was assigned.",
      };
    }
    const locks = lockKeys(run, request);
    await this.acquire(locks);
    try {
      if (hooks.afterLock) await hooks.afterLock();
      this.counter += 1;
      const stamp = String(this.counter).padStart(8, "0");
      const outcome = planHumanDecision(this.context(run, stamp), request);
      if (!outcome.ok || outcome.replay) return outcome;
      if (hooks.beforePublish) hooks.beforePublish();
      const next = clone(this.state);
      applyPlan(next, outcome);
      this.state = next;
      return outcome;
    } finally {
      this.release(locks);
    }
  }

  private context(run: DecisionRun, stamp: string): DecisionContext {
    const incident = this.state.incidents.find((item) => item.id === run.incidentId);
    if (!incident) {
      throw new Error("ledger incident missing");
    }
    return {
      incident,
      responders: this.state.responders,
      assignments: this.state.assignments,
      run,
      decisions: this.state.decisions,
      now: "2026-11-08T04:00:00.000Z",
      decisionId: `appr_${stamp}`,
      assignmentId: `asn_h_${stamp.padStart(32, "0")}`,
    };
  }

  private acquire(keys: string[]): Promise<void> {
    const sorted = [...new Set(keys)].sort();
    if (sorted.every((key) => !this.held.has(key))) {
      for (const key of sorted) this.held.add(key);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push({
        keys: sorted,
        grant: () => {
          for (const key of sorted) this.held.add(key);
          resolve();
        },
      });
    });
  }

  private release(keys: string[]): void {
    for (const key of keys) this.held.delete(key);
    const remaining: Waiter[] = [];
    for (const waiter of this.waiters) {
      if (waiter.keys.every((key) => !this.held.has(key))) {
        for (const key of waiter.keys) this.held.add(key);
        waiter.grant();
      } else {
        remaining.push(waiter);
      }
    }
    this.waiters = remaining;
  }
}

function lockKeys(run: DecisionRun, request: DecisionRequest): string[] {
  const keys = [`run:${run.id}`, `incident:${run.incidentId}`, `key:${request.idempotencyKey}`];
  if (request.action === "approve" && run.recommendation?.recommended_responder_id) {
    keys.push(`responder:${run.recommendation.recommended_responder_id}`);
  }
  if (request.action === "override" && request.selectedResponderId) {
    keys.push(`responder:${request.selectedResponderId}`);
  }
  return keys;
}

function applyPlan(state: LedgerState, plan: PlanOutcome & { ok: true; replay: false }): void {
  const mutation = plan.plan;
  const incident = state.incidents.find((item) => item.id === mutation.decision.incidentId);
  if (!incident) throw new Error("incident disappeared");
  if (mutation.incidentStatus) incident.status = mutation.incidentStatus;
  if (mutation.incidentPriority) incident.priority = mutation.incidentPriority;
  incident.updatedAt = mutation.decision.createdAt;
  if (mutation.responderIdToBusy) {
    const responder = state.responders.find((item) => item.id === mutation.responderIdToBusy);
    if (!responder || responder.availability !== "AVAILABLE") {
      throw new Error("responder write conflict");
    }
    responder.availability = "BUSY";
    responder.updatedAt = mutation.decision.createdAt;
  }
  if (mutation.assignment) {
    if (state.assignments.some((item) => item.incidentId === mutation.assignment?.incidentId)) {
      throw new Error("assignment write conflict");
    }
    state.assignments.push(mutation.assignment);
  }
  state.decisions.push(mutation.decision);
}

export function countBaseline(state: LedgerState): number {
  return state.assignments.filter((item) => item.origin === "scenario_baseline").length;
}
