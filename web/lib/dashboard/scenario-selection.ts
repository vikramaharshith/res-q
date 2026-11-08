export const DASHBOARD_SCENARIOS = [
  {
    id: "flood",
    href: "/",
    label: "Urban Flood — Demo City",
  },
  {
    id: "chaos",
    href: "/?scenario=chaos",
    label: "Chaos Simulation",
  },
] as const;

export type DashboardScenarioId = (typeof DASHBOARD_SCENARIOS)[number]["id"];

/**
 * The command center opens on Urban Flood.
 * Only the exact Chaos selector value leaves that dashboard.
 */
export function parseDashboardScenario(value: unknown): DashboardScenarioId {
  if (value === "chaos") return "chaos";
  if (Array.isArray(value) && value.length === 1 && value[0] === "chaos") return "chaos";
  return "flood";
}
