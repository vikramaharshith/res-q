"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import type { AgentRunDto } from "@/lib/ai/types";
import {
  availabilityBadgeClass,
  availabilityLabel,
  priorityBadgeClass,
  priorityLabel,
} from "@/lib/demo/labels";
import { INCIDENT_PRIORITIES, type Assignment, type Incident, type IncidentPriority, type Responder } from "@/lib/demo/types";
import { previewApproval, type ResponderChoice } from "@/lib/approval/ui-state";
import type { ApprovalAction, ApprovalDecisionDto } from "@/lib/approval/types";

export interface DecisionSubmission {
  action: ApprovalAction;
  reason: string;
  idempotencyKey: string;
  selectedPriority: IncidentPriority | null;
  selectedResponderId: string | null;
  agentRunId: string;
  incidentId: string;
}

function buttonClass(
  enabled: boolean,
  tone: "neutral" | "approve" | "reject" | "override" = "neutral",
): string {
  const base =
    "rounded-lg border px-3 py-2 text-sm font-semibold transition-colors duration-200";
  if (!enabled) {
    return cn(
      base,
      "cursor-not-allowed border-white/10 bg-white/[0.03] text-zinc-500",
    );
  }
  if (tone === "approve") {
    return cn(
      base,
      "border-emerald-400/35 bg-emerald-400/10 text-emerald-50 hover:bg-emerald-400/20",
    );
  }
  if (tone === "reject") {
    return cn(
      base,
      "border-rose-400/35 bg-transparent text-rose-100 hover:bg-rose-400/10",
    );
  }
  if (tone === "override") {
    return cn(
      base,
      "border-amber-300/40 bg-transparent text-amber-50 hover:bg-amber-300/10",
    );
  }
  return cn(
    base,
    "border-cyan-300/40 bg-cyan-300/10 text-cyan-50 hover:bg-cyan-300/20",
  );
}

