import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assembleChaosSimulation, type ChaosSampleRows } from "@/lib/chaos/read-model";
import { CHAOS_BOUND_SCENARIO_ID, parseChaosInvestigationRequest } from "@/lib/chaos/investigation-contract";
import { bindChaosObservation, interpretChaosAdvisory } from "@/lib/chaos/investigation-payload";
import {
  SAMPLE_CHAOS_DESTINATION,
  SAMPLE_CHAOS_DIGEST_HEX,
  SAMPLE_CHAOS_SEED,
} from "@/lib/simulation-import/chaos-import";
import { MemoryImportLedger } from "@/lib/simulation-import/ledger";
import { MemoryStagingStore, stageValidatedChaosText } from "@/lib/simulation-import/stage-plan";

const sampleText = readFileSync(new URL("../../../resq-handoff/sample-simulation.json", import.meta.url), "utf8");

function board() {
  const staged = stageValidatedChaosText(
    sampleText,
    SAMPLE_CHAOS_DESTINATION,
    new MemoryStagingStore(),
    new MemoryImportLedger(),
  );
  assert.equal(staged.ok, true);
  if (!staged.ok) throw new Error("sample did not stage");
  const rows: ChaosSampleRows = {
    run: staged.plan.run,
    emergencyObservations: staged.plan.emergencyObservations,
    operationalObservations: staged.plan.operationalObservations,
    units: staged.plan.units,
    publicAssignments: staged.plan.chaosPublicAssignments,
  };
  return assembleChaosSimulation(rows);
}

