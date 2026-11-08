"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
  onOpenCase,
}: {
  incidents: Incident[];
  reports: Report[];
  selectedId: string;
  onSelect: (incidentId: string) => void;
  onOpenCase: (incidentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | IncidentStatus>(
    "ALL",
  );
  const [priorityFilter, setPriorityFilter] = useState<
    "ALL" | IncidentPriority
  >("ALL");
  const [lowDetailOnly, setLowDetailOnly] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

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

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const node = list.querySelector<HTMLElement>(
      `[data-incident-id="${CSS.escape(selectedId)}"]`,
    );
    if (!node) return;
    const listRect = list.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    if (nodeRect.top >= listRect.top && nodeRect.bottom <= listRect.bottom) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({
      top: nodeRect.top - listRect.top + list.scrollTop - 8,
      behavior: reduce ? "auto" : "smooth",
    });
  }, [selectedId, visible]);

  const filtersActive =
    query.trim().length > 0 ||
    statusFilter !== "ALL" ||
    priorityFilter !== "ALL" ||
    lowDetailOnly;
  const selectedHidden = !visible.some((incident) => incident.id === selectedId);

  return (
    <section
      id="incident-queue"
      aria-label="Incident queue"
      className="resq-enter scroll-mt-32 overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0c0c0c]"
    >
      <SectionHeader
        title="Incident queue"
        subtitle="Priorities are scenario labels, not AI triage. Search includes original report text."
        aside={
          <button
            type="button"
            onClick={() => onOpenCase(selectedId)}
            className="shrink-0 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-50 transition-colors duration-200 hover:bg-cyan-300/20"
          >
            Open investigation
          </button>
        }
      />
      <div className="space-y-3 border-b border-white/[0.06] px-5 py-4 sm:px-6">
        <label className="block">
          <span className="sr-only">Search incidents and original reports</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search reports, districts, IDs"
            className="w-full rounded-xl border border-white/[0.08] bg-[#050505] px-3.5 py-2.5 text-base text-white outline-none transition-colors duration-200 placeholder:text-zinc-500 focus:border-cyan-300/50 sm:text-sm"
          />
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">
            Status
            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as "ALL" | IncidentStatus)
              }
              className="mt-1.5 w-full rounded-xl border border-white/[0.08] bg-[#050505] px-3 py-2 text-sm font-normal normal-case tracking-normal text-zinc-100"
            >
              <option value="ALL">All statuses</option>
              {INCIDENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">
            Priority
            <select
              value={priorityFilter}
              onChange={(event) =>
                setPriorityFilter(
                  event.target.value as "ALL" | IncidentPriority,
                )
              }
              className="mt-1.5 w-full rounded-xl border border-white/[0.08] bg-[#050505] px-3 py-2 text-sm font-normal normal-case tracking-normal text-zinc-100"
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-300">
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
              className="text-xs font-medium text-cyan-200 transition-colors duration-200 hover:text-cyan-50"
            >
              Clear filters
            </button>
          ) : null}
        </div>
        <p className="text-xs text-zinc-500">
          {visible.length} of {incidents.length} incidents
          {selectedHidden ? " · selected case is hidden by filters" : ""}
        </p>
      </div>
      <ul
        ref={listRef}
        className="resq-scroll flex max-h-[min(42rem,72svh)] flex-col gap-2 overflow-y-auto px-3 py-3 sm:px-4"
      >
        {visible.length === 0 ? (
          <li className="px-2 py-10 text-sm leading-6 text-zinc-400">
            No incidents match these filters. Original reports are still in the
            scenario.
          </li>
        ) : (
          visible.map((incident) => {
            const linked = reportsByIncident.get(incident.id) ?? [];
            const latest = linked[linked.length - 1];
            const selected = incident.id === selectedId;
            return (
              <li
                key={incident.id}
                data-incident-id={incident.id}
                className="resq-queue-item"
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(incident.id)}
                  className={cn(
                    "flex w-full flex-col gap-3 rounded-xl border px-4 py-4 text-left transition-[background-color,border-color,box-shadow] duration-200",
                    selected
                      ? "border-cyan-300/45 bg-cyan-300/[0.08] shadow-[inset_3px_0_0_rgba(103,232,249,0.9)]"
                      : "border-white/[0.05] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]",
                  )}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: statusHex(incident.status) }}
                        aria-hidden
                      />
                      <span className="truncate font-mono text-xs text-cyan-100">
                        {incident.id}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-zinc-500">
                      {latest ? formatTimestamp(latest.receivedAt) : ""}
                    </span>
                  </span>
                  <span className="text-[15px] leading-6 text-zinc-50">
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
                      <Badge className="bg-zinc-400/10 text-zinc-300 ring-zinc-400/40">
                        Low detail
                      </Badge>
                    ) : null}
                  </span>
                  <span className="text-xs leading-5 text-zinc-500">
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
