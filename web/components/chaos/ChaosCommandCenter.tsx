"use client";

import { useCallback, useState, type ReactNode } from "react";

import { ChaosInvestigation } from "@/components/chaos/ChaosInvestigation";
import { LocalGridCanvas, LocalGridLegend } from "@/components/chaos/LocalGridMap";
import { CommandTopBar } from "@/components/dashboard/CommandHeader";
import { StartupIntro } from "@/components/intro/StartupIntro";
import { Badge } from "@/components/ui/Badge";
import { SectionHeader } from "@/components/ui/SectionHeader";
import type { ChaosObservationKind } from "@/lib/chaos/investigation-contract";
import {
  gridPlotInputs,
  localGridFrames,
  plotLocalGrid,
  type ChaosClaimView,
  type ChaosEmergencyView,
  type ChaosGridPoint,
  type ChaosOperationalView,
  type ChaosPublicAssignmentView,
  type ChaosDashboardLoad,
  type ChaosSimulationBoard,
  type ChaosUnitView,
  type LocalGridFrame,
} from "@/lib/chaos/read-model";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "#advisory-review", label: "Review" },
  { href: "#fictional-grid", label: "Grid" },
  { href: "#emergency-observations", label: "Reports" },
  { href: "#operational-observations", label: "Operations" },
  { href: "#unit-record", label: "Unit" },
] as const;

