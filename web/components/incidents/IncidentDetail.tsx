import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/ui/SectionHeader";
import {
  ANALYSIS_LABEL,
  categoryLabel,
  formatCoordinates,
  formatTimestamp,
  priorityBadgeClass,
  priorityLabel,
  sampleLabel,
  statusBadgeClass,
  statusLabel,
} from "@/lib/demo/labels";
import type { Incident, Report } from "@/lib/demo/types";

export function IncidentDetail({
  incident,
  reports,
  sessionDraft = false,
}: {
  incident: Incident;
  reports: Report[];
  sessionDraft?: boolean;
}) {
  return (
    <section>
      <SectionHeader
        title="Selected incident"
        subtitle="Original reports stay attached to the case. Nothing here came from Nemotron."
      />
      <div className="space-y-4 px-4 py-4">
        <div>
          <p className="font-mono text-[11px] text-cyan-100">{incident.id}</p>
          <h3 className="mt-1 text-base leading-6 text-white">
            {incident.summary}
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            {incident.district} · {categoryLabel(incident.category)} ·{" "}
            {formatCoordinates(incident.lat, incident.lon)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge className={statusBadgeClass(incident.status)}>
            {statusLabel(incident.status)}
          </Badge>
          <Badge className={priorityBadgeClass(incident.priority)}>
            {priorityLabel(incident.priority)}
          </Badge>
          <Badge className="bg-slate-400/10 text-slate-300 ring-slate-400/40">
            {ANALYSIS_LABEL}
          </Badge>
          {incident.lowDetail ? (
            <Badge className="bg-slate-400/10 text-slate-300 ring-slate-400/40">
              Low detail
            </Badge>
          ) : null}
        </div>
        {incident.sampleKey ? (
          <p className="text-xs text-cyan-100/80">
            {sampleLabel(incident.sampleKey)}
          </p>
        ) : null}
        <p className="text-xs leading-5 text-slate-400">{incident.priorityBasis}</p>
        {sessionDraft ? (
          <p className="rounded-lg border border-cyan-300/20 bg-cyan-300/5 px-3 py-2 text-xs leading-5 text-cyan-50">
            A Nemotron draft from this browser session is in the investigation
            panel. The priority, status, and original reports in this section
            are still the deterministic scenario baseline.
          </p>
        ) : null}
        {incident.lowDetail ? (
          <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs leading-5 text-slate-300">
            The generator flagged this case because the original message is
            incomplete. That flag is not an AI judgment, and missing detail is
            not treated as an all-clear.
          </p>
        ) : null}
        {reports.length > 1 ? (
          <p className="text-xs leading-5 text-slate-400">
            These original reports were grouped by the deterministic generator.
            Grouping is not an AI decision, and none of the messages were
            discarded.
          </p>
        ) : null}
        <div className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
            Original reports
          </h3>
          {reports.map((report) => (
            <article
              key={report.id}
              className="rounded-xl border border-white/10 bg-black/25 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-cyan-100">
                  {report.id}
                </span>
                <Badge className="bg-slate-400/10 text-slate-300 ring-slate-400/40">
                  {ANALYSIS_LABEL}
                </Badge>
                <span className="text-[11px] text-slate-500">Seeded report</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-100">
                {report.rawText}
              </p>
              <p className="mt-2 font-mono text-[11px] text-slate-500">
                {formatTimestamp(report.receivedAt)} ·{" "}
                {formatCoordinates(report.reportedLat, report.reportedLon)}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
