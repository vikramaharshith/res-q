"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { cn } from "@/lib/cn";
import {
  categoryLabel,
  formatTimestamp,
  priorityBadgeClass,
  priorityLabel,
  sampleLabel,
  statusBadgeClass,
  statusHex,
  statusLabel,
} from "@/lib/demo/labels";
import type {
  Incident,
  IncidentPriority,
  IncidentStatus,
  Report,
} from "@/lib/demo/types";
import { INCIDENT_PRIORITIES, INCIDENT_STATUSES } from "@/lib/demo/types";

const STATUS_ORDER: Record<IncidentStatus, number> = {
  NEEDS_REVIEW: 0,
  NEW: 1,
  ASSIGNED: 2,
  IN_PROGRESS: 3,
  RESOLVED: 4,
};

const PRIORITY_ORDER: Record<IncidentPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  UNASSESSED: 4,
};

export function IncidentQueue({
  incidents,
  reports,
  selectedId,
  onSelect,
}: {
  incidents: Incident[];
  reports: Report[];
  selectedId: string;
  onSelect: (incidentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | IncidentStatus>(
    "ALL",
  );
  const [priorityFilter, setPriorityFilter] = useState<
    "ALL" | IncidentPriority
  >("ALL");
  const [lowDetailOnly, setLowDetailOnly] = useState(false);

  const reportsByIncident = useMemo(() => {
    const grouped = new Map<string, Report[]>();
    for (const report of reports) {
      const list = grouped.get(report.incidentId);
      if (list) list.push(report);
      else grouped.set(report.incidentId, [report]);
    }
    return grouped;
  }, [reports]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...incidents]
      .filter((incident) => {
        if (statusFilter !== "ALL" && incident.status !== statusFilter) {
          return false;
        }
        if (
          priorityFilter !== "ALL" &&
          incident.priority !== priorityFilter
        ) {
          return false;
        }
        if (lowDetailOnly && !incident.lowDetail) return false;
        if (!needle) return true;
        const linked = reportsByIncident.get(incident.id) ?? [];
        const haystack = [
          incident.id,
          incident.summary,
          incident.district,
          incident.category,
          incident.status,
          incident.priority,
          incident.sampleKey ?? "",
          ...linked.map((report) => `${report.id} ${report.rawText}`),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      })
      .sort((left, right) => {
        const statusDelta = STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
        if (statusDelta !== 0) return statusDelta;
        const priorityDelta =
          PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
        if (priorityDelta !== 0) return priorityDelta;
        return left.id.localeCompare(right.id);
      });
  }, [
    incidents,
    lowDetailOnly,
    priorityFilter,
    query,
    reportsByIncident,
    statusFilter,
  ]);

  const filtersActive =
    query.trim().length > 0 ||
    statusFilter !== "ALL" ||
    priorityFilter !== "ALL" ||
    lowDetailOnly;
  const selectedHidden = !visible.some((incident) => incident.id === selectedId);

  return (
    <section className="resq-scroll h-full min-h-0 w-full overflow-y-auto bg-[#0b1522]">
      <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0b1522]/95 backdrop-blur-sm">
      <SectionHeader
        title="Incident queue"
        subtitle="Priorities are scenario labels, not AI triage. Search includes original report text."
      />
      <div className="space-y-2 px-4 py-3">
        <label className="block">
          <span className="sr-only">Search incidents and original reports</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search reports, districts, IDs"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/50"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[11px] text-slate-400">
            Status
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as "ALL" | IncidentStatus)
              }
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-slate-100"
            >
              <option value="ALL">All statuses</option>
              {INCIDENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] text-slate-400">
            Priority
            <select
              value={priorityFilter}
              onChange={(event) =>
                setPriorityFilter(
                  event.target.value as "ALL" | IncidentPriority,
                )
              }
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-slate-100"
            >
              <option value="ALL">All priorities</option>
              {INCIDENT_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priorityLabel(priority)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={lowDetailOnly}
              onChange={(event) => setLowDetailOnly(event.target.checked)}
              className="accent-cyan-300"
            />
            Low-detail only
          </label>
          {filtersActive ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setStatusFilter("ALL");
                setPriorityFilter("ALL");
                setLowDetailOnly(false);
              }}
              className="text-xs font-medium text-cyan-200 hover:text-cyan-100"
            >
              Clear filters
            </button>
          ) : null}
        </div>
        <p className="text-[11px] text-slate-500">
          {visible.length} of {incidents.length} incidents
          {selectedHidden ? " · selected case is hidden by filters" : ""}
        </p>
      </div>
      </div>
      <ul>
        {visible.length === 0 ? (
          <li className="px-4 py-8 text-sm text-slate-400">
            No incidents match these filters. Original reports are still in the
            scenario.
          </li>
        ) : (
          visible.map((incident) => {
            const linked = reportsByIncident.get(incident.id) ?? [];
            const latest = linked[linked.length - 1];
            const selected = incident.id === selectedId;
            return (
              <li key={incident.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(incident.id)}
                  className={cn(
                    "flex w-full flex-col gap-2 border-b border-white/5 border-l-2 px-4 py-3 text-left",
                    selected
                      ? "border-l-cyan-300 bg-cyan-400/10"
                      : "border-l-transparent hover:bg-white/[0.03]",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: statusHex(incident.status) }}
                        aria-hidden
                      />
                      <span className="font-mono text-[11px] text-cyan-100">
                        {incident.id}
                      </span>
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">
                      {latest ? formatTimestamp(latest.receivedAt) : ""}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-sm leading-5 text-slate-100">
                    {incident.summary}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Badge className={statusBadgeClass(incident.status)}>
                      {statusLabel(incident.status)}
                    </Badge>
                    <Badge className={priorityBadgeClass(incident.priority)}>
                      {priorityLabel(incident.priority)}
                    </Badge>
                    {incident.lowDetail ? (
                      <Badge className="bg-slate-400/10 text-slate-300 ring-slate-400/40">
                        Low detail
                      </Badge>
                    ) : null}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {incident.district} · {categoryLabel(incident.category)} ·{" "}
                    {linked.length} {linked.length === 1 ? "report" : "reports"}
                    {incident.sampleKey
                      ? ` · ${sampleLabel(incident.sampleKey)}`
                      : ""}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
