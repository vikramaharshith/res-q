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
        level={3}
        title="Selected incident"
        subtitle="Original reports stay attached to the case. Nothing here came from Nemotron."
      />
      <div className="space-y-5 px-5 py-5 sm:px-6 sm:py-6">
        <div>
          <p className="font-mono text-xs text-cyan-100">{incident.id}</p>
          <p className="mt-2 text-xl font-medium leading-7 text-white">
            {incident.summary}
          </p>
          <p className="mt-2 text-sm text-zinc-400">
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
          <Badge className="bg-zinc-400/10 text-zinc-300 ring-zinc-400/40">
            {ANALYSIS_LABEL}
          </Badge>
          {incident.lowDetail ? (
            <Badge className="bg-zinc-400/10 text-zinc-300 ring-zinc-400/40">
              Low detail
            </Badge>
          ) : null}
        </div>
        {incident.sampleKey ? (
          <p className="text-sm text-cyan-100/80">
            {sampleLabel(incident.sampleKey)}
          </p>
        ) : null}
        <p className="text-sm leading-6 text-zinc-400">{incident.priorityBasis}</p>
        {sessionDraft ? (
          <p className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3 text-sm leading-6 text-cyan-50">
            A Nemotron draft from this browser session is in the investigation
            panel. The priority, status, and original reports in this section
            are still the deterministic scenario baseline.
          </p>
        ) : null}
        {incident.lowDetail ? (
          <p className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm leading-6 text-zinc-300">
            The generator flagged this case because the original message is
            incomplete. That flag is not an AI judgment, and missing detail is
            not treated as an all-clear.
          </p>
        ) : null}
        {reports.length > 1 ? (
          <p className="text-sm leading-6 text-zinc-400">
            These original reports were grouped by the deterministic generator.
            Grouping is not an AI decision, and none of the messages were
            discarded.
          </p>
        ) : null}
        <div className="space-y-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Original reports
          </h4>
          {reports.map((report) => (
            <article
              key={report.id}
              className="rounded-xl border border-white/[0.06] bg-[#080808] p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-cyan-100">
                  {report.id}
                </span>
                <Badge className="bg-zinc-400/10 text-zinc-300 ring-zinc-400/40">
                  {ANALYSIS_LABEL}
                </Badge>
                <span className="text-[11px] text-zinc-500">Seeded report</span>
              </div>
              <p className="mt-3 text-[15px] leading-7 text-zinc-100">
                {report.rawText}
              </p>
              <p className="mt-3 font-mono text-[11px] text-zinc-500">
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
