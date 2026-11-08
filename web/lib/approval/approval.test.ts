import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { AgentRunDto, RecommendationDto } from "@/lib/ai/types";
import { handleApprovalRequest, type ApprovalStore } from "@/lib/approval/handle-decision";
import { DecisionLedger, type LedgerState } from "@/lib/approval/ledger";
import { assertLocalDemoGate, localDemoToken } from "@/lib/approval/local-gate";
import type { DecisionRequest } from "@/lib/approval/types";
import { fromAgentRunRow, toAgentRunRow } from "@/lib/approval/rows";
import { applyCommandSnapshot, toCommandSnapshot } from "@/lib/approval/snapshot";
import { previewApproval } from "@/lib/approval/ui-state";
import { DEMO_SCENARIO } from "@/lib/demo/scenario";
import type {
  Assignment,
  Incident,
  Responder,
  Scenario,
} from "@/lib/demo/types";
import {
  assembleStandardDemo,
  type StandardDemoRows,
} from "@/lib/supabase/standard-demo-parse";

const KEY = "00000000-0000-4000-8000-000000000001";
const KEY_2 = "00000000-0000-4000-8000-000000000002";
const NOW = "2026-11-08T04:00:00.000Z";

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "inc_0001",
    scenarioId: "scn_demo_flood",
    summary: "Water rescue case",
    category: "water_rescue",
    district: "Riverside",
    lat: 32.7,
    lon: -96.8,
    priority: "UNASSESSED",
    priorityBasis: "Generator label",
    status: "NEW",
    lowDetail: false,
    reportIds: ["rpt_0001"],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function responder(overrides: Partial<Responder> = {}): Responder {
  return {
    id: "unit_01",
    scenarioId: "scn_demo_flood",
    callsign: "WAVE-1",
    capabilities: ["water rescue", "boat"],
    availability: "AVAILABLE",
    lat: 32.7,
    lon: -96.8,
    updatedAt: NOW,
    ...overrides,
  };
}

function recommendation(overrides: Partial<RecommendationDto> = {}): RecommendationDto {
  return {
    incident_id: "inc_0001",
    proposed_priority: "MEDIUM",
    summary: "Advisory summary",
    evidence: ["incident:inc_0001"],
    missing_information: [],
    uncertainty: "Depth is unknown",
    recommended_responder_id: "unit_01",
    recommended_responder: {
      id: "unit_01",
      callsign: "WAVE-1",
      availability: "AVAILABLE",
      capabilities: ["water rescue", "boat"],
    },
    rationale: "The tool results support a review.",
    requires_human_approval: true,
    advisory: true,
    data_source: "nvidia_nemotron",
    ...overrides,
  };
}

function baseline(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: "asn_0001",
    incidentId: "inc_0099",
    responderId: "unit_02",
    status: "IN_PROGRESS",
    assignedAt: NOW,
    origin: "scenario_baseline",
    note: "Scenario baseline assignment. Not an AI decision.",
    ...overrides,
  };
}

function state(overrides: Partial<LedgerState> = {}): LedgerState {
  return {
    incidents: [incident(), incident({ id: "inc_0002", category: "water_rescue" })],
    responders: [
      responder(),
      responder({
        id: "unit_02",
        callsign: "WAVE-2",
        availability: "BUSY",
      }),
      responder({
        id: "unit_08",
        callsign: "SCOUT-9",
        capabilities: ["search"],
        availability: "OFFLINE",
      }),
      responder({
        id: "unit_12",
        callsign: "RELAY-11",
        capabilities: ["communications"],
        availability: "AVAILABLE",
      }),
    ],
    assignments: [baseline()],
    runs: [
      {
        id: "run_00000000-0000-4000-8000-0000000000aa",
        status: "COMPLETED",
        incidentId: "inc_0001",
        scenarioId: "scn_demo_flood",
        recommendation: recommendation(),
      },
      {
        id: "run_00000000-0000-4000-8000-0000000000bb",
        status: "COMPLETED",
        incidentId: "inc_0002",
        scenarioId: "scn_demo_flood",
        recommendation: recommendation({
          incident_id: "inc_0002",
          recommended_responder_id: "unit_01",
        }),
      },
    ],
    decisions: [],
    ...overrides,
  };
}

function request(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    action: "approve",
    confirmed: true,
    reason: "",
    idempotencyKey: KEY,
    selectedPriority: null,
    selectedResponderId: null,
    ...overrides,
  };
}

