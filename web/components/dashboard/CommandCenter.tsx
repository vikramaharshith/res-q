"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";

import { InvestigationPanel } from "@/components/agent/InvestigationPanel";
import {
  agentHeaderState,
  CommandHeader,
} from "@/components/dashboard/CommandHeader";
import { MetricsStrip } from "@/components/dashboard/MetricsStrip";
import { SimulationBanner } from "@/components/dashboard/SimulationBanner";
import { IncidentDetail } from "@/components/incidents/IncidentDetail";
import { IncidentQueue } from "@/components/incidents/IncidentQueue";
import { ResponderPanel } from "@/components/responders/ResponderPanel";
import {
  isAgentRunDto,
  type AgentRunDto,
  type InvestigationSession,
} from "@/lib/ai/types";
import { cn } from "@/lib/cn";
import {
  assignmentForIncident,
  getScenarioMetrics,
  reportsForIncident,
  responderById,
} from "@/lib/demo/metrics";
import { DEMO_SCENARIO } from "@/lib/demo/scenario";

const IncidentMap = dynamic(() => import("@/components/map/IncidentMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[20rem] items-center justify-center bg-[#0b1522] text-sm text-slate-400">
      Loading OpenStreetMap…
    </div>
  ),
});

const TABS = [
  { id: "queue", label: "Incidents" },
  { id: "map", label: "Map" },
  { id: "case", label: "Case" },
] as const;

type MobileTab = (typeof TABS)[number]["id"];

function initialIncidentId(): string {
  const sample = DEMO_SCENARIO.incidents.find(
    (incident) => incident.sampleKey === "riverside-court",
  );
  return sample?.id ?? DEMO_SCENARIO.incidents[0]?.id ?? "";
}

function browserFailure(incidentId: string, message: string): AgentRunDto {
  const now = new Date().toISOString();
  return {
    run_id: `local_${crypto.randomUUID()}`,
    status: "FAILED",
    model_id: null,
    incident_id: incidentId,
    scenario_id: DEMO_SCENARIO.id,
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

export function CommandCenter() {
  const [selectedId, setSelectedId] = useState(initialIncidentId);
  const [tab, setTab] = useState<MobileTab>("queue");
  const [runs, setRuns] = useState<Record<string, InvestigationSession>>({});
  const [runningId, setRunningId] = useState<string | null>(null);
  const investigationLock = useRef(false);
  const scenario = DEMO_SCENARIO;
  const metrics = getScenarioMetrics(scenario);
  const selected =
    scenario.incidents.find((incident) => incident.id === selectedId) ??
    scenario.incidents[0];

  if (!selected) {
    return (
      <div className="flex h-dvh flex-col bg-[#071018] text-slate-100">
        <SimulationBanner />
        <p className="p-6 text-sm">The synthetic scenario did not load.</p>
      </div>
    );
  }

  const reports = reportsForIncident(scenario, selected.id);
  const assignment = assignmentForIncident(scenario, selected.id);
  const assignedResponder = assignment
    ? responderById(scenario, assignment.responderId)
    : undefined;

  const selectIncident = (incidentId: string, nextTab?: MobileTab) => {
    setSelectedId(incidentId);
    if (nextTab) setTab(nextTab);
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
            incidentId,
            "The investigation route did not return a usable result. Nothing was assigned.",
          );
      setRuns((current) => ({
        ...current,
        [incidentId]: { phase: "done", run },
      }));
    } catch (error) {
      const timedOut =
        error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError");
      setRuns((current) => ({
        ...current,
        [incidentId]: {
          phase: "done",
          run: browserFailure(
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

  const selectedSession = runs[selected.id];
  const sessionDraft =
    selectedSession?.phase === "done" &&
    selectedSession.run.status === "COMPLETED";

  const caseFile = (
    <div className="resq-scroll h-full min-h-0 w-full overflow-y-auto bg-[#0c1726]">
      <IncidentDetail
        incident={selected}
        reports={reports}
        sessionDraft={sessionDraft}
      />
      <InvestigationPanel
        incidentId={selected.id}
        session={selectedSession}
        pending={runningId === selected.id}
        blocked={runningId !== null && runningId !== selected.id}
        onInvestigate={() => {
          void investigate(selected.id);
        }}
      />
      <ResponderPanel
        responders={scenario.responders}
        assignment={assignment}
        assignedResponder={assignedResponder}
      />
    </div>
  );

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#071018] text-slate-100">
      <SimulationBanner />
      <CommandHeader
        scenario={scenario}
        agentState={agentHeaderState(runs, runningId)}
      />
      <MetricsStrip metrics={metrics} />
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden lg:grid-cols-[minmax(17.5rem,28%)_minmax(0,1fr)_minmax(20rem,27%)]">
        <div
          className={cn(
            "h-full min-h-0 min-w-0 overflow-hidden lg:border-r lg:border-white/10",
            tab === "queue" ? "flex" : "hidden",
            "lg:flex",
          )}
        >
          <IncidentQueue
            incidents={scenario.incidents}
            reports={scenario.reports}
            selectedId={selected.id}
            onSelect={(incidentId) => {
              const mobile = window.matchMedia("(max-width: 1023px)").matches;
              selectIncident(incidentId, mobile ? "case" : undefined);
            }}
          />
        </div>
        <div
          className={cn(
            "h-full min-h-0 min-w-0 flex-col overflow-hidden",
            tab === "map" ? "flex" : "hidden",
            "lg:flex",
          )}
        >
          <div className="h-full min-h-0 w-full flex-1">
            <IncidentMap
              incidents={scenario.incidents}
              responders={scenario.responders}
              assignments={scenario.assignments}
              selectedId={selected.id}
              mapCenter={scenario.mapCenter}
              onSelect={(incidentId) => selectIncident(incidentId)}
              onOpenCase={(incidentId) => selectIncident(incidentId, "case")}
            />
          </div>
        </div>
        <div
          className={cn(
            "h-full min-h-0 min-w-0 overflow-hidden lg:border-l lg:border-white/10",
            tab === "case" ? "flex" : "hidden",
            "lg:flex",
          )}
        >
          {caseFile}
        </div>
      </div>
      <nav
        aria-label="Command center sections"
        className="grid shrink-0 grid-cols-3 border-t border-white/10 bg-[#08131f] lg:hidden"
      >
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(item.id)}
              className={cn(
                "px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em]",
                active
                  ? "bg-cyan-300/10 text-cyan-100"
                  : "text-slate-400",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
