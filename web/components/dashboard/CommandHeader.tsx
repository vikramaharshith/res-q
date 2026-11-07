import type { Scenario } from "@/lib/demo/types";

export function CommandHeader({ scenario }: { scenario: Scenario }) {
  return (
    <header className="shrink-0 border-b border-white/10 bg-[#08131f]/95 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[0.18em] text-white">
            RES-Q
            <span className="ml-2 align-middle text-[10px] font-medium tracking-[0.28em] text-slate-500">
              by B7
            </span>
          </h1>
          <p className="mt-1 text-sm text-slate-200">{scenario.name}</p>
          <p className="mt-1 text-xs text-slate-400">
            Command center · seed {scenario.seed} · {scenario.incidents.length}{" "}
            incidents from {scenario.reports.length} original reports
          </p>
        </div>
        <p className="rounded-full border border-slate-600/80 bg-slate-900/70 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-300">
          Nemotron not connected
        </p>
      </div>
    </header>
  );
}
