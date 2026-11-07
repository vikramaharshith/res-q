import { SectionHeader } from "@/components/ui/SectionHeader";

export function InvestigationPanel({ incidentId }: { incidentId: string }) {
  return (
    <section className="border-t border-white/10">
      <SectionHeader
        title="AI investigation"
        subtitle="The agent is not connected. This panel will not invent a run."
      />
      <div className="space-y-3 px-4 py-4">
        <p className="text-sm leading-6 text-slate-300">
          No investigation has been run for{" "}
          <span className="font-mono text-cyan-100">{incidentId}</span>. The
          Nemotron agent has to run on the server. This build does not call the
          model, does not execute tools, and does not store a recommendation.
        </p>
        <button
          type="button"
          disabled
          aria-describedby="nemotron-unavailable"
          className="cursor-not-allowed rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-500"
        >
          Investigate with Nemotron
        </button>
        <p id="nemotron-unavailable" className="text-xs leading-5 text-slate-500">
          Disabled until the backend investigation route is connected.
        </p>
        <div className="rounded-xl border border-dashed border-white/15 bg-black/20 px-3 py-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            Tool trace
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            No tool events. This list stays empty until a real server-side
            Nemotron run records one.
          </p>
        </div>
      </div>
    </section>
  );
}
