import type { ScenarioMetrics } from "@/lib/demo/metrics";

const CARDS: Array<{
  key: keyof ScenarioMetrics;
  label: string;
  hint: string;
}> = [
  {
    key: "totalReports",
    label: "Total reports",
    hint: "Original messages kept",
  },
  {
    key: "needsReview",
    label: "Needs review",
    hint: "New or needs review",
  },
  {
    key: "availableResponders",
    label: "Available responders",
    hint: "Seeded units only",
  },
  {
    key: "simulatedAssignments",
    label: "Simulated assignments",
    hint: "Scenario baseline, not AI",
  },
];

export function MetricsStrip({ metrics }: { metrics: ScenarioMetrics }) {
  return (
    <section
      aria-label="Scenario overview"
      className="shrink-0 border-b border-white/10 bg-[#071018] px-3 py-3 sm:px-4"
    >
      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {CARDS.map((card) => (
          <div
            key={card.key}
            className="rounded-xl border border-cyan-200/10 bg-white/[0.03] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
          >
            <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
              {card.label}
            </dt>
            <dd className="mt-1 font-mono text-2xl font-semibold text-white">
              {metrics[card.key]}
            </dd>
            <dd className="mt-1 text-[11px] text-slate-500">{card.hint}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
