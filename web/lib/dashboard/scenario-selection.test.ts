import assert from "node:assert/strict";
import test from "node:test";

import {
  DASHBOARD_SCENARIOS,
  parseDashboardScenario,
} from "@/lib/dashboard/scenario-selection";

test("the scenario selector defaults to Urban Flood and accepts only the Chaos option", () => {
  assert.equal(DASHBOARD_SCENARIOS[0]?.id, "flood");
  assert.equal(DASHBOARD_SCENARIOS[0]?.href, "/");
  assert.equal(DASHBOARD_SCENARIOS[0]?.label, "Urban Flood — Demo City");
  assert.equal(DASHBOARD_SCENARIOS[1]?.id, "chaos");
  assert.equal(DASHBOARD_SCENARIOS[1]?.href, "/?scenario=chaos");
  assert.equal(DASHBOARD_SCENARIOS[1]?.label, "Chaos Simulation");

  assert.equal(parseDashboardScenario(undefined), "flood");
  assert.equal(parseDashboardScenario(""), "flood");
  assert.equal(parseDashboardScenario("flood"), "flood");
  assert.equal(parseDashboardScenario("scn_demo_flood"), "flood");
  assert.equal(parseDashboardScenario("scn_chaos_sample"), "flood");
  assert.equal(parseDashboardScenario(["chaos", "flood"]), "flood");
  assert.equal(parseDashboardScenario("chaos"), "chaos");
  assert.equal(parseDashboardScenario(["chaos"]), "chaos");
});
