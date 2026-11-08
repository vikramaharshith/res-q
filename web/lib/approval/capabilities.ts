import type { IncidentCategory } from "@/lib/demo/types";

/**
 * A simulated unit fits a case when it has at least one capability the
 * category needs. This is a demo compatibility rule, not a real dispatch rule.
 * Communications-only and medical-support-only units do not fit these cases.
 */
const REQUIRED_CAPABILITIES: Record<IncidentCategory, readonly string[]> = {
  structure_flood: [
    "water rescue",
    "evacuation",
    "flood control",
    "high-water vehicle",
  ],
  stranded_vehicle: ["high-water vehicle", "evacuation", "water rescue"],
  evacuation_assistance: ["evacuation", "shelter transport", "high-water vehicle"],
  welfare_check: ["search", "welfare check"],
  utility_hazard: ["utilities", "power isolation"],
  water_rescue: ["water rescue", "boat"],
  supply_request: ["supplies", "evacuation"],
};

export function requiredCapabilities(category: IncidentCategory): readonly string[] {
  return REQUIRED_CAPABILITIES[category];
}

function capabilityMatches(owned: string, needed: string): boolean {
  if (owned === needed) return true;
  return needed.length >= 4 && owned.includes(needed);
}

export function capabilityFits(
  category: IncidentCategory,
  capabilities: readonly string[],
): boolean {
  const needed = requiredCapabilities(category);
  const owned = capabilities.map((item) => item.toLowerCase());
  return needed.some((needle) =>
    owned.some((capability) => capabilityMatches(capability, needle)),
  );
}

export function capabilityGap(
  category: IncidentCategory,
  capabilities: readonly string[],
): string {
  const needed = requiredCapabilities(category).join(", ");
  const owned = capabilities.length > 0 ? capabilities.join(", ") : "none";
  return `This unit's capabilities (${owned}) do not cover a ${category.replaceAll("_", " ")} case. A compatible unit needs one of: ${needed}.`;
}