function tokenLabel(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

function shown(value: string | null): string {
  return value ?? "—";
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function Fields({ items }: { items: readonly { label: string; value: string }[] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            {item.label}
          </dt>
          <dd className="mt-1 break-words font-mono text-xs leading-5 text-zinc-200">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function locationFields(location: ChaosGridPoint | null): { label: string; value: string }[] {
  if (!location) {
    return [{ label: "Grid location", value: "—" }];
  }
  return [
    { label: "Grid x", value: location.xText },
    { label: "Grid y", value: location.yText },
    { label: "Coordinate system", value: location.coordinateSystem },
    { label: "Fictional", value: "true" },
    { label: "Description", value: location.description },
    { label: "District", value: shown(location.district) },
    { label: "Primary reference", value: shown(location.primaryReference) },
    { label: "Secondary reference", value: shown(location.secondaryReference) },
    { label: "Precision", value: shown(location.precision) },
  ];
}

function ClaimList({ claims }: { claims: readonly ChaosClaimView[] }) {
  if (claims.length === 0) {
    return <p className="text-sm text-zinc-500">No claims on this observation.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {claims.map((claim, index) => (
        <li
          key={`${index}:${claim.code}`}
          className="rounded-xl border border-white/[0.06] bg-black/30 px-3 py-3"
        >
          <p className="text-sm leading-6 text-zinc-200">{claim.statement}</p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Code</dt>
              <dd className="mt-1 font-mono text-xs text-zinc-300">{claim.code}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Stage</dt>
              <dd className="mt-1 font-mono text-xs text-zinc-300">{claim.stage}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Assistance requested</dt>
              <dd className="mt-1 font-mono text-xs text-zinc-300">{yesNo(claim.assistanceRequested)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Value</dt>
              <dd className="mt-1 font-mono text-xs text-zinc-300">{shown(claim.value)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Confidence</dt>
              <dd className="mt-1 font-mono text-xs text-zinc-300">{shown(claim.confidence)}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Detail status</dt>
              <dd className="mt-1 font-mono text-xs text-zinc-300">{shown(claim.detailStatus)}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function RecordButton({
  id,
  selected,
  title,
  meta,
  onSelect,
  children,
}: {
  id: string;
  selected: boolean;
  title: string;
  meta: string;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <article
      id={`record-${id}`}
      className={cn(
        "scroll-mt-32 rounded-2xl border bg-[#101010] px-4 py-4 sm:px-5",
        selected ? "border-cyan-300/40" : "border-white/[0.06]",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(id)}
        className="w-full text-left"
      >
        <span className="block text-sm font-medium text-white">{title}</span>
        <span className="mt-1 block break-all font-mono text-xs text-cyan-100/80">{meta}</span>
      </button>
      <div className="mt-4">{children}</div>
    </article>
  );
}

function EmergencyCard({
  item,
  selected,
  onSelect,
}: {
  item: ChaosEmergencyView;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const id = `emergency:${item.reportId}`;
  return (
    <RecordButton
      id={id}
      selected={selected}
      title={tokenLabel(item.category)}
      meta={item.reportId}
      onSelect={onSelect}
    >
      <span className="mb-4 flex flex-wrap gap-2">
        <Badge className="bg-cyan-300/10 text-cyan-100 ring-cyan-300/30">{item.status}</Badge>
        <Badge className="bg-white/5 text-zinc-300 ring-white/10">{shown(item.urgency)}</Badge>
      </span>
      <p className="text-sm leading-6 text-zinc-300">{item.narrative}</p>
      <div className="mt-4">
        <Fields
          items={[
            { label: "Source type", value: item.sourceType },
            { label: "Observed", value: item.observedAt },
            { label: "Submitted", value: item.submittedAt },
            { label: "Received", value: item.receivedAt },
            { label: "Channel", value: shown(item.sourceMetadata?.channel ?? null) },
            { label: "Organization", value: shown(item.sourceMetadata?.organizationLabel ?? null) },
            { label: "Sensor kind", value: shown(item.sourceMetadata?.sensorKind ?? null) },
            ...locationFields(item.location),
          ]}
        />
      </div>
      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Claims</p>
        <div className="mt-2">
          <ClaimList claims={item.claims} />
        </div>
      </div>
    </RecordButton>
  );
}

function inventoryText(item: ChaosOperationalView): string {
  if (!item.inventory) return "—";
  if (item.inventory.length === 0) return "—";
  return item.inventory.map((entry) => `${entry.name} ${entry.quantity}`).join(", ");
}

function OperationalCard({
  item,
  selected,
  onSelect,
}: {
  item: ChaosOperationalView;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <RecordButton
      id={`operational:${item.observationId}`}
      selected={selected}
      title={tokenLabel(item.messageType)}
      meta={item.observationId}
      onSelect={onSelect}
    >
      <Fields
        items={[
          { label: "Message type", value: item.messageType },
          { label: "Unit", value: item.unitId },
          { label: "Assignment", value: shown(item.assignmentId) },
          { label: "Source", value: item.source },
          { label: "Delivery", value: item.deliveryStatus },
          { label: "Observed", value: item.observedAt },
          { label: "Submitted", value: item.submittedAt },
          { label: "Received", value: item.receivedAt },
          { label: "Availability", value: shown(item.availabilityState) },
          { label: "Task", value: shown(item.taskStatus) },
          { label: "Travel", value: shown(item.travelStatus) },
          { label: "Communication", value: shown(item.communicationState) },
          { label: "Route version", value: item.routeVersion === null ? "—" : String(item.routeVersion) },
          { label: "Fatigue", value: shown(item.fatigueText) },
          { label: "Equipment item", value: shown(item.equipmentItem) },
          { label: "Equipment condition", value: shown(item.equipmentCondition) },
          { label: "Inventory", value: inventoryText(item) },
          ...locationFields(item.location),
        ]}
      />
    </RecordButton>
  );
}

function UnitCard({
  item,
  selected,
  onSelect,
}: {
  item: ChaosUnitView;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <RecordButton
      id={`unit:${item.unitId}`}
      selected={selected}
      title={item.callsign}
      meta={item.unitId}
      onSelect={onSelect}
    >
      <p className="mb-4 text-sm leading-6 text-zinc-400">
        Public unit summary from delivered observations. No capability list was in the export.
      </p>
      <Fields
        items={[
          { label: "Latest observed", value: item.latestObservedAt },
          { label: "Latest received", value: item.latestReceivedAt },
          { label: "Availability", value: shown(item.availabilityState) },
          { label: "Assignment", value: shown(item.assignmentId) },
          { label: "Task", value: shown(item.taskStatus) },
          { label: "Travel", value: shown(item.travelStatus) },
          { label: "Communication", value: shown(item.communicationState) },
          ...locationFields(item.location),
        ]}
      />
    </RecordButton>
  );
}

function AssignmentCard({
  item,
  selected,
  onSelect,
}: {
  item: ChaosPublicAssignmentView;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <RecordButton
      id={`assignment:${item.assignmentId}`}
      selected={selected}
      title="Public assignment"
      meta={item.assignmentId}
      onSelect={onSelect}
    >
      <p className="mb-4 text-sm leading-6 text-zinc-400">
        The staged row stores an assignment id, a unit id, and the first time it was received.
        It has no incident, approval, or origin.
      </p>
      <Fields
        items={[
          { label: "Assignment", value: item.assignmentId },
          { label: "Unit", value: item.unitId },
          { label: "First received", value: item.firstReceivedAt },
        ]}
      />
    </RecordButton>
  );
}

function emptyFrame(): LocalGridFrame {
  return {
    id: "overview",
    title: "Full fictional grid",
    detail: "Linear simulated local grid. Higher y is higher on the frame.",
    plot: plotLocalGrid([]),
  };
}

function selectedObservation(selectedId: string): {
  kind: ChaosObservationKind | null;
  id: string | null;
} {
  if (selectedId.startsWith("emergency:")) {
    return { kind: "emergency", id: selectedId.slice("emergency:".length) };
  }
  if (selectedId.startsWith("operational:")) {
    return { kind: "operational", id: selectedId.slice("operational:".length) };
  }
  return { kind: null, id: null };
}

function initialSelection(board: ChaosSimulationBoard | null): string {
  const reportId = board?.emergencyObservations[0]?.reportId;
  return reportId ? `emergency:${reportId}` : "";
}

export function ChaosCommandCenter({ loaded }: { loaded: ChaosDashboardLoad }) {
  const board = loaded.ok ? loaded.board : null;
  const frames = board ? localGridFrames(gridPlotInputs(board)) : [];
  const overview = frames[0] ?? emptyFrame();
  const insets = frames.slice(1);
  const [selectedId, setSelectedId] = useState(() => initialSelection(board));
  const selectedObservationRecord = selectedObservation(selectedId);
  const [replayToken, setReplayToken] = useState(0);
  const landOnMap = useCallback(() => {
    delete document.documentElement.dataset.resqLand;
  }, []);

  const selectRecord = (id: string) => {
    setSelectedId(id);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.requestAnimationFrame(() => {
      document.getElementById(`record-${id}`)?.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "nearest",
      });
    });
  };

  return (
    <div className="min-h-dvh bg-[#050505] text-white" data-scenario="chaos">
      <div data-command-shell="" className="min-h-dvh">
        <CommandTopBar
          subtitle={board?.sourceLabel ?? "Chaos Simulation"}
          active="chaos"
          links={LINKS}
          onReplayIntro={() => setReplayToken((value) => value + 1)}
        />
        <main className="mx-auto flex w-full max-w-[90rem] flex-col gap-8 px-4 py-6 pb-[max(3rem,env(safe-area-inset-bottom))] sm:px-6 lg:gap-10 lg:px-8 lg:py-8">
          <section
            aria-label="Fictional simulation"
            className="startup-chrome-top rounded-2xl border border-amber-300/25 bg-amber-300/[0.06] px-4 py-4 sm:px-5"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200">
              Fictional simulation
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-300">
              Staged Chaos Engine training export on a simulated local grid. Positions are fictional
              x and y values. Nemotron can review one selected observation. The review is advisory.
              Human approvals stay off. Reports stay separate.
            </p>
            {board ? (
              <p className="mt-3 break-all font-mono text-xs leading-5 text-zinc-400">
                {board.importRunId}
                {" · "}
                {board.runId}
                {" · "}
                {board.schemaVersion}
                {" · "}
                {board.simulationStatus}
                {" · "}
                {shown(board.difficulty)}
                {" · "}
                {board.simulationStart}
                {" → "}
                {board.simulationExport}
              </p>
            ) : (
              <p className="mt-3 text-sm leading-6 text-amber-100">{loaded.ok ? "" : loaded.message}</p>
            )}
          </section>

          {board ? (
            <section
              aria-label="Chaos sample overview"
              data-chaos-summary=""
              data-emergency={board.emergencyObservations.length}
              data-operational={board.operationalObservations.length}
              data-units={board.units.length}
              data-assignments={board.publicAssignments.length}
              className="startup-chrome-top"
            >
              <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
                {[
                  ["Emergency observations", board.emergencyObservations.length, "Received reports, kept separate"],
                  ["Operational observations", board.operationalObservations.length, "Delivered messages"],
                  ["Units", board.units.length, "Public unit summary"],
                  ["Public assignments", board.publicAssignments.length, "No human approval"],
                ].map(([label, value, hint]) => (
                  <div
                    key={String(label)}
                    className="rounded-2xl border border-white/[0.06] bg-[#101010] px-4 py-4 sm:px-5 sm:py-5"
                  >
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 sm:text-[11px]">
                      {label}
                    </dt>
                    <dd className="mt-3 text-4xl font-medium tracking-tight text-white tabular-nums sm:text-5xl">
                      {value}
                    </dd>
                    <dd className="mt-2 text-xs leading-5 text-zinc-500">{hint}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {board ? (
            <ChaosInvestigation
              key={`${selectedObservationRecord.kind ?? "none"}:${selectedObservationRecord.id ?? ""}`}
              observationKind={selectedObservationRecord.kind}
              observationId={selectedObservationRecord.id}
            />
          ) : null}

          <div className="flex flex-col gap-4">
            <div className="startup-chrome-top">
              <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-white">
                Fictional local grid
              </h2>
              <p className="mt-1.5 max-w-3xl text-sm leading-6 text-zinc-400">
                {overview.detail} Nearby points are repeated below on tighter frames that use the same
                coordinates.
              </p>
            </div>
            <section
              id="fictional-grid"
              aria-label="Fictional local grid"
              className="startup-map-slot isolate flex h-[min(78svh,54rem)] min-h-[22rem] w-full scroll-mt-32 flex-col overflow-hidden rounded-[1.35rem] border border-cyan-300/15 bg-[#080808] shadow-[inset_0_0_0_1px_rgba(52,211,153,0.08),0_28px_80px_rgba(0,0,0,0.45)]"
            >
              <div data-local-grid="" className="flex h-full min-h-0 flex-col">
                <div className="min-h-0 flex-1">
                  <LocalGridCanvas frame={overview} selectedId={selectedId} onSelect={selectRecord} />
                </div>
                <LocalGridLegend />
              </div>
            </section>
            {insets.length > 0 ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {insets.map((frame) => (
                  <section
                    key={frame.id}
                    aria-label={frame.title}
                    className="overflow-hidden rounded-[1.35rem] border border-white/[0.06] bg-[#080808]"
                  >
                    <div className="border-b border-white/[0.06] px-4 py-3">
                      <h3 className="font-mono text-xs text-cyan-100">{frame.title}</h3>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">{frame.detail}</p>
                    </div>
                    <div className="h-72">
                      <LocalGridCanvas frame={frame} selectedId={selectedId} onSelect={selectRecord} />
                    </div>
                  </section>
                ))}
              </div>
            ) : null}
          </div>

          {board ? (
            <>
              <section
                id="emergency-observations"
                aria-label="Emergency observations"
                className="startup-queue-slot startup-chrome-left scroll-mt-32"
              >
                <SectionHeader
                  title="Emergency observations"
                  subtitle="Two received reports. They stay separate observations. A shared district is not an incident."
                />
                <div className="mt-4 flex flex-col gap-3">
                  {board.emergencyObservations.map((item) => (
                    <EmergencyCard
                      key={item.reportId}
                      item={item}
                      selected={selectedId === `emergency:${item.reportId}`}
                      onSelect={selectRecord}
                    />
                  ))}
                </div>
              </section>
              <section
                id="operational-observations"
                aria-label="Operational observations"
                className="startup-case-slot startup-chrome-right scroll-mt-32"
              >
                <SectionHeader
                  title="Operational observations"
                  subtitle="Delivered messages in public receipt order. An assignment id here is the id stored on that message."
                />
                <div className="mt-4 flex flex-col gap-3">
                  {board.operationalObservations.map((item) => (
                    <OperationalCard
                      key={item.observationId}
                      item={item}
                      selected={selectedId === `operational:${item.observationId}`}
                      onSelect={selectRecord}
                    />
                  ))}
                </div>
              </section>
              <section id="unit-record" aria-label="Unit and public assignment" className="startup-chrome-bottom scroll-mt-32">
                <SectionHeader
                  title="Unit and public assignment"
                  subtitle="The unit summary and the public assignment are shown from their own staged rows."
                />
                <div className="mt-4 grid items-start gap-4 xl:grid-cols-2">
                  {board.units.map((item) => (
                    <UnitCard
                      key={item.unitId}
                      item={item}
                      selected={selectedId === `unit:${item.unitId}`}
                      onSelect={selectRecord}
                    />
                  ))}
                  {board.publicAssignments.map((item) => (
                    <AssignmentCard
                      key={item.assignmentId}
                      item={item}
                      selected={selectedId === `assignment:${item.assignmentId}`}
                      onSelect={selectRecord}
                    />
                  ))}
                </div>
              </section>
            </>
          ) : null}
        </main>
      </div>
      <StartupIntro replayToken={replayToken} onLand={landOnMap} />
    </div>
  );
}
