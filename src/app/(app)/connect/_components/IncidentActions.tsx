"use client";

// Nexus Link · acciones de ciclo de vida del incidente (F4.2). La UI ofrece solo
// lo que el dominio habilita (availableActions, espejo de 0165); el RPC re-valida
// SIEMPRE (autoridad final). Asignar-a-terceros reusa connect_search_profiles
// (searchProfilesAction, sin exponer email — PII lockdown).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import {
  assignIncidentAction, resolveIncidentAction, setIncidentSeverityAction, setIncidentStatusAction,
} from "@/lib/connect/adapters/driving/incident-actions";
import { searchProfilesAction, type ProfileHit } from "@/lib/connect/adapters/driving/channel-actions";
import {
  availableActions, ACTION_TARGET_STATUS, type IncidentAction, type IncidentViewer,
} from "@/lib/connect/domain/incident";
import {
  INCIDENT_SEVERITIES, INCIDENT_SEVERITY_LABELS, type Incident, type IncidentSeverity,
} from "@/lib/connect/types";

const TRANSITION_LABELS: Partial<Record<IncidentAction, { label: string; icon: "play" | "pause" | "check" | "refresh" | "x" }>> = {
  start: { label: "Iniciar", icon: "play" },
  hold: { label: "Poner en espera", icon: "pause" },
  resume: { label: "Reanudar", icon: "play" },
  close: { label: "Cerrar", icon: "check" },
  reopen: { label: "Reabrir", icon: "refresh" },
  force_close: { label: "Cierre forzado", icon: "x" },
};

export function IncidentActions({
  incident, currentUserId, isIncidentAdmin,
}: {
  incident: Incident;
  currentUserId: string | null;
  isIncidentAdmin: boolean;
}) {
  const router = useRouter();
  const viewer: IncidentViewer = { userId: currentUserId, isIncidentAdmin };
  const actions = availableActions(incident, viewer);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProfileHit[]>([]);

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const r = await fn();
      if (!r.ok) {
        setError(("message" in r && r.message) || "No se pudo completar la acción.");
        return;
      }
      setResolving(false);
      setAssigning(false);
      setResolution("");
      router.refresh();
    } catch {
      setError("No se pudo completar la acción. Reintentá.");
    } finally {
      setBusy(false); // M-4: la botonera no queda pegada si la action lanza
    }
  }

  function transition(action: IncidentAction) {
    const status = ACTION_TARGET_STATUS[action];
    if (!status) return;
    void run(() => setIncidentStatusAction({ incidentId: incident.id, status }));
  }

  async function search(q: string) {
    setQuery(q);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const r = await searchProfilesAction({ q });
    setHits(r.ok ? r.hits.filter((h) => h.profileId !== incident.asignadoA) : []);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {actions.includes("assign_self") && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
            onClick={() => currentUserId && void run(() => assignIncidentAction({ incidentId: incident.id, toProfileId: currentUserId }))}>
            <Icon name="user" size={13} /> Asignarme
          </button>
        )}
        {actions.includes("assign") && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy}
            onClick={() => { setAssigning((s) => !s); setResolving(false); }}>
            <Icon name="users" size={13} /> Asignar a…
          </button>
        )}
        {(["start", "hold", "resume"] as const).filter((a) => actions.includes(a)).map((a) => (
          <button key={a} type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => transition(a)}>
            <Icon name={TRANSITION_LABELS[a]!.icon} size={13} /> {TRANSITION_LABELS[a]!.label}
          </button>
        ))}
        {actions.includes("resolve") && (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy}
            onClick={() => { setResolving((s) => !s); setAssigning(false); }}>
            <Icon name="check-circle" size={13} /> Resolver
          </button>
        )}
        {(["close", "reopen"] as const).filter((a) => actions.includes(a)).map((a) => (
          <button key={a} type="button"
            className={a === "close" ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}
            disabled={busy} onClick={() => transition(a)}>
            <Icon name={TRANSITION_LABELS[a]!.icon} size={13} /> {TRANSITION_LABELS[a]!.label}
          </button>
        ))}
        {actions.includes("force_close") && (
          <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => transition("force_close")}>
            <Icon name="x" size={13} /> Cierre forzado
          </button>
        )}
        {actions.includes("set_severity") && (
          <label className="flex items-center gap-1 text-[11px] text-fg-muted">
            Severidad
            <select
              className="input text-xs"
              value={incident.severidad}
              disabled={busy}
              onChange={(e) =>
                void run(() => setIncidentSeverityAction({
                  incidentId: incident.id,
                  severity: e.target.value as IncidentSeverity,
                }))
              }
            >
              {INCIDENT_SEVERITIES.map((s) => (
                <option key={s} value={s}>{INCIDENT_SEVERITY_LABELS[s]}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {assigning && (
        <div className="card space-y-2 p-3">
          <input
            className="input"
            value={query}
            placeholder="Buscar usuario interno (mín. 2 letras)…"
            onChange={(e) => void search(e.target.value)}
          />
          {hits.length > 0 && (
            <ul className="space-y-1">
              {hits.map((h) => (
                <li key={h.profileId}>
                  <button type="button" className="btn btn-ghost btn-sm w-full justify-start" disabled={busy}
                    onClick={() => void run(() => assignIncidentAction({ incidentId: incident.id, toProfileId: h.profileId }))}>
                    <Icon name="user" size={13} /> {h.fullName ?? "Usuario interno"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {resolving && (
        <div className="card space-y-2 p-3">
          <textarea
            className="input min-h-20 w-full"
            value={resolution}
            maxLength={2000}
            placeholder="Qué se hizo para resolver el incidente (obligatorio)…"
            onChange={(e) => setResolution(e.target.value)}
          />
          <button type="button" className="btn btn-primary btn-sm"
            disabled={busy || resolution.trim().length === 0}
            onClick={() => void run(() => resolveIncidentAction({ incidentId: incident.id, resolution }))}>
            <Icon name="check-circle" size={13} /> Confirmar resolución
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
