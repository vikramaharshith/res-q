import { ApprovalControls, type DecisionSubmission } from "@/components/agent/ApprovalControls";
import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { cn } from "@/lib/cn";
import {
  availabilityBadgeClass,
  availabilityLabel,
  priorityBadgeClass,
  priorityLabel,
} from "@/lib/demo/labels";
import type { Assignment, Incident, Responder } from "@/lib/demo/types";
import type { AgentRunDto, InvestigationSession, ToolEventDto } from "@/lib/ai/types";
import type { ApprovalDecisionDto } from "@/lib/approval/types";

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return "";
  }
}

function evidenceLabel(token: string): string {
  if (token.startsWith("report:")) return `Original report ${token.slice("report:".length)}`;
  if (token.startsWith("tool:")) return `Tool result ${token.slice("tool:".length)}`;
  if (token.startsWith("incident:")) {
    return `Incident ${token.slice("incident:".length)}`;
  }
  if (token.startsWith("responder:")) {
    return `Simulated responder ${token.slice("responder:".length)}`;
  }
  return token;
}

function InvestigationTrace({ events }: { events: ToolEventDto[] }) {
  return (
    <details className="rounded-xl border border-white/[0.08] bg-[#080808]">
      <summary className="cursor-pointer list-none px-4 py-3.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-300 transition-colors duration-200 hover:text-white [&::-webkit-details-marker]:hidden">
        Investigation Trace
      </summary>
      <div className="border-t border-white/10 px-3 py-3">
        {events.length === 0 ? (
          <p className="text-sm leading-6 text-slate-400">
            No tool events. This list stays empty until the server executes a tool.
          </p>
        ) : (
          <ol className="space-y-3">
            {events.map((event) => (
              <li
                key={`${event.sequence_no}-${event.tool_name}`}
                className="min-w-0 rounded-lg border border-white/[0.06] bg-[#050505] px-3 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-slate-500">
                    {event.sequence_no}
                  </span>
                  <span className="min-w-0 break-all font-mono text-sm text-cyan-50">
                    {event.tool_name}
                  </span>
                  <Badge
                    className={
                      event.status === "completed"
                        ? "bg-emerald-400/15 text-emerald-100 ring-emerald-300/40"
                        : "bg-rose-400/15 text-rose-100 ring-rose-300/40"
                    }
                  >
                    {event.status === "completed" ? "Completed" : "Rejected"}
                  </Badge>
                  <span className="font-mono text-[11px] text-slate-500">
                    {event.duration_ms < 1 ? "<1 ms" : `${event.duration_ms} ms`}
                  </span>
                </div>
                <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                  Arguments the server applied
                </p>
                <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-slate-300">
                  {formatJson(event.sanitized_arguments)}
                </pre>
                <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-slate-500">
                  {event.status === "completed" ? "Result" : "Rejection"}
                </p>
                <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-slate-300">
                  {formatJson(event.sanitized_result)}
                </pre>
              </li>
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}

function FailureCard({ run }: { run: AgentRunDto }) {
  const error = run.error;
  return (
    <div className="space-y-3">
      <div
        role="alert"
        className="rounded-xl border border-rose-300/30 bg-rose-400/10 px-3 py-3"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-rose-100">
          {run.recorded_by === "browser"
            ? "Request did not finish"
            : "Investigation failed"}
        </p>
        <p className="mt-2 text-sm leading-6 text-rose-50">
          {error?.message ??
            "No recommendation was accepted. Nothing was assigned."}
        </p>
        {error ? (
          <p className="mt-2 font-mono text-[11px] text-rose-100/80">
            {error.code}
            {error.retryable ? " · retryable" : ""}
          </p>
        ) : null}
        {run.model_id ? (
          <p className="mt-2 font-mono text-[11px] text-rose-100/70">
            Model attempted: {run.model_id}
          </p>
        ) : null}
        {error?.details && error.details.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-rose-50/90">
            {error.details.map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {error?.unvalidated_excerpt ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-black/20 px-3 py-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            Unvalidated model text
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            The server rejected this text. It is not a recommendation.
          </p>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-slate-300">
            {error.unvalidated_excerpt}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function SuccessCard({ run }: { run: AgentRunDto }) {
  const recommendation = run.recommendation;
  if (!recommendation) {
    return <FailureCard run={run} />;
  }
  const responder = recommendation.recommended_responder;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-50">
          Nemotron draft · advisory
        </p>
        <p className="mt-2 text-sm leading-6 text-cyan-50">
          Advisory draft only. This card is the original Nemotron recommendation.
          It does not assign a responder, and a later human decision does not
          rewrite it.
        </p>
        <p className="mt-2 font-mono text-[11px] leading-5 text-cyan-100/80">
          {run.model_id ?? "model id unavailable"} · {run.run_id}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge className={priorityBadgeClass(recommendation.proposed_priority)}>
          {priorityLabel(recommendation.proposed_priority)}
        </Badge>
        <Badge className="bg-cyan-400/15 text-cyan-100 ring-cyan-300/50">
          Advisory
        </Badge>
        <Badge className="bg-amber-400/15 text-amber-100 ring-amber-300/50">
          Human approval required
        </Badge>
      </div>
      <p className="text-xs leading-5 text-slate-400">
        Proposed review priority from Nemotron. It is not medical triage and it
        does not replace the scenario baseline priority.
      </p>
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          Summary
        </h3>
        <p className="mt-1 text-sm leading-6 text-slate-100">
          {recommendation.summary}
        </p>
      </div>
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          Rationale
        </h3>
        <p className="mt-1 text-sm leading-6 text-slate-200">
          {recommendation.rationale}
        </p>
      </div>
      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          Suggested simulated unit
        </h3>
        {responder ? (
          <div className="mt-2">
            <p className="font-mono text-sm text-white">
              {responder.callsign} · {responder.id}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {responder.capabilities.join(" · ")}
            </p>
            <div className="mt-2">
              <Badge className={availabilityBadgeClass(responder.availability)}>
                {availabilityLabel(responder.availability)}
              </Badge>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm leading-6 text-slate-300">
            No simulated unit was suggested.
          </p>
        )}
        <p className="mt-2 text-xs leading-5 text-slate-400">
          A person would still have to approve an assignment. This run left
          every responder status unchanged.
        </p>
      </div>
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          Supporting evidence
        </h3>
        <ul className="mt-2 space-y-1">
          {recommendation.evidence.map((token) => (
            <li key={token} className="font-mono text-xs text-slate-200">
              {evidenceLabel(token)}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          Missing information
        </h3>
        {recommendation.missing_information.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-6 text-slate-200">
            {recommendation.missing_information.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm leading-6 text-slate-400">
            The model did not list a missing fact.
          </p>
        )}
      </div>
      <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-100">
          Uncertainty
        </h3>
        <p className="mt-2 text-sm leading-6 text-amber-50">
          {recommendation.uncertainty}
        </p>
      </div>
      <p className="text-xs leading-5 text-slate-400">
        {run.multi_step
          ? `This run executed ${run.tool_call_count} tool calls across ${run.distinct_tool_count} tools. The draft was validated after those results went back to Nemotron.`
          : `This run is a real Nemotron result, and ${run.distinct_tool_count} distinct tool${run.distinct_tool_count === 1 ? "" : "s"} completed. Fewer than two different tools means it does not meet the multi-step demonstration bar.`}
        {run.validation_retried
          ? " The server rejected one reply and accepted the corrected JSON."
          : ""}
      </p>
    </div>
  );
}

export function InvestigationPanel({
  incident,
  responders,
  assignments,
  session,
  storedRuns,
  decisions,
  storageReady,
  storageMessage,
  approvalsOptIn,
  pending,
  blocked,
  decisionPending,
  decisionNotice,
  onInvestigate,
  onDecide,
}: {
  incident: Incident;
  responders: Responder[];
  assignments: Assignment[];
  session?: InvestigationSession;
  storedRuns: AgentRunDto[];
  decisions: ApprovalDecisionDto[];
  storageReady: boolean;
  storageMessage: string | null;
  approvalsOptIn: boolean;
  pending: boolean;
  blocked: boolean;
  decisionPending: boolean;
  decisionNotice: { tone: "ok" | "err"; message: string } | null;
  onInvestigate: () => void;
  onDecide: (input: DecisionSubmission) => Promise<boolean>;
}) {
  const incidentId = incident.id;
  const sessionRun = session?.phase === "done" ? session.run : undefined;
  const reviewRun =
    sessionRun ??
    storedRuns.find((run) => run.status === "COMPLETED") ??
    storedRuns[0];
  const reviewSource = sessionRun ? "session" : reviewRun ? "stored" : null;
  const subtitle = pending
    ? "Nemotron is running on the server. This view does not simulate tool calls."
    : session?.phase === "done" && session.run.status === "COMPLETED"
      ? "Live NVIDIA result for this session. Separate from the scenario baseline above."
      : session?.phase === "done"
        ? "This run did not produce an accepted recommendation. Scenario data is unchanged."
        : "No Nemotron run yet. Scenario labels above are not model output.";

  return (
    <section>
      <SectionHeader level={3} title="AI investigation" subtitle={subtitle} />
      <div className="space-y-4 px-5 py-5 sm:px-6 sm:py-6">
        <p className="text-xs font-semibold tracking-[0.08em] text-amber-200">
          SIMULATION — not for real emergencies. An investigation can only draft advice.
        </p>
        {reviewRun ? (
          <p className="text-sm leading-6 text-slate-300">
            {reviewSource === "stored"
              ? "Showing a stored investigation. Opening the page does not run Nemotron again."
              : "Showing the investigation from this browser session."}
          </p>
        ) : (
          <p className="text-sm leading-6 text-slate-300">
            No accepted investigation is stored for{" "}
            <span className="font-mono text-cyan-100">{incidentId}</span>. The
            model runs on the server, and tool events appear only after that
            run finishes.
          </p>
        )}
        <button
          type="button"
          onClick={onInvestigate}
          disabled={pending || blocked}
          aria-busy={pending}
          className={cn(
            "rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors duration-200",
            pending || blocked
              ? "cursor-not-allowed border-white/10 bg-white/[0.04] text-zinc-500"
              : "border-cyan-300/40 bg-cyan-300/10 text-cyan-50 hover:bg-cyan-300/20",
          )}
        >
          {pending ? "Investigating…" : "Investigate with Nemotron"}
        </button>
        <p className="text-xs leading-5 text-slate-500">
          {blocked
            ? "Another incident is being investigated. Wait for that run to finish."
            : "This sends one incident to the server. It does not approve or assign a responder."}
        </p>
        <div aria-live="polite">
          {pending ? (
            <p className="text-sm leading-6 text-slate-300">
              Waiting for the server. A multi-step run can take a minute. No
              assignment will be made while you wait.
            </p>
          ) : null}
          {reviewRun?.status === "COMPLETED" ? <SuccessCard run={reviewRun} /> : null}
          {reviewRun?.status === "FAILED" ? <FailureCard run={reviewRun} /> : null}
          {storedRuns.length > 1 ? (
            <p className="text-xs leading-5 text-slate-500">
              {storedRuns.length} stored investigations exist for this incident.
              The newest accepted draft is the one open for review.
            </p>
          ) : null}
          <ApprovalControls
            incident={incident}
            responders={responders}
            assignments={assignments}
            run={reviewRun?.status === "COMPLETED" ? reviewRun : null}
            decisions={decisions}
            storageReady={storageReady}
            storageMessage={storageMessage}
            approvalsOptIn={approvalsOptIn}
            pending={decisionPending}
            notice={decisionNotice}
            onSubmit={onDecide}
          />
          {reviewRun ? <InvestigationTrace events={reviewRun.tool_events} /> : null}
        </div>
      </div>
    </section>
  );
}
