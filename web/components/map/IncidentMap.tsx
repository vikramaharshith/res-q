"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
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

function finitePair(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}

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
  ].filter((point) => finitePair(point[0], point[1]));
}

function mapIsLaidOut(map: LeafletMap): boolean {
  const rect = map.getContainer().getBoundingClientRect();
  return rect.width >= 40 && rect.height >= 40;
}

function mapCanMove(map: LeafletMap): boolean {
  if (!mapIsLaidOut(map)) return false;
  const size = map.getSize();
  if (!size || size.x < 40 || size.y < 40) {
    try {
      map.invalidateSize({ animate: false, pan: false });
    } catch {
      return false;
    }
  }
  const next = map.getSize();
  if (!next || next.x < 40 || next.y < 40) return false;
  try {
    const center = map.getCenter();
    return Number.isFinite(center.lat) && Number.isFinite(center.lng);
  } catch {
    return false;
  }
}

function moveMapTo(map: LeafletMap, lat: number, lon: number): boolean {
  if (!finitePair(lat, lon) || !mapCanMove(map)) return false;
  const currentZoom = map.getZoom();
  const zoom = Math.max(Number.isFinite(currentZoom) ? currentZoom : 12, 14);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    if (reduce) map.setView([lat, lon], zoom, { animate: false });
    else map.flyTo([lat, lon], zoom, { duration: 0.55 });
  } catch {
    return false;
  }
  return true;
}

function fitMap(
  map: LeafletMap,
  points: [number, number][],
  animate: boolean,
): boolean {
  const finite = points.filter((point) => finitePair(point[0], point[1]));
  if (finite.length === 0 || !mapCanMove(map)) return false;
  let south = finite[0][0];
  let north = finite[0][0];
  let west = finite[0][1];
  let east = finite[0][1];
  for (const [lat, lon] of finite) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lon);
    east = Math.max(east, lon);
  }
  try {
    map.fitBounds(
      [
        [south, west],
        [north, east],
      ],
      { padding: [32, 32], animate, maxZoom: 14 },
    );
  } catch {
    return false;
  }
  return true;
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
  const pointsRef = useRef(points);
  const latRef = useRef(lat);
  const lonRef = useRef(lon);
  const fitted = useRef(false);
  const pendingMove = useRef(false);
  const seenSelection = useRef<string | null>(null);
  const seenFitToken = useRef(fitToken);

  useEffect(() => {
    pointsRef.current = points;
    latRef.current = lat;
    lonRef.current = lon;
  }, [lat, lon, points]);

  useEffect(() => {
    const container = map.getContainer();
    let frame = 0;
    const apply = () => {
      if (
        pendingMove.current &&
        moveMapTo(map, latRef.current, lonRef.current)
      ) {
        pendingMove.current = false;
        fitted.current = true;
        return;
      }
      if (fitted.current || pendingMove.current) return;
      if (fitMap(map, pointsRef.current, false)) fitted.current = true;
    };
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(apply);
    });
    observer.observe(container);
    const timeout = window.setTimeout(apply, 60);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
      window.cancelAnimationFrame(frame);
    };
  }, [map]);

  useEffect(() => {
    if (seenSelection.current === null) {
      seenSelection.current = selectedId;
      return;
    }
    if (seenSelection.current === selectedId) return;
    seenSelection.current = selectedId;
    pendingMove.current = true;
    if (moveMapTo(map, latRef.current, lonRef.current)) {
      pendingMove.current = false;
      fitted.current = true;
    }
  }, [map, selectedId]);

  useEffect(() => {
    if (seenFitToken.current === fitToken) return;
    seenFitToken.current = fitToken;
    pendingMove.current = false;
    if (fitMap(map, pointsRef.current, false)) fitted.current = true;
  }, [fitToken, map]);

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
    <div className="resq-map relative h-full min-h-[22rem] bg-[#050505]">
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
        {ordered.filter((incident) => finitePair(incident.lat, incident.lon)).map((incident) => {
          const selectedMarker = incident.id === selectedId;
          const color = statusHex(incident.status);
          return (
            <CircleMarker
              key={incident.id}
              center={[incident.lat, incident.lon]}
              radius={selectedMarker ? 11 : 7}
              pathOptions={{
                color: selectedMarker ? "#67e8f9" : color,
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
        {responders.filter((responder) => finitePair(responder.lat, responder.lon)).map((responder) => {
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
        <p className="rounded-xl border border-white/[0.08] bg-[#050505]/92 px-3 py-2 text-[11px] leading-4 text-zinc-200 shadow-lg">
          Simulated pins on OpenStreetMap. Not live emergencies.
        </p>
        <button
          type="button"
          onClick={() => setFitToken((value) => value + 1)}
          className="pointer-events-auto rounded-xl border border-cyan-300/30 bg-[#050505]/92 px-3 py-1.5 text-[11px] font-semibold text-cyan-100 transition-colors duration-200 hover:border-cyan-200/60 hover:bg-cyan-300/10"
        >
          Show all
        </button>
      </div>
      <ul className="pointer-events-none absolute bottom-5 left-3 z-[500] max-w-[16rem] space-y-1 rounded-xl border border-white/[0.08] bg-[#050505]/92 px-3 py-2 text-[10px] text-zinc-300 shadow-lg">
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
