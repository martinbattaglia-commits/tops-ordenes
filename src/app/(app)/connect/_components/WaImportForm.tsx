"use client";

// Nexus Link · LINK-WA-002 F1a — formulario del importador: archivo → preview en seco →
// confirmación humana (contraparte + teléfono + identidad) → ingesta idempotente.

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import type { WaParseResult } from "@/lib/connect/wa-import/parser";
import {
  previewWaExportAction, ingestWaExportAction,
} from "@/lib/connect/adapters/driving/wa-import-actions";

type Step = "upload" | "confirm" | "done";

export function WaImportForm() {
  const [step, setStep] = useState<Step>("upload");
  const [raw, setRaw] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<WaParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [counterpartAuthor, setCounterpartAuthor] = useState("");
  const [phone, setPhone] = useState("+549");
  const [displayName, setDisplayName] = useState("");
  const [entityType, setEntityType] = useState<string>("");

  const [result, setResult] = useState<{
    conversationId: string; inserted: number; duplicates: number;
  } | null>(null);

  async function onFile(file: File) {
    setErr(null);
    setBusy(true);
    try {
      const text = await file.text();
      const r = await previewWaExportAction({ raw: text });
      if (!r.ok) { setErr(r.message); return; }
      setRaw(text);
      setFileName(file.name);
      setPreview(r.preview);
      // El nombre del export ("Chat de WhatsApp con X.txt" / "WhatsApp Chat with X.txt")
      // identifica a LA CONTRAPARTE. Sin esto el default caía en el autor más hablador,
      // que suele ser TOPS — y el hilo se identificaría con NUESTRO número.
      const m = file.name.match(/(?:chat de whatsapp con|whatsapp chat with)\s+(.+?)\.txt$/i);
      const hint = m?.[1]?.trim().toLowerCase();
      const authors = r.preview.authors;
      const guess =
        (hint && authors.find((a) => {
          const n = a.name.toLowerCase();
          return n === hint || n.includes(hint) || hint.includes(n);
        })?.name) ??
        // Sin pista: el autor con MENOS mensajes suele ser la contraparte antes que nosotros.
        authors[authors.length - 1]?.name ??
        "";
      setCounterpartAuthor(guess);
      setDisplayName(guess);
      setStep("confirm");
    } finally {
      setBusy(false);
    }
  }

  async function onIngest() {
    setErr(null);
    setBusy(true);
    try {
      const r = await ingestWaExportAction({
        raw,
        counterpartAuthor,
        counterpartPhone: phone,
        displayName,
        entityType: entityType || null,
      });
      if (!r.ok) { setErr(r.message ?? "Falló la importación."); return; }
      setResult({
        conversationId: r.conversationId!,
        inserted: r.inserted ?? 0,
        duplicates: r.duplicates ?? 0,
      });
      setStep("done");
    } finally {
      setBusy(false);
    }
  }

  if (step === "done" && result) {
    return (
      <div className="card p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-500">
          <Icon name="check-circle" size={16} /> Importación completa
        </p>
        <p className="mt-2 text-xs text-fg-secondary">
          {result.inserted} mensajes nuevos · {result.duplicates} duplicados omitidos (idempotencia).
          El hilo nació <strong>archivado</strong> — está en la pestaña Archivo de la bandeja.
        </p>
        <div className="mt-4 flex items-center gap-2">
          <Link href={`/connect/c/${result.conversationId}`} className="btn btn-nexus btn-sm">
            Abrir el hilo
          </Link>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setStep("upload"); setPreview(null); setRaw(""); }}>
            Importar otro chat
          </button>
        </div>
      </div>
    );
  }

  if (step === "confirm" && preview) {
    return (
      <div className="card space-y-4 p-5">
        <div>
          <p className="text-sm font-semibold text-fg-primary">{fileName}</p>
          <p className="mt-1 text-xs text-fg-muted">
            {preview.authors.reduce((n, a) => n + a.count, 0)} mensajes ·{" "}
            {preview.firstTs?.slice(0, 10)} → {preview.lastTs?.slice(0, 10)} ·{" "}
            {preview.skippedMedia} multimedia omitida (D4) · {preview.skippedSystem} de sistema ·{" "}
            {preview.unparsedLines} líneas no reconocidas
          </p>
        </div>

        <label className="block text-xs text-fg-secondary">
          ¿Quién es la contraparte? — el CLIENTE/PROVEEDOR, no TOPS
          <select value={counterpartAuthor} onChange={(e) => setCounterpartAuthor(e.target.value)} className="input mt-1 w-full text-xs">
            {preview.authors.map((a) => (
              <option key={a.name} value={a.name}>{a.name} · {a.count} mensajes</option>
            ))}
          </select>
        </label>

        <label className="block text-xs text-fg-secondary">
          Teléfono DE LA CONTRAPARTE (E164) — no el número de TOPS
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+5491122334455" className="input mt-1 w-full text-xs" />
          <span className="mt-1 block text-[10px] text-fg-muted">
            Identifica el hilo: cada contraparte tiene el suyo. Si ponés el número de TOPS,
            todos los chats terminarían en la misma conversación.
          </span>
        </label>

        <label className="block text-xs text-fg-secondary">
          Nombre visible del hilo
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="input mt-1 w-full text-xs" />
        </label>

        <label className="block text-xs text-fg-secondary">
          Tipo de entidad (opcional)
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)} className="input mt-1 w-full text-xs">
            <option value="">Sin clasificar</option>
            <option value="cliente">Cliente</option>
            <option value="proveedor">Proveedor</option>
            <option value="contacto">Contacto</option>
            <option value="interno">Interno</option>
          </select>
        </label>

        {err && <p className="text-xs text-tops-red">{err}</p>}

        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-nexus btn-sm" disabled={busy} onClick={() => void onIngest()}>
            {busy ? "Importando…" : "Confirmar e importar"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setStep("upload"); setPreview(null); }}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5">
      <label className="block text-xs text-fg-secondary">
        Archivo del export (.txt)
        <input
          type="file"
          accept=".txt,text/plain"
          disabled={busy}
          className="input mt-1 w-full text-xs"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />
      </label>
      <p className="mt-2 text-[10px] text-fg-muted">
        En el teléfono: chat → ⋮ → Más → Exportar chat → <strong>Sin archivos</strong>. Si el export
        viene en .zip, extraé el .txt. Máx ~900 KB de texto por importación.
      </p>
      {err && <p className="mt-2 text-xs text-tops-red">{err}</p>}
      {busy && <p className="mt-2 text-xs text-fg-muted">Analizando…</p>}
    </div>
  );
}