function rowsFrom(scenario: Scenario): StandardDemoRows {
  return {
    scenario: [
      {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        seed: scenario.seed,
        is_active: true,
      },
    ],
    incidents: scenario.incidents.map((item) => ({
      id: item.id,
      scenario_id: item.scenarioId,
      title: item.summary,
      description: item.summary,
      category: item.category,
      district: item.district,
      latitude: item.lat,
      longitude: item.lon,
      priority: item.priority,
      priority_basis: item.priorityBasis,
      status: item.status,
      low_detail: item.lowDetail,
      sample_key: item.sampleKey ?? null,
      report_ids: item.reportIds,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
    })),
    reports: scenario.reports.map((item) => ({
      id: item.id,
      scenario_id: item.scenarioId,
      incident_id: item.incidentId,
      source: "seed",
      raw_text: item.rawText,
      reported_lat: item.reportedLat,
      reported_lon: item.reportedLon,
      received_at: item.receivedAt,
      analysis_status: "NOT_AI_REVIEWED",
    })),
    responders: scenario.responders.map((item) => ({
      id: item.id,
      scenario_id: item.scenarioId,
      callsign: item.callsign,
      capabilities: item.capabilities,
      availability: item.availability,
      latitude: item.lat,
      longitude: item.lon,
      updated_at: item.updatedAt,
    })),
    assignments: scenario.assignments.map((item) => ({
      id: item.id,
      incident_id: item.incidentId,
      responder_id: item.responderId,
      status: item.status,
      assigned_at: item.assignedAt,
      origin: item.origin,
      note: item.note,
    })),
  };
}

test("approve valid recommendation creates one simulated assignment", async () => {
  const ledger = new DecisionLedger(state());
  const before = ledger.snapshot();
  const outcome = await ledger.apply(
    "run_00000000-0000-4000-8000-0000000000aa",
    request({ selectedResponderId: "unit_12" }),
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok || outcome.replay) return;
  assert.equal(outcome.plan.assignment?.responderId, "unit_01");
  assert.equal(outcome.plan.assignment?.origin, "human_approval");
  assert.equal(outcome.plan.decision.operatorLabel, "local_demo_operator");
  const after = ledger.snapshot();
  assert.equal(after.assignments.length, before.assignments.length + 1);
  assert.equal(
    after.responders.find((item) => item.id === "unit_01")?.availability,
    "BUSY",
  );
  assert.equal(after.incidents[0]?.status, "ASSIGNED");
  assert.equal(after.incidents[0]?.priority, "MEDIUM");
});

test("reject recommendation leaves assignment and availability unchanged", async () => {
  const ledger = new DecisionLedger(state());
  const before = ledger.snapshot();
  const outcome = await ledger.apply(
    "run_00000000-0000-4000-8000-0000000000aa",
    request({ action: "reject", reason: "Not enough detail" }),
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok || outcome.replay) return;
  assert.equal(outcome.plan.assignment, null);
  const after = ledger.snapshot();
  assert.deepEqual(after.assignments, before.assignments);
  assert.deepEqual(
    after.responders.map((item) => item.availability),
    before.responders.map((item) => item.availability),
  );
  assert.equal(after.incidents[0]?.status, "NEW");
});

test("priority override does not create an assignment", async () => {
  const ledger = new DecisionLedger(state());
  const outcome = await ledger.apply(
    "run_00000000-0000-4000-8000-0000000000aa",
    request({
      action: "override",
      reason: "Operator judges this lower",
      selectedPriority: "LOW",
    }),
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok || outcome.replay) return;
  assert.equal(outcome.plan.assignment, null);
  assert.equal(outcome.plan.decision.assignmentCreated, false);
  assert.equal(ledger.snapshot().incidents[0]?.priority, "LOW");
  assert.equal(ledger.snapshot().incidents[0]?.status, "NEW");
  assert.equal(ledger.snapshot().assignments.length, 1);
});

