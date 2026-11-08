"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";

import type { DecisionSubmission } from "@/components/agent/ApprovalControls";
import { InvestigationPanel } from "@/components/agent/InvestigationPanel";
import { CommandHeader } from "@/components/dashboard/CommandHeader";
import { MetricsStrip } from "@/components/dashboard/MetricsStrip";
import { StartupIntro } from "@/components/intro/StartupIntro";
import { IncidentDetail } from "@/components/incidents/IncidentDetail";
import { IncidentQueue } from "@/components/incidents/IncidentQueue";
import { ResponderPanel } from "@/components/responders/ResponderPanel";
import {
  isAgentRunDto,
  type AgentRunDto,
  type InvestigationSession,
} from "@/lib/ai/types";
import {
  assignmentForIncident,
  getScenarioMetrics,
  reportsForIncident,
  responderById,
} from "@/lib/demo/metrics";
import { parseApprovalPayload, parseCommandSnapshot, parseHistory } from "@/lib/approval/client-parse";
import { applyCommandSnapshot } from "@/lib/approval/snapshot";
import type { ApprovalAction, ApprovalHistory } from "@/lib/approval/types";
import type { Scenario } from "@/lib/demo/types";

const IncidentMap = dynamic(() => import("@/components/map/IncidentMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[22rem] items-center justify-center bg-[#050505] text-sm text-zinc-500">
      Loading OpenStreetMap…
    </div>
  ),
});

function confirmedDecisionMessage(
  action: ApprovalAction,
  serverMessage: string,
  refreshNote: string,
): string {
  const lead =
    action === "approve"
      ? "Approval saved."
      : action === "reject"
        ? "Rejection saved."
        : "Override saved.";
  const conflict = /different human decision|already has a human decision|duplicate/i.test(
    serverMessage,
  );
  const detail = conflict
    ? "Supabase confirmed this decision. No second approval was sent."
    : serverMessage;
  return `${lead} ${detail}${refreshNote}`.replace(/\s+/g, " ").trim();
}

function initialIncidentId(scenario: Scenario): string {
  const sample = scenario.incidents.find(
    (incident) => incident.sampleKey === "riverside-court",
  );
  return sample?.id ?? scenario.incidents[0]?.id ?? "";
}

function browserFailure(
  scenarioId: string,
  incidentId: string,
  message: string,
): AgentRunDto {
  const now = new Date().toISOString();
  return {
    run_id: `local_${crypto.randomUUID()}`,
    status: "FAILED",
    model_id: null,
    incident_id: incidentId,
    scenario_id: scenarioId,
    simulation: true,
    advisory: true,
    assignment_created: false,
    multi_step: false,
    distinct_tool_count: 0,
    tool_call_count: 0,
    tool_events: [],
    recommendation: null,
    validation_retried: false,
    recorded_by: "browser",
    started_at: now,
    finished_at: now,
    error: {
      code: "REQUEST_FAILED",
      message,
      retryable: true,
    },
  };
}

