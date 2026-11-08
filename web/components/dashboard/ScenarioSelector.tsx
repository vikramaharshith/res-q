import Link from "next/link";

import { cn } from "@/lib/cn";
import {
  DASHBOARD_SCENARIOS,
  type DashboardScenarioId,
} from "@/lib/dashboard/scenario-selection";

export function ScenarioSelector({ active }: { active: DashboardScenarioId }) {
  return (
    <nav aria-label="Scenario" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {DASHBOARD_SCENARIOS.map((option) => {
        const current = option.id === active;
        return (
          <Link
            key={option.id}
            href={option.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors duration-200 sm:py-1.5",
              current
                ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100"
                : "border-white/10 text-zinc-400 hover:border-white/20 hover:text-white",
            )}
          >
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