test("one emergency observation is bound without the other report or private fields", () => {
  assert.equal(CHAOS_BOUND_SCENARIO_ID, SAMPLE_CHAOS_DESTINATION);
  const sample = board();
  const first = sample.emergencyObservations[0];
  const second = sample.emergencyObservations[1];
  assert.ok(first && second);
  const bound = bindChaosObservation(sample, {
    mode: "advise",
    scenario_id: CHAOS_BOUND_SCENARIO_ID,
    observation_kind: "emergency",
    observation_id: first.reportId,
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) return;
  assert.equal(bound.bound.prompt.includes(first.reportId), true);
  assert.equal(bound.bound.prompt.includes(first.narrative), true);
  assert.equal(bound.bound.prompt.includes(second.reportId), false);
  assert.equal(bound.bound.prompt.includes(second.narrative), false);
  assert.equal(bound.bound.prompt.includes(SAMPLE_CHAOS_SEED), false);
  assert.equal(bound.bound.prompt.includes(SAMPLE_CHAOS_DIGEST_HEX), false);
  assert.equal(bound.bound.prompt.includes("replayManifest"), false);
  assert.equal(bound.bound.prompt.includes("source_seed"), false);
  assert.equal(bound.bound.prompt.includes("groundTruth"), false);
  assert.equal(bound.bound.prompt.includes(sample.runId), false);
  assert.equal(bound.bound.prompt.includes(sample.importRunId), false);
  assert.equal(bound.bound.prompt.includes(sample.sourceScenarioId), false);
  for (const item of sample.operationalObservations) {
    assert.equal(bound.bound.prompt.includes(item.observationId), false);
  }
  assert.equal(bound.bound.prompt.includes("incidentId"), false);
});

test("one delivered operational observation stays independent of the emergency reports", () => {
  const sample = board();
  const item = sample.operationalObservations[0];
  assert.ok(item);
  const bound = bindChaosObservation(sample, {
    mode: "advise",
    scenario_id: CHAOS_BOUND_SCENARIO_ID,
    observation_kind: "operational",
    observation_id: item.observationId,
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) return;
  assert.equal(bound.bound.prompt.includes(item.observationId), true);
  assert.equal(bound.bound.prompt.includes(item.unitId), true);
  assert.equal(bound.bound.prompt.includes('"deliveryStatus":"DELIVERED"'), true);
  for (const report of sample.emergencyObservations) {
    assert.equal(bound.bound.prompt.includes(report.reportId), false);
    assert.equal(bound.bound.prompt.includes(report.narrative), false);
  }
  assert.equal(bound.bound.prompt.includes(SAMPLE_CHAOS_SEED), false);
});

test("the review request rejects flood binding, extra fields, and unknown observations", () => {
  const sample = board();
  assert.equal(
    parseChaosInvestigationRequest({
      mode: "investigate",
      scenario_id: "scn_demo_flood",
      observation_kind: "emergency",
      observation_id: "rpt_demo",
    }).ok,
    false,
  );
  assert.equal(
    parseChaosInvestigationRequest({
      mode: "advise",
      scenario_id: CHAOS_BOUND_SCENARIO_ID,
      observation_kind: "emergency",
      observation_id: sample.emergencyObservations[0]?.reportId,
      seed: SAMPLE_CHAOS_SEED,
    }).ok,
    false,
  );
  assert.equal(
    parseChaosInvestigationRequest({
      mode: "advise",
      scenario_id: CHAOS_BOUND_SCENARIO_ID,
      observation_kind: "unit",
      observation_id: sample.units[0]?.unitId,
    }).ok,
    false,
  );
  const missing = bindChaosObservation(sample, {
    mode: "advise",
    scenario_id: CHAOS_BOUND_SCENARIO_ID,
    observation_kind: "emergency",
    observation_id: "rpt_not_in_sample",
  });
  assert.equal(missing.ok, false);
});

test("model output is advisory and private or extra fields are discarded", () => {
  const sample = board();
  const first = sample.emergencyObservations[0];
  assert.ok(first);
  const bound = bindChaosObservation(sample, {
    mode: "advise",
    scenario_id: CHAOS_BOUND_SCENARIO_ID,
    observation_kind: "emergency",
    observation_id: first.reportId,
  });
  assert.equal(bound.ok, true);
  if (!bound.ok) return;
  const accepted = interpretChaosAdvisory(
    JSON.stringify({ summary: "People are reported near moving water.", uncertainty: "The count is not stated." }),
    bound.bound,
    "nvidia/test",
  );
  assert.equal(accepted.status, "COMPLETED");
  assert.equal(accepted.validated, true);
  assert.equal(accepted.advisory, true);
  assert.equal(accepted.assignment_created, false);
  assert.equal(accepted.approval_recorded, false);
  assert.equal(accepted.dispatch, false);
  assert.equal(accepted.summary, "People are reported near moving water.");

  const extra = interpretChaosAdvisory(
    JSON.stringify({
      summary: "Linked incident.",
      uncertainty: "None.",
      recommended_responder_id: "unit_000001",
    }),
    bound.bound,
    "nvidia/test",
  );
  assert.equal(extra.status, "FAILED");
  assert.equal(extra.summary, null);

  const leaked = interpretChaosAdvisory(
    JSON.stringify({ summary: `seed ${SAMPLE_CHAOS_SEED}`, uncertainty: "Hidden." }),
    bound.bound,
    "nvidia/test",
  );
  assert.equal(leaked.status, "FAILED");
  assert.equal(leaked.summary, null);
  assert.equal(JSON.stringify(leaked).includes(SAMPLE_CHAOS_SEED), false);
});

test("the Chaos review path does not approve, assign, or import", () => {
  const sources = [
    readFileSync(new URL("./investigation-server.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../../app/api/chaos-investigation/route.ts", import.meta.url), "utf8"),
    readFileSync(new URL("./investigation-payload.ts", import.meta.url), "utf8"),
  ].join("\n");
  assert.equal(sources.includes("apply_human_decision"), false);
  assert.equal(sources.includes("rememberInvestigation"), false);
  assert.equal(sources.includes("investigateIncident"), false);
  assert.equal(sources.includes("stage_chaos_import"), false);
  assert.doesNotMatch(sources, /\.(insert|update|delete|upsert|rpc)\s*\(/);
  assert.equal(sources.includes('tools: []'), true);
  assert.equal(sources.includes('toolChoice: "none"'), true);
});
