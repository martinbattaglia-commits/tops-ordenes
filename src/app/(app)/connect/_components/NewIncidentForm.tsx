"use client";

// Nexus Link · formulario de reporte de incidente (F4.2). UX < 1 minuto:
// título + severidad obligatorios; el resto opcional. El alta crea el hilo
// (kind='incident') y notifica síncrono a los administradores de incidentes.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { VoiceField } from "@/components/voice/VoiceField";
import { openIncidentAction } from "@/lib/connect/adapters/driving/incident-actions";
import {
  INCIDENT_SEVERITIES, INCIDENT_SEVERITY_LABELS, type IncidentSeverity,
} from "@/lib/connect/types";
import { MAX_INCIDENT_TITLE } from "@/lib/connect/domain/incident";

export function NewIncidentForm() {
  const router = useRouter();
  const [titulo, setTitulo] = useState("");
  const [severidad, setSeveridad] = useState<IncidentSeverity>("media");
  const [sector, setSector] = useState("");
  const [ubicacion, setUbicacion] = useState("");
  const [tipoAveria, setTipoAveria] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await openIncidentAction({
        titulo,
        severidad,
        sector: sector.trim() || null,
        ubicacion: ubicacion.trim() || null,
        tipoAveria: tipoAveria.trim() || null,
        descripcion: descripcion.trim() || null,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(`/connect/incidentes/${result.id}`);
      router.refresh();
    } catch {
      setError("No se pudo reportar el incidente. Reintentá.");
    } finally {
      setBusy(false); // M-4: el form no queda pegado si la action lanza
    }
  }

  return (
    <div className="card max-w-xl space-y-3 p-4">
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        Título *
        <input
          className="input"
          value={titulo}
          maxLength={MAX_INCIDENT_TITLE}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="ej. Avería montacargas sector D4"
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          Severidad *
          <select
            className="input"
            value={severidad}
            onChange={(e) => setSeveridad(e.target.value as IncidentSeverity)}
          >
            {INCIDENT_SEVERITIES.map((s) => (
              <option key={s} value={s}>{INCIDENT_SEVERITY_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          Sector
          <input className="input w-28" value={sector} maxLength={60}
            onChange={(e) => setSector(e.target.value)} placeholder="ej. D4" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          Tipo de avería
          <input className="input w-44" value={tipoAveria} maxLength={80}
            onChange={(e) => setTipoAveria(e.target.value)} placeholder="ej. Equipo de elevación" />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        Ubicación
        <input className="input" value={ubicacion} maxLength={120}
          onChange={(e) => setUbicacion(e.target.value)} placeholder="ej. MAGALDI_1765 · pasillo 3" />
      </label>

      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        Descripción (primer mensaje del hilo; podés adjuntar fotos en el hilo después)
        <VoiceField>
          <textarea
            className="input min-h-24"
            value={descripcion}
            maxLength={8000}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Qué pasó, desde cuándo, qué se ve afectado…"
          />
        </VoiceField>
      </label>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || titulo.trim().length === 0}
          onClick={() => void submit()}
        >
          <Icon name="bolt" size={14} /> {busy ? "Reportando…" : "Reportar incidente"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => router.back()}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
