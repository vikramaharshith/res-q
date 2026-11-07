import type { InvestigationSession } from "@/lib/ai/types";
import { cn } from "@/lib/cn";
import type { Scenario } from "@/lib/demo/types";

export type AgentHeaderState = "idle" | "running" | "draft" | "failed";

const AGENT_LABEL: Record<AgentHeaderState, string> = {
  idle: "Nemotron not run yet",
  running: "Nemotron investigating",
  draft: "Nemotron draft · advisory",
  failed: "Nemotron run failed",
};

const AGENT_PILL: Record<AgentHeaderState, string> = {
  idle: "border-slate-600/80 bg-slate-900/70 text-slate-300",
  running: "border-cyan-300/40 bg-cyan-300/10 text-cyan-50",
  draft: "border-cyan-300/40 bg-cyan-300/10 text-cyan-50",
  failed: "border-rose-300/40 bg-rose-400/10 text-rose-100",
};

export function agentHeaderState(
  sessions: Record<string, InvestigationSession>,
  runningId: string | null,
): AgentHeaderState {
  if (runningId) return "running";
  let failed = false;
  for (const session of Object.values(sessions)) {
    if (session.phase === "done" && session.run.status === "COMPLETED") {
      return "draft";
    }
    if (session.phase === "done" && session.run.status === "FAILED") {
      failed = true;
    }
  }
  return failed ? "failed" : "idle";
}

export function CommandHeader({
  scenario,
  agentState,
}: {
  scenario: Scenario;
  agentState: AgentHeaderState;
}) {
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
        <p
          className={cn(
            "rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em]",
            AGENT_PILL[agentState],
          )}
        >
          {AGENT_LABEL[agentState]}
        </p>
      </div>
    </header>
  );
}
