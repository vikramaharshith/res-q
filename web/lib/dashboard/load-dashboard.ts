import "server-only";

import { loadStoredHistory } from "@/lib/approval/history";
import type { ApprovalHistory } from "@/lib/approval/types";
import { loadChaosSimulation } from "@/lib/chaos/load-chaos-simulation";
import type { ChaosDashboardLoad } from "@/lib/chaos/read-model";
import { loadCommandScenario } from "@/lib/demo/load-scenario";
import type { Scenario } from "@/lib/demo/types";
import type { DashboardScenarioId } from "@/lib/dashboard/scenario-selection";

export type DashboardLoad =
  | {
      readonly kind: "flood";
      readonly scenario: Scenario;
      readonly history: ApprovalHistory;
    }
  | {
      readonly kind: "chaos";
      readonly chaos: ChaosDashboardLoad;
    };

/**
 * Flood keeps the existing command-scenario loader.
 * Chaos is a separate read of the staged sample.
 */
export async function loadDashboard(selection: DashboardScenarioId): Promise<DashboardLoad> {
  if (selection === "chaos") {
    return { kind: "chaos", chaos: await loadChaosSimulation() };
  }
  const loaded = await loadCommandScenario();
  const history = await loadStoredHistory();
  return { kind: "flood", scenario: loaded.scenario, history };
}
