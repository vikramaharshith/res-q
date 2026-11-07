import { generateFloodScenario } from "@/lib/demo/seed-scenario";

export const DEMO_SEED = 20261107;
export const DEMO_REPORT_COUNT = 100;

export const DEMO_SCENARIO = generateFloodScenario({
  seed: DEMO_SEED,
  reportCount: DEMO_REPORT_COUNT,
});