export function ApprovalControls({
  incident,
  responders,
  assignments,
  run,
  decisions,
  storageReady,
  storageMessage,
  approvalsOptIn,
  pending,
  notice,
  onSubmit,
}: {
  incident: Incident;
  responders: Responder[];
  assignments: Assignment[];
  run: AgentRunDto | null;
  decisions: ApprovalDecisionDto[];
  storageReady: boolean;
  storageMessage: string | null;
  approvalsOptIn: boolean;
  pending: boolean;
  notice: { tone: "ok" | "err"; message: string } | null;
  onSubmit: (input: DecisionSubmission) => Promise<boolean>;
}) {
  const preview = previewApproval({
    incident,
    responders,
    assignments,
    run,
    decisions,
    storageReady,
    approvalsOptIn,
  });
  const [mode, setMode] = useState<ApprovalAction | null>(null);
  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState<IncidentPriority | "">("");
  const [responderId, setResponderId] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [dialogScope, setDialogScope] = useState(`${incident.id}:${run?.run_id ?? ""}`);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const recommendation = run?.recommendation ?? null;
  const decision = preview.decision;
  const nextScope = `${incident.id}:${run?.run_id ?? ""}`;
  if (dialogScope !== nextScope) {
    setDialogScope(nextScope);
    setMode(null);
  }

  useEffect(() => {
    if (!mode) return;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) setMode(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, pending]);

  const open = (action: ApprovalAction) => {
    setReason("");
    setPriority(recommendation?.proposed_priority ?? "");
    setResponderId("");
    setIdempotencyKey(crypto.randomUUID());
    setMode(action);
  };

  const reasonMissing = (mode === "reject" || mode === "override") && reason.trim().length === 0;
  const overrideSame =
    mode === "override" &&
    (priority === "" || priority === recommendation?.proposed_priority) &&
    (responderId === "" || responderId === recommendation?.recommended_responder_id);
  const confirmDisabled = pending || reasonMissing || overrideSame || !run;

  const submit = () => {
    if (!run || !mode || confirmDisabled) return;
    const action = mode;
    void onSubmit({
      action,
      reason: reason.trim(),
      idempotencyKey,
      selectedPriority: action === "override" && priority ? priority : null,
      selectedResponderId: action === "override" && responderId ? responderId : null,
      agentRunId: run.run_id,
      incidentId: incident.id,
    }).then((saved) => {
      if (saved) setMode(null);
    });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          Human review
        </h3>
        <p className="mt-2 text-sm leading-6 text-slate-200">
          Nemotron cannot assign a unit. This local demonstration records a
          simulated decision only after you confirm it. There is no signed-in
          operator; the audit label is local demo, not a verified person.
        </p>
        {!approvalsOptIn ? (
          <p className="mt-2 text-sm leading-6 text-amber-100" role="status">
            Approval writes are off until the server has RESQ_LOCAL_APPROVALS=1.
            You can still investigate.
          </p>
        ) : null}
        {!storageReady && storageMessage ? (
          <p className="mt-2 text-sm leading-6 text-amber-100" role="status">
            {storageMessage}
          </p>
        ) : null}
      </div>

      {decision ? (
        <DecisionCard decision={decision} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass(preview.approve.enabled && !pending, "approve")}
            disabled={!preview.approve.enabled || pending}
            onClick={() => open("approve")}
          >
            Approve recommendation
          </button>
          <button
            type="button"
            className={buttonClass(preview.reject.enabled && !pending, "reject")}
            disabled={!preview.reject.enabled || pending}
            onClick={() => open("reject")}
          >
            Reject recommendation
          </button>
          <button
            type="button"
            className={buttonClass(preview.override.enabled && !pending, "override")}
            disabled={!preview.override.enabled || pending}
            onClick={() => open("override")}
          >
            Override recommendation
          </button>
        </div>
      )}
      {decision ? null : (
        <ul className="space-y-1 text-xs leading-5 text-slate-400">
          <li>{preview.approve.reason}</li>
          <li>{preview.reject.reason}</li>
        </ul>
      )}
      {notice ? (
        <p
          role={notice.tone === "err" ? "alert" : "status"}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm leading-6",
            notice.tone === "err"
              ? "border-rose-300/30 bg-rose-400/10 text-rose-50"
              : "border-emerald-300/30 bg-emerald-400/10 text-emerald-50",
          )}
        >
          {notice.message}
        </p>
      ) : null}
      <AuditList
        decisions={decisions.filter((item) => item.incidentId === incident.id)}
        responders={responders}
      />

      {mode && recommendation && typeof document !== "undefined"
        ? createPortal(
        <div className="fixed inset-0 z-[2400] flex items-end justify-center bg-black/75 px-4 py-6 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="pointer-events-auto relative z-[2401] max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#0c0c0c] p-5 shadow-[0_30px_80px_rgba(0,0,0,0.55)]"
          >
            <h3 id={titleId} className="text-base font-semibold text-white">
              {mode === "approve"
                ? "Confirm approval"
                : mode === "reject"
                  ? "Reject this draft"
                  : "Override this draft"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Simulated decision for {incident.id}. This does not contact a real
              dispatch service.
            </p>
            <div className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-300/5 px-3 py-3 text-sm leading-6 text-cyan-50">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em]">
                Nemotron recommendation
              </p>
              <p className="mt-1">
                Priority {priorityLabel(recommendation.proposed_priority)}
                {recommendation.recommended_responder
                  ? ` · ${recommendation.recommended_responder.callsign} (${recommendation.recommended_responder.id})`
                  : " · no unit"}
              </p>
            </div>
            {mode === "override" ? (
              <div className="mt-3 space-y-3">
                <label className="block text-sm text-slate-200">
                  Human priority
                  <select
                    className="mt-1 w-full rounded-lg border border-white/15 bg-[#050505] px-3 py-2 text-sm text-white"
                    value={priority}
                    onChange={(event) => setPriority(event.target.value as IncidentPriority | "")}
                  >
                    {INCIDENT_PRIORITIES.map((item) => (
                      <option key={item} value={item}>
                        {priorityLabel(item)}
                        {item === recommendation.proposed_priority ? " · Nemotron" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="block text-sm text-slate-200">
                  Human unit
                  <ResponderPicker
                    choices={preview.responders}
                    value={responderId}
                    onChange={setResponderId}
                  />
                </div>
                <p className="text-xs leading-5 text-slate-400">
                  A priority-only override does not create an assignment. A busy,
                  offline, or incompatible unit stays disabled.
                </p>
              </div>
            ) : null}
            {mode === "approve" && recommendation.recommended_responder ? (
              <p className="mt-3 text-sm leading-6 text-slate-200">
                This will mark {recommendation.recommended_responder.callsign} busy
                and set the incident to assigned at{" "}
                {priorityLabel(recommendation.proposed_priority)}, if the server
                still finds that unit available.
              </p>
            ) : null}
            {mode !== "approve" ? (
              <label className="mt-3 block text-sm text-slate-200">
                Reason
                <textarea
                  className="mt-1 w-full rounded-lg border border-white/15 bg-[#050505] px-3 py-2 text-sm text-white"
                  rows={3}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  required
                />
              </label>
            ) : null}
            {reasonMissing ? (
              <p className="mt-2 text-sm text-amber-100" role="status">
                Enter a reason before confirming.
              </p>
            ) : null}
            {overrideSame ? (
              <p className="mt-2 text-sm text-amber-100" role="status">
                Change the priority or choose a unit. An identical selection should be an approval.
              </p>
            ) : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200"
                disabled={pending}
                onClick={() => setMode(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={buttonClass(!confirmDisabled)}
                disabled={confirmDisabled}
                aria-busy={pending}
                onClick={submit}
              >
                {pending ? "Saving the decision…" : "Confirm simulated decision"}
              </button>
            </div>
          </div>
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function DecisionCard({ decision }: { decision: ApprovalDecisionDto }) {
  const original = decision.originalRecommendation;
  return (
    <div className="rounded-xl border border-emerald-300/30 bg-emerald-400/10 px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-50">
        Human decision · {decision.action}
      </p>
      <p className="mt-2 text-sm leading-6 text-emerald-50">
        Recorded as {decision.operatorLabel}. This is separate from the Nemotron
        draft and is not a real dispatch.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Badge className="bg-emerald-400/15 text-emerald-50 ring-emerald-300/40">
          Human
        </Badge>
        <Badge className="bg-cyan-400/15 text-cyan-100 ring-cyan-300/40">
          Nemotron {priorityLabel(original.proposed_priority)}
        </Badge>
        {decision.selectedPriority ? (
          <Badge className={priorityBadgeClass(decision.selectedPriority)}>
            Human {priorityLabel(decision.selectedPriority)}
          </Badge>
        ) : null}
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-100">
        {decision.assignmentCreated
          ? `Simulated assignment ${decision.assignmentId} for ${decision.selectedResponderId}.`
          : "No assignment was created."}
      </p>
      {decision.reason ? (
        <p className="mt-1 text-sm leading-6 text-slate-200">Reason: {decision.reason}</p>
      ) : null}
    </div>
  );
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function actionTitle(action: ApprovalDecisionDto["action"]): string {
  if (action === "approve") return "Approved";
  if (action === "reject") return "Rejected";
  return "Override";
}

function operatorTitle(label: string): string {
  if (label === "local_demo_operator") return "Local demo operator";
  return label;
}

function AuditCard({
  decision,
  responders,
}: {
  decision: ApprovalDecisionDto;
  responders: Responder[];
}) {
  const responder = responders.find((item) => item.id === decision.selectedResponderId);
  const unit = decision.selectedResponderId
    ? `${responder?.callsign ?? "Simulated unit"} · ${decision.selectedResponderId}`
    : "No responder assigned";
  return (
    <li className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-white">{actionTitle(decision.action)}</p>
        <time
          dateTime={decision.createdAt}
          title={decision.createdAt}
          className="font-mono text-[11px] text-cyan-100/80"
        >
          {formatWhen(decision.createdAt)}
        </time>
      </div>
      <dl className="mt-2 space-y-1.5 text-sm leading-6 text-slate-200">
        <div className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Operator
          </dt>
          <dd className="break-words">
            {operatorTitle(decision.operatorLabel)}
            <span className="mt-0.5 block font-mono text-[11px] text-slate-400">
              {decision.operatorLabel}
            </span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Assigned responder
          </dt>
          <dd className="break-words">{unit}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Assignment ID
          </dt>
          <dd className="break-all font-mono text-xs text-slate-100">
            {decision.assignmentId ?? "None"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Reason
          </dt>
          <dd className="break-words">{decision.reason.trim() || "No reason recorded."}</dd>
        </div>
      </dl>
    </li>
  );
}

function ResponderPicker({
  choices,
  value,
  onChange,
}: {
  choices: ResponderChoice[];
  value: string;
  onChange: (responderId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selected = choices.find((choice) => choice.responder.id === value);
  return (
    <div className="mt-1 min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        className="flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-white/15 bg-[#050505] px-3 py-2 text-left text-sm text-white"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 break-words">
          {selected ? selected.responder.callsign : "No assignment — priority only"}
        </span>
        <span aria-hidden="true" className="shrink-0 text-xs text-slate-400">
          {open ? "Hide" : "Choose"}
        </span>
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Human unit"
          className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-white/15 bg-[#050505] py-1"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={value === ""}
              className="w-full px-3 py-2 text-left text-sm text-slate-100 hover:bg-white/[0.06]"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              No assignment — priority only
            </button>
          </li>
          {choices.map((choice) => {
            const responder = choice.responder;
            const selectedOption = value === responder.id;
            return (
              <li key={responder.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedOption}
                  aria-disabled={choice.disabled}
                  className={cn(
                    "w-full min-w-0 px-3 py-2 text-left",
                    choice.disabled
                      ? "cursor-not-allowed"
                      : "hover:bg-white/[0.06]",
                    selectedOption ? "bg-cyan-300/10" : "",
                  )}
                  onClick={() => {
                    if (choice.disabled) return;
                    onChange(responder.id);
                    setOpen(false);
                  }}
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="break-words font-mono text-sm text-white">
                      {responder.callsign}
                    </span>
                    <Badge className={availabilityBadgeClass(responder.availability)}>
                      {availabilityLabel(responder.availability)}
                    </Badge>
                  </span>
                  <span className="mt-1 block break-words text-xs leading-5 text-slate-300">
                    {responder.capabilities.join(" · ")}
                  </span>
                  <span
                    className={cn(
                      "mt-1 block break-words text-xs leading-5",
                      choice.disabled ? "text-amber-100" : "text-slate-400",
                    )}
                  >
                    {choice.reason}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function AuditList({
  decisions,
  responders,
}: {
  decisions: ApprovalDecisionDto[];
  responders: Responder[];
}) {
  if (decisions.length === 0) {
    return (
      <p className="text-xs leading-5 text-slate-500">
        No human decisions are stored for this incident.
      </p>
    );
  }
  return (
    <div className="min-w-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        Audit history
      </h3>
      <ol className="mt-2 space-y-2">
        {decisions.map((decision) => (
          <AuditCard key={decision.id} decision={decision} responders={responders} />
        ))}
      </ol>
    </div>
  );
}
