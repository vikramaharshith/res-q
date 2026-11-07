"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

import { availabilityHex, statusHex, statusLabel } from "@/lib/demo/labels";
import type { Assignment, Incident, Responder } from "@/lib/demo/types";
import { INCIDENT_STATUSES } from "@/lib/demo/types";

function pointsFor(
  incidents: Incident[],
  responders: Responder[],
): [number, number][] {
  return [
    ...incidents.map(
      (incident) => [incident.lat, incident.lon] as [number, number],
    ),
    ...responders.map(
      (responder) => [responder.lat, responder.lon] as [number, number],
    ),
  ];
}

function MapViewport({
  points,
  selectedId,
  lat,
  lon,
  fitToken,
}: {
  points: [number, number][];
  selectedId: string;
  lat: number;
  lon: number;
  fitToken: number;
}) {
  const map = useMap();
  const fitted = useRef(false);
  const userMoved = useRef(false);
  const seenSelection = useRef<string | null>(null);
  const seenFitToken = useRef(fitToken);

  useEffect(() => {
    const container = map.getContainer();
    const fit = () => {
      const rect = container.getBoundingClientRect();
      map.invalidateSize();
      if (rect.width < 40 || rect.height < 40 || points.length === 0) return;
      if (userMoved.current) {
        fitted.current = true;
        return;
      }
      if (fitted.current) return;
      fitted.current = true;
      map.fitBounds(points, { padding: [32, 32], animate: false });
    };
    const observer = new ResizeObserver(() => fit());
    observer.observe(container);
    const timeout = window.setTimeout(fit, 60);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [map, points]);

  useEffect(() => {
    if (seenSelection.current === null) {
      seenSelection.current = selectedId;
      return;
    }
    if (seenSelection.current === selectedId) return;
    seenSelection.current = selectedId;
    userMoved.current = true;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const zoom = Math.max(map.getZoom(), 14);
    if (reduce) map.setView([lat, lon], zoom);
    else map.flyTo([lat, lon], zoom, { duration: 0.55 });
  }, [lat, lon, map, selectedId]);

  useEffect(() => {
    if (seenFitToken.current === fitToken) return;
    seenFitToken.current = fitToken;
    if (points.length === 0) return;
    fitted.current = true;
    map.fitBounds(points, { padding: [32, 32] });
  }, [fitToken, map, points]);

  return null;
}

export default function IncidentMap({
  incidents,
  responders,
  assignments,
  selectedId,
  mapCenter,
  onSelect,
  onOpenCase,
}: {
  incidents: Incident[];
  responders: Responder[];
  assignments: Assignment[];
  selectedId: string;
  mapCenter: { lat: number; lon: number };
  onSelect: (incidentId: string) => void;
  onOpenCase: (incidentId: string) => void;
}) {
  const [fitToken, setFitToken] = useState(0);
  const points = useMemo(
    () => pointsFor(incidents, responders),
    [incidents, responders],
  );
  const selected = incidents.find((incident) => incident.id === selectedId);
  const ordered = [...incidents].sort((left, right) => {
    if (left.id === selectedId) return 1;
    if (right.id === selectedId) return -1;
    return 0;
  });

  return (
    <div className="resq-map relative h-full min-h-[20rem] bg-[#0b1522]">
      <MapContainer
        center={[mapCenter.lat, mapCenter.lon]}
        zoom={12}
        className="h-full w-full"
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {selected ? (
          <MapViewport
            points={points}
            selectedId={selected.id}
            lat={selected.lat}
            lon={selected.lon}
            fitToken={fitToken}
          />
        ) : null}
        {ordered.map((incident) => {
          const selectedMarker = incident.id === selectedId;
          const color = statusHex(incident.status);
          return (
            <CircleMarker
              key={incident.id}
              center={[incident.lat, incident.lon]}
              radius={selectedMarker ? 11 : 7}
              pathOptions={{
                color: selectedMarker ? "#f8fafc" : color,
                weight: selectedMarker ? 3 : 1.5,
                fillColor: color,
                fillOpacity: 0.9,
              }}
              eventHandlers={{
                click: () => onSelect(incident.id),
              }}
            >
              <Popup>
                <div className="space-y-2 text-xs leading-5">
                  <p className="font-mono text-[10px] text-cyan-200">
                    {incident.id}
                  </p>
                  <p>{incident.summary}</p>
                  <p className="text-slate-300">
                    {incident.district} · {statusLabel(incident.status)} ·{" "}
                    {incident.reportIds.length}{" "}
                    {incident.reportIds.length === 1 ? "report" : "reports"}
                  </p>
                  <p className="text-slate-400">
                    Simulated pin. Not a live emergency.
                  </p>
                  <button
                    type="button"
                    onClick={() => onOpenCase(incident.id)}
                    className="rounded-md bg-cyan-300 px-2 py-1 text-[11px] font-semibold text-slate-950"
                  >
                    Open case
                  </button>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
        {responders.map((responder) => {
          const active = assignments.find(
            (assignment) =>
              assignment.responderId === responder.id &&
              (assignment.status === "ASSIGNED" ||
                assignment.status === "IN_PROGRESS"),
          );
          const color = availabilityHex(responder.availability);
          return (
            <CircleMarker
              key={responder.id}
              center={[responder.lat, responder.lon]}
              radius={6}
              pathOptions={{
                color,
                weight: 2,
                fillColor: color,
                fillOpacity: 0.12,
              }}
            >
              <Popup>
                <div className="space-y-1 text-xs leading-5">
                  <p className="font-mono text-sm">{responder.callsign}</p>
                  <p>{responder.availability}</p>
                  <p className="text-slate-300">
                    {responder.capabilities.join(" · ")}
                  </p>
                  <p className="text-slate-400">
                    {active
                      ? `Baseline assignment ${active.id} on ${active.incidentId}`
                      : "No active baseline assignment"}
                  </p>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <div className="pointer-events-none absolute right-3 top-3 z-[500] flex max-w-[14rem] flex-col items-end gap-2">
        <p className="rounded-lg border border-white/10 bg-[#071018]/90 px-3 py-2 text-[11px] leading-4 text-slate-200 shadow-lg">
          Simulated pins on OpenStreetMap. Not live emergencies.
        </p>
        <button
          type="button"
          onClick={() => setFitToken((value) => value + 1)}
          className="pointer-events-auto rounded-lg border border-cyan-200/30 bg-[#071018]/90 px-3 py-1.5 text-[11px] font-semibold text-cyan-100"
        >
          Show all
        </button>
      </div>
      <ul className="pointer-events-none absolute bottom-5 left-3 z-[500] max-w-[16rem] space-y-1 rounded-lg border border-white/10 bg-[#071018]/90 px-3 py-2 text-[10px] text-slate-300 shadow-lg">
        {INCIDENT_STATUSES.map((status) => (
          <li key={status} className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: statusHex(status) }}
            />
            <span>{statusLabel(status)}</span>
          </li>
        ))}
        <li className="pt-1 text-slate-400">Rings mark simulated responders.</li>
      </ul>
    </div>
  );
}