test("responder override records the human unit and the original draft", async () => {
  const ledger = new DecisionLedger(state());
  const outcome = await ledger.apply(
    "run_00000000-0000-4000-8000-0000000000aa",
    request({
      action: "override",
      reason: "Use the other boat",
      selectedResponderId: "unit_01",
      selectedPriority: "HIGH",
    }),
  );
  assert.equal(outcome.ok, true);
  if (!outcome.ok || outcome.replay) return;
  assert.equal(outcome.plan.assignment?.origin, "human_override");
  assert.equal(outcome.plan.decision.originalRecommendation.proposed_priority, "MEDIUM");
  assert.equal(outcome.plan.decision.selectedPriority, "HIGH");
  assert.equal(outcome.plan.decision.humanDecision, true);
});

test("reject missing reason", async () => {
  const ledger = new DecisionLedger(state());
  const outcome = await ledger.apply(
    "run_00000000-0000-4000-8000-0000000000aa",
    request({ action: "reject", reason: "   " }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.code, "REASON_REQUIRED");
  assert.equal(ledger.snapshot().decisions.length, 0);
});

test("reject invalid responder", async () => {
  const ledger = new DecisionLedger(state());
  const outcome = await ledger.apply(
    "run_00000000-0000-4000-8000-0000000000aa",
    request({
      action: "override",
      reason: "Try a missing unit",
      selectedResponderId: "unit_99",
    }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.code, "RESPONDER_NOT_FOUND");
});

test("reject incompatible responder", async () => {
  const ledger = new DecisionLedger(state());
  const outcome = await ledger.apply(
    "run_00000000-0000-4000-8000-0000000000aa",
    request({
      action: "override",
      reason: "Communications cannot make this rescue",
      selectedResponderId: "unit_12",
    }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.code, "RESPONDER_INCOMPATIBLE");
  assert.match(outcome.message, /communications/i);
});

test("reject busy responder", async () => {
  const ledger = new DecisionLedger(state());
  const outcome = await ledger.apply(
    "run_00000000-0000-4000-8000-0000000000aa",
    request({
      action: "override",
      reason: "Try the busy boat",
      selectedResponderId: "unit_02",
      selectedPriority: "HIGH",
    }),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.code, "RESPONDER_BUSY");
});

test("reject already-assigned incident and keep the baseline", async () => {
  const initial = state({
    incidents: [
      incident({ id: "inc_0001", status: "IN_PROGRESS" }),
      incident({ id: "inc_0002" }),
    ],
    assignments: [baseline({ id: "asn_0008", incidentId: "inc_0001", responderId: "unit_02" })],
  });
  const ledger = new DecisionLedger(initial);
  const outcome = await ledger.apply(
    "run_00000000-0000-4000-8000-0000000000aa",
    request(),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.code, "ALREADY_ASSIGNED");
  assert.deepEqual(ledger.snapshot().assignments, initial.assignments);
});

test("concurrent decisions cannot book the same responder twice", async () => {
  const ledger = new DecisionLedger(state());
  let release: () => void = () => undefined;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = ledger.apply(
    "run_00000000-0000-4000-8000-0000000000aa",
    request(),
    { afterLock: () => hold },
  );
  const second = ledger.apply(
    "run_00000000-0000-4000-8000-0000000000bb",
    request({ idempotencyKey: KEY_2 }),
  );
  release();
  const [left, right] = await Promise.all([first, second]);
  const outcomes = [left, right];
  assert.equal(outcomes.filter((item) => item.ok && !item.replay).length, 1);
  assert.equal(outcomes.filter((item) => !item.ok).length, 1);
  const failed = outcomes.find((item) => !item.ok);
  assert.equal(failed && !failed.ok ? failed.code : "", "RESPONDER_BUSY");
  const booked = ledger
    .snapshot()
    .assignments.filter((item) => item.responderId === "unit_01" && item.status !== "COMPLETED");
  assert.equal(booked.length, 1);
});

test("repeated decisions are idempotent", async () => {
  const ledger = new DecisionLedger(state());
  const first = await ledger.apply(
    "run_00000000-0000-4000-8000-0000000000aa",
    request(),
  );
  const second = await ledger.apply(
    "run_00000000-0000-4000-8000-0000000000aa",
    request({ idempotencyKey: KEY_2 }),
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.replay, true);
  assert.equal(
    ledger.snapshot().assignments.filter((item) => item.origin === "human_approval").length,
    1,
  );
  assert.equal(ledger.snapshot().decisions.length, 1);
});

test("database failure rolls the transaction back", async () => {
  const ledger = new DecisionLedger(state());
  const before = ledger.snapshot();
  await assert.rejects(
    ledger.apply("run_00000000-0000-4000-8000-0000000000aa", request(), {
      beforePublish: () => {
        throw new Error("audit write failed");
      },
    }),
  );
  assert.deepEqual(ledger.snapshot(), before);
});

test("Next.js loopback forwarding headers still require the local credential", async () => {
  let writes = 0;
  const store: ApprovalStore = {
    async apply() {
      writes += 1;
      throw new Error("store should not be called");
    },
  };
  const token = localDemoToken("server-secret");
  const headers = {
    host: "localhost:3000",
    "content-type": "application/json",
    cookie: `resq_local_demo=${token}`,
    "x-resq-local-demo": "1",
    "x-forwarded-for": "::1",
    "x-forwarded-host": "localhost:3000",
  };
  const accepted = assertLocalDemoGate({
    url: "http://localhost:3000/api/approvals",
    hostHeader: headers.host,
    forwardedFor: headers["x-forwarded-for"],
    forwardedHost: headers["x-forwarded-host"],
    realIp: null,
    connectingIp: null,
    cookieHeader: headers.cookie,
    demoHeader: "1",
    secret: "server-secret",
    enabled: true,
  });
  assert.equal(accepted.ok, true);
  const response = await handleApprovalRequest(
    new Request("http://localhost:3000/api/approvals", {
      method: "POST",
      headers,
      body: JSON.stringify({ confirmed: true }),
    }),
    { secret: "server-secret", enabled: true, store },
  );
  assert.equal(response.status, 400);
  assert.equal(writes, 0);
  const mapped = assertLocalDemoGate({
    url: "http://127.0.0.1:3000/api/approvals",
    hostHeader: "127.0.0.1:3000",
    forwardedFor: "::ffff:127.0.0.1",
    forwardedHost: "127.0.0.1:3000",
    realIp: null,
    connectingIp: null,
    cookieHeader: `resq_local_demo=${localDemoToken("server-secret")}`,
    demoHeader: "1",
    secret: "server-secret",
    enabled: true,
  });
  assert.equal(mapped.ok, true);
});

test("proxy headers and a missing local credential do not write", async () => {
  let writes = 0;
  const store: ApprovalStore = {
    async apply() {
      writes += 1;
      throw new Error("store should not be called");
    },
  };
  const token = localDemoToken("server-secret");
  const cases: Array<Record<string, string>> = [
    { "x-forwarded-for": "203.0.113.5", "x-forwarded-host": "localhost:3000" },
    { "x-forwarded-for": "127.0.0.1, 203.0.113.5", "x-forwarded-host": "localhost:3000" },
    { "x-forwarded-for": "::1", "x-forwarded-host": "demo.example" },
    { "x-forwarded-for": "::1", "x-forwarded-host": "localhost:3000", "x-real-ip": "127.0.0.1" },
    { "x-forwarded-for": "::1", "x-forwarded-host": "localhost:3000", "cf-connecting-ip": "::1" },
  ];
  for (const extra of cases) {
    const response = await handleApprovalRequest(
      new Request("http://localhost:3000/api/approvals", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          "content-type": "application/json",
          cookie: `resq_local_demo=${token}`,
          "x-resq-local-demo": "1",
          ...extra,
        },
        body: JSON.stringify({
          incident_id: "inc_0001",
          agent_run_id: "run_00000000-0000-4000-8000-0000000000aa",
          action: "approve",
          confirmed: true,
          idempotency_key: KEY,
        }),
      }),
      { secret: "server-secret", enabled: true, store },
    );
    assert.equal(response.status, 403);
    const body = (await response.json()) as { message?: string };
    assert.match(body.message ?? "", /proxy/);
  }
  assert.equal(writes, 0);
});

test("unauthorized privileged request does not write", async () => {
  let writes = 0;
  const store: ApprovalStore = {
    async apply() {
      writes += 1;
      throw new Error("store should not be called");
    },
  };
  const response = await handleApprovalRequest(
    new Request("http://localhost:3000/api/approvals", {
      method: "POST",
      headers: {
        host: "localhost:3000",
        "content-type": "application/json",
        "x-resq-local-demo": "1",
      },
      body: JSON.stringify({
        incident_id: "inc_0001",
        agent_run_id: "run_00000000-0000-4000-8000-0000000000aa",
        action: "approve",
        confirmed: true,
        idempotency_key: KEY,
        operator_id: "forged-admin",
      }),
    }),
    { secret: "server-secret", enabled: true, store },
  );
  assert.equal(response.status, 403);
  assert.equal(writes, 0);
  const body = (await response.json()) as { assignment_created?: boolean; message?: string };
  assert.equal(body.assignment_created, false);
  assert.match(body.message ?? "", /Nothing was assigned/);
});

test("Nemotron output does not assign by itself", () => {
  const orchestrator = readFileSync(
    new URL("../ai/agent-orchestrator.ts", import.meta.url),
    "utf8",
  );
  assert.match(orchestrator, /assignment_created: false/);
  assert.doesNotMatch(orchestrator, /apply_human_decision|approval_actions|from\("assignments"\)/);
  const draft = recommendation();
  assert.equal(draft.advisory, true);
  assert.equal(draft.requires_human_approval, true);
});

test("investigation rows round-trip without secrets or a new model call", () => {
  const secret = "nvapi-secretvalue";
  const run: AgentRunDto = {
    run_id: "run_00000000-0000-4000-8000-0000000000aa",
    status: "COMPLETED",
    model_id: "nvidia/nemotron-test",
    incident_id: "inc_0001",
    scenario_id: "scn_demo_flood",
    simulation: true,
    advisory: true,
    assignment_created: false,
    multi_step: true,
    distinct_tool_count: 2,
    tool_call_count: 2,
    tool_events: [],
    recommendation: recommendation({ summary: `keep ${secret} out` }),
    validation_retried: false,
    recorded_by: "server",
    started_at: NOW,
    finished_at: NOW,
    error: null,
  };
  const restored = fromAgentRunRow(toAgentRunRow(run));
  assert.ok(restored);
  assert.equal(restored?.recommendation?.proposed_priority, "MEDIUM");
  assert.equal(restored?.assignment_created, false);
  assert.equal(JSON.stringify(restored).includes(secret), false);
  const history = readFileSync(new URL("./history.ts", import.meta.url), "utf8");
  assert.doesNotMatch(history, /callNemotron|investigateIncident/);
});

test("history restoration preserves the original recommendation", () => {
  const run: AgentRunDto = {
    run_id: "run_00000000-0000-4000-8000-0000000000aa",
    status: "COMPLETED",
    model_id: "nvidia/nemotron-test",
    incident_id: "inc_0001",
    scenario_id: "scn_demo_flood",
    simulation: true,
    advisory: true,
    assignment_created: false,
    multi_step: false,
    distinct_tool_count: 1,
    tool_call_count: 1,
    tool_events: [],
    recommendation: recommendation(),
    validation_retried: false,
    recorded_by: "server",
    started_at: NOW,
    finished_at: NOW,
    error: null,
  };
  const restored = fromAgentRunRow(toAgentRunRow(run));
  assert.deepEqual(restored?.recommendation, run.recommendation);
  assert.equal(restored?.stored, true);
});

test("baseline assignments stay intact when a human assignment is added", () => {
  const parsed = assembleStandardDemo(rowsFrom(DEMO_SCENARIO));
  assert.equal(parsed.assignments.filter((item) => item.origin === "scenario_baseline").length, 9);
  const openIncident = parsed.incidents.find((item) => item.status === "NEW");
  const available = parsed.responders.find((item) => item.availability === "AVAILABLE");
  assert.ok(openIncident && available);
  const rows = rowsFrom(parsed);
  const assignments = rows.assignments as Array<Record<string, unknown>>;
  assignments.push({
    id: "asn_h_0123456789abcdef0123456789abcdef",
    incident_id: openIncident?.id,
    responder_id: available?.id,
    status: "ASSIGNED",
    assigned_at: NOW,
    origin: "human_approval",
    note: "Human approval in the local simulation.",
  });
  const incidents = rows.incidents as Array<Record<string, unknown>>;
  const target = incidents.find((item) => item.id === openIncident?.id);
  if (target) target.status = "ASSIGNED";
  const responders = rows.responders as Array<Record<string, unknown>>;
  const unit = responders.find((item) => item.id === available?.id);
  if (unit) unit.availability = "BUSY";
  const withHuman = assembleStandardDemo(rows);
  assert.equal(withHuman.assignments.filter((item) => item.origin === "scenario_baseline").length, 9);
  assert.equal(withHuman.assignments.filter((item) => item.origin === "human_approval").length, 1);
  assert.throws(() => {
    const broken = rowsFrom(DEMO_SCENARIO);
    (broken.assignments as unknown[]).pop();
    assembleStandardDemo(broken);
  }, /baseline assignments/);
});

test("scenario isolation rejects a unit from another scenario", async () => {
  const ledger = new DecisionLedger(
    state({
      responders: [
        responder({ scenarioId: "scn_other" }),
        responder({ id: "unit_02", callsign: "WAVE-2", availability: "BUSY" }),
      ],
    }),
  );
  const outcome = await ledger.apply(
    "run_00000000-0000-4000-8000-0000000000aa",
    request(),
  );
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.code, "RESPONDER_NOT_FOUND");
});

