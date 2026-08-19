"use client";

/**
 * H-1 · el ÚLTIMO paso del ciclo de vida de un adjunto, que nunca se construyó.
 *
 * Hasta acá el archivo se subía, se guardaba en storage, se registraba en
 * `connect_attachments` y quedaba ligado a su mensaje —los 16 mensajes `file`
 * de producción tienen su fila—, pero `ThreadView` no tenía rama para
 * `kind === "file"`: la burbuja caía al `else` de texto y mostraba `📎 foto.png`
 * sin imagen, sin enlace y sin descarga. El emisor veía éxito porque lo hubo; el
 * receptor no podía abrir nada. Y fallaba igual en DM, Incidentes y canales
 * porque las tres superficies montan ESTE mismo hilo.
 *
 * `getAttachmentUrlAction` ya existía y funcionaba: no tenía un solo llamador.
 * Acá lo tiene.
 *
 * POR QUÉ LA IMAGEN CARGA SOLA Y EL RESTO NO: cada URL firmada pasa por
 * `connect_emit_attachment_signed_url`, que revalida membresía y AUDITA el
 * acceso. Una vista previa que exige un clic no es una vista previa, así que la
 * imagen se resuelve al montar; el audio y la descarga se resuelven cuando el
 * usuario los pide, y así el registro de auditoría refleja accesos reales en
 * vez de barridos de la pantalla.
 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { getAttachmentUrlAction } from "@/lib/connect/adapters/driving/attachment-actions";
import { presentAttachment } from "@/lib/connect/attachment-presentation";
import type { MessageAttachment } from "@/lib/connect/types";
import { AudioPlayer } from "./AudioPlayer";

interface FalloVisible {
  message: string;
  /** Causa tipada de H-3. Se muestra abreviada: sirve al soporte, no delata. */
  code: string | null;
}

function useSignedUrl(attachmentId: string) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fallo, setFallo] = useState<FalloVisible | null>(null);

  const resolver = useCallback(async (): Promise<string | null> => {
    if (url) return url;
    setLoading(true);
    setFallo(null);
    try {
      const r = await getAttachmentUrlAction({ attachmentId });
      if (!r.ok) {
        // H-3: la causa REAL llega tipada. Se muestra el mensaje accionable y,
        // en chico, la clase — para que un reporte de soporte no vuelva a ser
        // «no anda» sino «no_access en signed_url».
        setFallo({ message: r.message, code: r.cause ? r.cause.kind : null });
        return null;
      }
      setUrl(r.url);
      return r.url;
    } finally {
      setLoading(false);
    }
  }, [attachmentId, url]);

  return { url, loading, fallo, resolver };
}

function Fallo({ fallo }: { fallo: FalloVisible }) {
  return (
    <p className="flex items-start gap-1 text-[11px] text-tops-red" role="status">
      <Icon name="x" size={11} className="mt-px shrink-0" aria-hidden />
      <span>
        {fallo.message}
        {fallo.code && <span className="ml-1 opacity-70">({fallo.code})</span>}
      </span>
    </p>
  );
}

function Cargando({ texto }: { texto: string }) {
  return (
    <p className="text-[11px] text-fg-muted" role="status">
      {texto}
    </p>
  );
}

function ImagenAdjunta({ id, label }: { id: string; label: string }) {
  const { url, loading, fallo, resolver } = useSignedUrl(id);

  useEffect(() => {
    void resolver();
    // Una sola resolución por adjunto: `resolver` memoiza sobre `url`, que deja
    // de ser null en cuanto llega.
  }, [resolver]);

  if (fallo) return <Fallo fallo={fallo} />;
  if (loading || !url) return <Cargando texto="Cargando imagen…" />;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element -- URL firmada de
          vigencia corta y host dinámico: no es optimizable por next/image. */}
      <img
        src={url}
        alt={label}
        className="max-h-64 w-auto max-w-full rounded-md border border-stroke-soft"
      />
    </a>
  );
}

function AudioAdjunto({ id }: { id: string }) {
  const { url, loading, fallo, resolver } = useSignedUrl(id);

  if (fallo) return <Fallo fallo={fallo} />;
  if (url) return <AudioPlayer src={url} compact />;
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      disabled={loading}
      onClick={() => void resolver()}
    >
      <Icon name="play" size={13} aria-hidden /> {loading ? "Cargando…" : "Escuchar"}
    </button>
  );
}

function DescargaAdjunta({
  id, label, sizeLabel, unverified,
}: {
  id: string; label: string; sizeLabel: string | null; unverified: boolean;
}) {
  const { url, loading, fallo, resolver } = useSignedUrl(id);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Icon name="paperclip" size={13} className="shrink-0 text-fg-muted" aria-hidden />
        <span className="min-w-0 truncate text-[12px] font-medium text-fg-primary">{label}</span>
        {sizeLabel && <span className="shrink-0 text-[10px] text-fg-muted">{sizeLabel}</span>}
      </div>
      {unverified && (
        <p className="text-[10px] text-fg-muted">
          Sin verificación de contenido: se puede descargar, no se previsualiza.
        </p>
      )}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          download={label}
          className="btn btn-ghost btn-sm"
        >
          <Icon name="download" size={13} aria-hidden /> Abrir
        </a>
      ) : (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={loading}
          onClick={() => void resolver()}
        >
          <Icon name="download" size={13} aria-hidden />{" "}
          {loading ? "Preparando…" : "Descargar"}
        </button>
      )}
      {fallo && <Fallo fallo={fallo} />}
    </div>
  );
}

export function MessageAttachments({ attachments }: { attachments: MessageAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="mt-1.5 space-y-2">
      {attachments.map((a) => {
        const p = presentAttachment(a);
        return (
          <li key={p.id}>
            {p.mode === "image" && <ImagenAdjunta id={p.id} label={p.label} />}
            {p.mode === "audio" && <AudioAdjunto id={p.id} />}
            {p.mode === "download" && (
              <DescargaAdjunta
                id={p.id}
                label={p.label}
                sizeLabel={p.sizeLabel}
                unverified={p.unverified}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