export function CommandCenter({
  scenario: initialScenario,
  history: initialHistory,
  approvalsOptIn,
}: {
  scenario: Scenario;
  history: ApprovalHistory;
  approvalsOptIn: boolean;
}) {
  const [scenario, setScenario] = useState(initialScenario);
  const [history, setHistory] = useState(initialHistory);
  const [selectedId, setSelectedId] = useState(() => initialIncidentId(initialScenario));
  const [runs, setRuns] = useState<Record<string, InvestigationSession>>({});
  const [runningId, setRunningId] = useState<string | null>(null);
  const [decisionPending, setDecisionPending] = useState(false);
  const [decisionNotice, setDecisionNotice] = useState<{
    tone: "ok" | "err";
    message: string;
  } | null>(null);
  const [replayToken, setReplayToken] = useState(0);
  const investigationLock = useRef(false);
  const decisionLock = useRef(false);
  const landOnMap = useCallback(() => {
    delete document.documentElement.dataset.resqLand;
  }, []);

  const metrics = getScenarioMetrics(scenario);
  const selected =
    scenario.incidents.find((incident) => incident.id === selectedId) ??
    scenario.incidents[0];

  if (!selected) {
    return (
      <div className="flex min-h-dvh flex-col bg-[#050505] text-white">
        <p className="p-6 text-sm">The synthetic scenario did not load.</p>
      </div>
    );
  }

  const reports = reportsForIncident(scenario, selected.id);
  const assignment = assignmentForIncident(scenario, selected.id);
  const assignedResponder = assignment
    ? responderById(scenario, assignment.responderId)
    : undefined;

  const selectIncident = (incidentId: string) => {
    setSelectedId(incidentId);
  };

  const openCase = (incidentId: string) => {
    setSelectedId(incidentId);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.requestAnimationFrame(() => {
      document.getElementById("case-file")?.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "start",
      });
    });
  };

  const investigate = async (incidentId: string) => {
    if (investigationLock.current) return;
    investigationLock.current = true;
    setRunningId(incidentId);
    setRuns((current) => ({
      ...current,
      [incidentId]: { phase: "running" },
    }));
    try {
      const response = await fetch("/api/agent-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_id: incidentId,
          mode: "investigate",
        }),
        signal: AbortSignal.timeout(185_000),
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      const run = isAgentRunDto(parsed)
        ? parsed
        : browserFailure(
            scenario.id,
            incidentId,
            "The investigation route did not return a usable result. Nothing was assigned.",
          );
      setRuns((current) => ({
        ...current,
        [incidentId]: { phase: "done", run },
      }));
      if (run.stored) {
        setHistory((current) => ({
          ...current,
          runs: [run, ...current.runs.filter((item) => item.run_id !== run.run_id)],
        }));
      }
    } catch (error) {
      const timedOut =
        error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      setRuns((current) => ({
        ...current,
        [incidentId]: {
          phase: "done",
          run: browserFailure(
            scenario.id,
            incidentId,
            timedOut
              ? "The investigation request timed out in the browser. Nothing was assigned."
              : "The browser could not finish the investigation request. Nothing was assigned.",
          ),
        },
      }));
    } finally {
      investigationLock.current = false;
      setRunningId(null);
    }
  };

  const refreshHistory = async (): Promise<boolean> => {
    try {
      const response = await fetch("/api/agent-runs", {
        signal: AbortSignal.timeout(12_000),
      });
      const parsed = parseHistory(await response.json());
      if (!parsed) return false;
      setHistory(parsed);
      return true;
    } catch {
      return false;
    }
  };

  const refreshBoard = async (): Promise<boolean> => {
    try {
      const response = await fetch("/api/command-state", {
        signal: AbortSignal.timeout(12_000),
      });
      const body = (await response.json()) as { ok?: unknown; snapshot?: unknown };
      if (body.ok !== true) return false;
      const snapshot = parseCommandSnapshot(body.snapshot);
      if (!snapshot) return false;
      let appliedOk = false;
      setScenario((current) => {
        const applied = applyCommandSnapshot(current, snapshot);
        appliedOk = applied.ok;
        return applied.ok ? applied.scenario : current;
      });
      return appliedOk;
    } catch {
      return false;
    }
  };

  const decide = async (input: DecisionSubmission): Promise<boolean> => {
    if (decisionLock.current) return false;
    decisionLock.current = true;
    setDecisionPending(true);
    setDecisionNotice(null);
    try {
      const response = await fetch("/api/approvals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-resq-local-demo": "1",
        },
        body: JSON.stringify({
          incident_id: input.incidentId,
          agent_run_id: input.agentRunId,
          action: input.action,
          confirmed: true,
          reason: input.reason,
          idempotency_key: input.idempotencyKey,
          selected_priority: input.selectedPriority,
          selected_responder_id: input.selectedResponderId,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = parseApprovalPayload(await response.json());
      if (!payload.ok) {
        setDecisionNotice({ tone: "err", message: payload.message });
        await refreshHistory();
        return false;
      }
      if (payload.snapshot) {
        const applied = applyCommandSnapshot(scenario, payload.snapshot);
        if (applied.ok) setScenario(applied.scenario);
      }
      const historyOk = await refreshHistory();
      const boardOk = await refreshBoard();
      const refreshNote =
        historyOk && boardOk
          ? ""
          : " The decision is saved. The dashboard refresh did not finish, so use the audit card as the confirmation.";
      setDecisionNotice({
        tone: "ok",
        message: confirmedDecisionMessage(input.action, payload.message, refreshNote),
      });
      return true;
    } catch (error) {
      const timedOut =
        error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      await refreshHistory();
      setDecisionNotice({
        tone: "err",
        message: timedOut
          ? "The decision request timed out. No success was confirmed. Check the audit history before trying again."
          : "The browser could not finish the decision request. Nothing was confirmed.",
      });
      return false;
    } finally {
      decisionLock.current = false;
      setDecisionPending(false);
    }
  };

  const selectedSession = runs[selected.id];
  const sessionDraft =
    selectedSession?.phase === "done" &&
    selectedSession.run.status === "COMPLETED";

  return (
    <div className="min-h-dvh bg-[#050505] text-white">
      <div data-command-shell="" className="min-h-dvh">
        <CommandHeader
          scenario={scenario}
          onReplayIntro={() => setReplayToken((value) => value + 1)}
        />
        <main className="mx-auto flex w-full max-w-[90rem] flex-col gap-8 px-4 py-6 pb-[max(3rem,env(safe-area-inset-bottom))] sm:px-6 lg:gap-10 lg:px-8 lg:py-8">
          <MetricsStrip metrics={metrics} />
          <div className="flex flex-col gap-4">
            <div className="startup-chrome-top flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-white">
                  Operations map
                </h2>
                <p className="mt-1.5 text-sm text-zinc-400">
                  Simulated pins on OpenStreetMap. Select an incident to inspect it.
                </p>
              </div>
            </div>
            <section
              id="operations-map"
              aria-label="Operations map"
              className="startup-map-slot isolate flex h-[min(78svh,54rem)] min-h-[22rem] w-full scroll-mt-32 flex-col overflow-hidden rounded-[1.35rem] border border-cyan-300/15 bg-[#080808] shadow-[inset_0_0_0_1px_rgba(52,211,153,0.08),0_28px_80px_rgba(0,0,0,0.45)]"
            >
              <div className="h-full min-h-0 flex-1">
                <IncidentMap
                  incidents={scenario.incidents}
                  responders={scenario.responders}
                  assignments={scenario.assignments}
                  selectedId={selected.id}
                  mapCenter={scenario.mapCenter}
                  onSelect={selectIncident}
                  onOpenCase={openCase}
                />
              </div>
            </section>
          </div>
          <div className="startup-queue-slot startup-chrome-left">
            <IncidentQueue
              incidents={scenario.incidents}
              reports={scenario.reports}
              selectedId={selected.id}
              onSelect={selectIncident}
              onOpenCase={openCase}
            />
          </div>
          <section
            id="case-file"
            aria-label="Case file and investigation"
            className="startup-case-slot startup-chrome-right scroll-mt-32"
          >
            <div className="resq-enter mb-5 flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-white">
                  Case file
                </h2>
                <p className="mt-2 truncate font-mono text-sm text-cyan-100">
                  {selected.id}
                </p>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
                  {selected.district}. Original reports stay on the case. Nemotron
                  can draft advice. A person still has to approve any assignment.
                </p>
              </div>
            </div>
            <div className="resq-enter resq-enter-late grid items-start gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
              <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0c0c0c]">
                <IncidentDetail
                  incident={selected}
                  reports={reports}
                  sessionDraft={sessionDraft}
                />
              </div>
              <div className="min-w-0 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0c0c0c]">
                <InvestigationPanel
                  incident={selected}
                  responders={scenario.responders}
                  assignments={scenario.assignments}
                  session={selectedSession}
                  storedRuns={history.runs.filter((run) => run.incident_id === selected.id)}
                  decisions={history.decisions}
                  storageReady={history.storage === "ready"}
                  storageMessage={history.storageMessage}
                  approvalsOptIn={approvalsOptIn}
                  pending={runningId === selected.id}
                  blocked={runningId !== null && runningId !== selected.id}
                  decisionPending={decisionPending}
                  decisionNotice={decisionNotice}
                  onInvestigate={() => {
                    void investigate(selected.id);
                  }}
                  onDecide={decide}
                />
              </div>
            </div>
            <div className="resq-enter mt-4 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0c0c0c]">
              <ResponderPanel
                responders={scenario.responders}
                assignment={assignment}
                assignedResponder={assignedResponder}
              />
            </div>
          </section>
        </main>
      </div>
      <StartupIntro replayToken={replayToken} onLand={landOnMap} />
    </div>
  );
}