test("responses redact secret values", async () => {
  const secret = "sb_secret_exampletoken";
  const store: ApprovalStore = {
    async apply() {
      return {
        type: "unavailable",
        message: `database said ${secret} and nvapi-livekey and eyJaaaa.bbbb.cccc`,
      };
    },
  };
  const response = await handleApprovalRequest(authedRequest({
    incident_id: "inc_0001",
    agent_run_id: "run_00000000-0000-4000-8000-0000000000aa",
    action: "approve",
    confirmed: true,
    idempotency_key: KEY,
  }), { secret: "server-secret", enabled: true, store });
  const text = await response.text();
  assert.equal(text.includes(secret), false);
  assert.equal(text.includes("nvapi-livekey"), false);
  assert.equal(text.includes("eyJaaaa"), false);
  assert.match(text, /\[redacted\]/);
});

test("approval preview matches the server planner", async () => {
  const current = state();
  const ledger = new DecisionLedger(current);
  const preview = previewApproval({
    incident: current.incidents[0] as Incident,
    responders: current.responders,
    assignments: current.assignments,
    run: {
      run_id: "run_00000000-0000-4000-8000-0000000000aa",
      status: "COMPLETED",
      model_id: null,
      incident_id: "inc_0001",
      scenario_id: "scn_demo_flood",
      simulation: true,
      advisory: true,
      assignment_created: false,
      multi_step: false,
      distinct_tool_count: 0,
      tool_call_count: 0,
      tool_events: [],
      recommendation: recommendation(),
      validation_retried: false,
      recorded_by: "server",
      started_at: NOW,
      finished_at: NOW,
      error: null,
    },
    decisions: [],
    storageReady: true,
    approvalsOptIn: true,
  });
  const outcome = await ledger.apply(
    "run_00000000-0000-4000-8000-0000000000aa",
    request(),
  );
  assert.equal(preview.approve.enabled, outcome.ok);
  const blocked = previewApproval({
    incident: incident({ status: "IN_PROGRESS" }),
    responders: current.responders,
    assignments: [baseline({ incidentId: "inc_0001", responderId: "unit_02" })],
    run: null,
    decisions: [],
    storageReady: true,
    approvalsOptIn: true,
  });
  assert.equal(blocked.approve.enabled, false);
  const snapshot = toCommandSnapshot(DEMO_SCENARIO);
  snapshot.assignments = snapshot.assignments.filter((item) => item.id !== snapshot.assignments[0]?.id);
  const applied = applyCommandSnapshot(DEMO_SCENARIO, snapshot);
  assert.equal(applied.ok, false);
});

test("migration and proxy grants stay limited to the server role", () => {
  const sql = readFileSync(
    new URL("../../scripts/2026-11-07-human-approval.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.apply_human_decision\(jsonb\) TO service_role/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.approval_actions TO service_role/);
  assert.match(sql, /GRANT SELECT, UPDATE ON TABLE public\.incidents TO service_role/);
  assert.match(sql, /GRANT SELECT, UPDATE ON TABLE public\.responders TO service_role/);
  assert.match(sql, /GRANT SELECT, INSERT, UPDATE ON TABLE public\.assignments TO service_role/);
  assert.doesNotMatch(sql, /GRANT[\s\S]{0,80}TO anon/);
  assert.doesNotMatch(sql, /GRANT[\s\S]{0,80}TO authenticated/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
});

function authedRequest(body: unknown): Request {
  const token = localDemoToken("server-secret");
  return new Request("http://localhost:3000/api/approvals", {
    method: "POST",
    headers: {
      host: "localhost:3000",
      "content-type": "application/json",
      cookie: `resq_local_demo=${token}`,
      "x-resq-local-demo": "1",
    },
    body: JSON.stringify(body),
  });
}
