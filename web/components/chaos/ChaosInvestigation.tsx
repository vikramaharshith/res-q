"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/ui/SectionHeader";
import {
  CHAOS_BOUND_SCENARIO_ID,
  isChaosAdvisoryDto,
  type ChaosAdvisoryDto,
  type ChaosObservationKind,
} from "@/lib/chaos/investigation-contract";
import { cn } from "@/lib/cn";

function advisoryErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("error" in value)) return null;
  const error = value.error;
  if (!error || typeof error !== "object" || !("message" in error)) return null;
  return typeof error.message === "string" ? error.message : null;
}

function browserFailure(kind: ChaosObservationKind, observationId: string, message: string): ChaosAdvisoryDto {
  return {
    advisory: true,
    assignment_created: false,
    approval_recorded: false,
    dispatch: false,
    scenario_id: CHAOS_BOUND_SCENARIO_ID,
    observation_kind: kind,
    observation_id: observationId,
    model_id: null,
    status: "FAILED",
    validated: false,
    summary: null,
    uncertainty: null,
    note: null,
    error: { code: "REQUEST_FAILED", message, retryable: true },
  };
}

export function ChaosInvestigation({
  observationKind,
  observationId,
}: {
  observationKind: ChaosObservationKind | null;
  observationId: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [advisory, setAdvisory] = useState<ChaosAdvisoryDto | null>(null);
  const canReview = observationKind !== null && observationId !== null;

  const review = async () => {
    if (!observationKind || !observationId || pending) return;
    setPending(true);
    setAdvisory(null);
    try {
      const response = await fetch("/api/chaos-investigation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "advise",
          scenario_id: CHAOS_BOUND_SCENARIO_ID,
          observation_kind: observationKind,
          observation_id: observationId,
        }),
        signal: AbortSignal.timeout(70_000),
      });
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      const message = advisoryErrorMessage(parsed);
      if (!isChaosAdvisoryDto(parsed) || parsed.observation_id !== observationId) {
        setAdvisory(
          browserFailure(
            observationKind,
            observationId,
            message ?? "The review route did not return a usable advisory. Nothing was assigned.",
          ),
        );
        return;
      }
      setAdvisory(parsed);
    } catch {
      setAdvisory(
        browserFailure(
          observationKind,
          observationId,
          "The browser could not finish the review. Nothing was assigned.",
        ),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      id="advisory-review"
      aria-label="Advisory review"
      data-chaos-investigation=""
      data-observation-kind={observationKind ?? ""}
      data-observation-id={observationId ?? ""}
      className="scroll-mt-32 rounded-2xl border border-cyan-300/20 bg-[#101010] px-4 py-4 sm:px-5"
    >
      <SectionHeader
        title="Advisory review"
        subtitle="Nemotron reviews one selected observation on the server. The result does not assign a unit, dispatch a responder, or record a human approval. Other reports stay independent."
      />
      <div className="mt-4 flex flex-col gap-3">
        <p className="break-all font-mono text-xs text-cyan-100/80">
          {canReview ? `${observationKind}:${observationId}` : "Select an emergency or operational observation."}
        </p>
        <button
          type="button"
          onClick={() => {
            void review();
          }}
          disabled={!canReview || pending}
          aria-busy={pending}
          className={cn(
            "w-fit rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors duration-200",
            !canReview || pending
              ? "cursor-not-allowed border-white/10 bg-white/[0.04] text-zinc-500"
              : "border-cyan-300/40 bg-cyan-300/10 text-cyan-50 hover:bg-cyan-300/20",
          )}
        >
          {pending ? "Investigating…" : "Investigate with Nemotron"}
        </button>
        <p className="text-xs leading-5 text-zinc-500">
          {canReview
            ? "This sends that one observation. A unit record or a public assignment cannot be investigated."
            : "Units and public assignments stay on the page. They are not sent to Nemotron."}
        </p>
        <div aria-live="polite">
          {pending ? (
            <p className="text-sm leading-6 text-zinc-300">
              Nemotron is reviewing this observation on the server. Nothing is assigned while you wait.
            </p>
          ) : null}
          {advisory ? (
            <div
              data-chaos-advisory={advisory.status}
              className={cn(
                "rounded-xl border px-3 py-3",
                advisory.status === "COMPLETED"
                  ? "border-cyan-300/25 bg-cyan-300/[0.06]"
                  : "border-rose-300/30 bg-rose-400/10",
              )}
            >
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-amber-300/15 text-amber-100 ring-amber-300/30">Advisory</Badge>
                <Badge className="bg-white/5 text-zinc-300 ring-white/10">
                  {advisory.validated ? "Validated fields" : "Unvalidated wording"}
                </Badge>
              </div>
              {advisory.status === "COMPLETED" ? (
                <>
                  <p className="mt-3 text-sm leading-6 text-zinc-100">{advisory.summary}</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">{advisory.uncertainty}</p>
                  {advisory.note ? <p className="mt-2 text-sm leading-6 text-amber-100">{advisory.note}</p> : null}
                </>
              ) : (
                <p role="alert" className="mt-3 text-sm leading-6 text-rose-50">
                  {advisory.error?.message ?? "No advisory was accepted. Nothing was assigned."}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
