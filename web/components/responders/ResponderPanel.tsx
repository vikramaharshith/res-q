import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { cn } from "@/lib/cn";
import {
  assignmentOriginLabel,
  assignmentStatusLabel,
  availabilityBadgeClass,
  availabilityLabel,
} from "@/lib/demo/labels";
import type { Assignment, Responder } from "@/lib/demo/types";

export function ResponderPanel({
  responders,
  assignment,
  assignedResponder,
}: {
  responders: Responder[];
  assignment?: Assignment;
  assignedResponder?: Responder;
}) {
  const ordered = [...responders].sort((left, right) => {
    if (left.id === assignedResponder?.id) return -1;
    if (right.id === assignedResponder?.id) return 1;
    return left.callsign.localeCompare(right.callsign);
  });

  return (
    <section>
      <SectionHeader
        level={3}
        title="Simulated responders"
        subtitle="Seeded test units. Not verified emergency resources."
      />
      <div className="space-y-4 px-5 py-5 sm:px-6 sm:py-6">
        {assignment && assignedResponder ? (
          <div className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-100">
              {assignmentOriginLabel(assignment.origin)}
            </p>
            <p className="mt-1 text-sm text-amber-50">
              {assignedResponder.callsign} · {assignmentStatusLabel(assignment.status)}
            </p>
            <p className="mt-1 font-mono text-[11px] text-amber-100/70">
              {assignment.id}
            </p>
            <p className="mt-2 text-xs leading-5 text-amber-100/85">
              {assignment.note}
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            No simulated assignment is linked to this incident.
          </p>
        )}
        <ul className="divide-y divide-white/5">
          {ordered.map((responder) => {
            const linked = responder.id === assignedResponder?.id;
            return (
              <li
                key={responder.id}
                className={cn(
                  "flex items-start justify-between gap-3 py-3",
                  linked && "rounded-lg bg-amber-300/5 px-2",
                )}
              >
                <div>
                  <p className="font-mono text-sm text-white">
                    {responder.callsign}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {responder.capabilities.join(" · ")}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                    {responder.id}
                  </p>
                </div>
                <Badge className={availabilityBadgeClass(responder.availability)}>
                  {availabilityLabel(responder.availability)}
                </Badge>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
