import { cn } from "@/lib/cn";
import type { ScenarioMetrics } from "@/lib/demo/metrics";

const CARDS: Array<{
  key: keyof ScenarioMetrics;
  label: string;
  hint: string;
  valueClass: string;
  ruleClass: string;
}> = [
  {
    key: "totalReports",
    label: "Total Reports",
    hint: "Original messages kept",
    valueClass: "text-white",
    ruleClass: "bg-zinc-400",
  },
  {
    key: "needsReview",
    label: "Needs Review",
    hint: "New or needs review",
    valueClass: "text-amber-300",
    ruleClass: "bg-amber-300",
  },
  {
    key: "availableResponders",
    label: "Available Responders",
    hint: "Seeded units only",
    valueClass: "text-emerald-300",
    ruleClass: "bg-emerald-300",
  },
  {
    key: "simulatedAssignments",
    label: "Assignments",
    hint: "Baseline plus human decisions",
    valueClass: "text-cyan-200",
    ruleClass: "bg-cyan-300",
  },
];

export function MetricsStrip({ metrics }: { metrics: ScenarioMetrics }) {
  return (
    <section aria-label="Scenario overview" className="startup-chrome-top">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {CARDS.map((card) => (
          <div
            key={card.key}
            className="rounded-2xl border border-white/[0.06] bg-[#101010] px-4 py-4 transition-[border-color,background-color] duration-200 hover:border-white/[0.14] hover:bg-[#141414] sm:px-5 sm:py-5"
          >
            <dt className="flex items-start gap-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 sm:text-[11px]">
              <span
                className={cn("mt-1.5 h-1 w-5 shrink-0 rounded-full", card.ruleClass)}
                aria-hidden
              />
              <span>{card.label}</span>
            </dt>
            <dd
              className={cn(
                "mt-3 text-4xl font-medium tracking-tight tabular-nums sm:text-5xl",
                card.valueClass,
              )}
            >
              {metrics[card.key]}
            </dd>
            <dd className="mt-2 text-xs leading-5 text-zinc-500">
              {card.key === "simulatedAssignments"
                ? `${metrics.baselineAssignments} baseline · ${metrics.humanAssignments} human-approved`
                : card.hint}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
