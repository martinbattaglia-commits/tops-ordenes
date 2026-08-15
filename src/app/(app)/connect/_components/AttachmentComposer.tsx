"use client";

/**
 * AttachmentComposer — NEXUS LINK · FASE B · adjuntar imágenes, fotos y archivos.
 *
 * ─── POR QUÉ ES UN COMPONENTE APARTE ──────────────────────────────────────
 *
 * `ThreadView` ya carga texto, menciones, dictado, grabación de voz, realtime y
 * estados de burbuja. La cola de adjuntos tiene su propio ciclo de vida —cada
 * archivo sube, se verifica y se envía por separado, y puede fallar solo— y
 * mezclarla ahí adentro habría convertido dos máquinas de estado en una sola,
 * más difícil de razonar que las dos por separado.
 *
 * ─── UN MENSAJE, HASTA CINCO ADJUNTOS ─────────────────────────────────────
 *
 * `client_msg_id` identifica el MENSAJE LÓGICO, no el archivo. Se acuña UNO por
 * lote —al encolar el primer archivo sobre una cola vacía— y lo comparten todos
 * los adjuntos de ese envío. Un archivo agregado mientras la cola sigue viva se
 * suma al mismo mensaje; recién cuando la cola queda vacía se acuña otro.
 *
 * Las tres identidades del envío son distintas y ninguna sustituye a otra:
 *
 *   · MENSAJE  → `client_msg_id`, uno por lote;
 *   · SUBIDA   → el `storage_path`, uno por archivo y elegido por el servidor;
 *   · ADJUNTO  → la fila que crea `finalize`, una por archivo.
 *
 * ─── LA EXCEPCIÓN: EN WHATSAPP, UN LOTE ES VARIOS MENSAJES ────────────────
 *
 * Hallazgo de C4 (2026-08-14): el CAS del envío a Meta (`media-send-core.ts`)
 * reclama por `messageId` — UN wamid por fila de `connect_messages`. Un lote
 * de tres fotos que compartiera `client_msg_id` compartiría ESE messageId, así
 * que el segundo y el tercer archivo perderían el CAS del PRIMERO —"ya hay un
 * envío en curso para este mensaje"— y jamás llegarían a Meta, mientras la UI
 * los pintaba a los tres como enviados. WhatsApp además no tiene "un mensaje
 * con tres adjuntos": Meta envía un `/messages` por cada media item.
 *
 * Por eso, cuando `kind === "whatsapp"`, CADA archivo acuña su PROPIO
 * `client_msg_id` — no hay lote. Cada uno se vuelve su propio mensaje en
 * Connect, con su propia fila, su propio wamid y su propio CAS, reflejando
 * exactamente lo que Meta hace del otro lado. En chat interno nada cambia: el
 * lote sigue siendo un solo mensaje con varios adjuntos, como siempre.
 *
 * ─── REINTENTAR NO PUEDE DUPLICAR ─────────────────────────────────────────
 *
 * El reintento conserva el `client_msg_id` y, si el adjunto ya quedó finalizado
 * en Connect, reutiliza también su `storage_path`: no crea otra subida ni otra
 * fila de adjunto. El servidor adopta el mismo mensaje y el CAS decide si el
 * estado permite una nueva llamada a Meta.
 *
 * ─── LA BARRA DE PROGRESO QUE NO ESTÁ ─────────────────────────────────────
 *
 * `uploadToSignedUrl` no expone avance por bytes. Se podría dibujar una barra
 * animada igual, pero sería una barra que no mide nada: en una conexión de
 * depósito llegaría al 100 % y se quedaría ahí mientras el archivo sigue
 * viajando. En vez de eso se muestra la FASE real —«Subiendo…», luego
 * «Verificando…»— con un indicador indeterminado, que es lo único que podemos
 * afirmar de verdad.
 */

import { useCallback, useRef, useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ConversationKind } from "@/lib/connect/types";
import {
  ACCEPT_ATTR, CLIENT_LIMITS, formatBytes, precheckAttachment, tieneVistaPrevia,
} from "@/lib/connect/attachments/client-precheck";
import {
  prepareAttachmentUploadAction, finalizeAttachmentAction,
} from "@/lib/connect/adapters/driving/attachment-actions";

/** Clip: distinto del micrófono de voz y del micrófono de dictado. */
function ClipIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

/**
 * H2 (FASE B): `incierto` es un estado PROPIO, distinto de `error`. Un envío
 * de WhatsApp `reconciliation_required` significa que el archivo pudo haber
 * salido — tratarlo como error invitaría a reintentar y duplicarlo. Por eso
 * NO entra en el filtro de "pendientes" de `enviarTodo` y no se autodescarta:
 * el operador tiene que verlo y decidir, no perderlo de vista.
 */
type EstadoAdjunto = "encolado" | "subiendo" | "verificando" | "enviado" | "error" | "incierto";

interface EnCola {
  /** Identidad local del ítem en la cola; NO viaja al servidor. */
  key: string;
  file: File;
  estado: EstadoAdjunto;
  error?: string;
  /** ObjectURL de la miniatura; se revoca al descartar el ítem. */
  preview?: string;
  /**
   * SÓLO en WhatsApp: el `client_msg_id` PROPIO de este archivo, acuñado la
   * primera vez que se envía y reutilizado en cada reintento — mismo criterio
   * que `loteActual()` para el lote interno, pero por ítem. `undefined` en
   * chat interno, donde el lote entero comparte uno solo.
   */
  clientMsgIdPropio?: string;
  /**
   * Path ya validado, ligado y visible en Connect. Sólo se conserva cuando el
   * guardado terminó y el egress de WhatsApp falló de forma reintentable.
   */
  finalizedPath?: string;
}

export interface AttachmentComposerProps {
  conversationId: string;
  /**
   * H2 (FASE B): decide si el lote se trata como UN mensaje con varios
   * adjuntos (interno) o como VARIOS mensajes independientes, uno por archivo
   * (WhatsApp) — ver el docblock del archivo. `undefined` se trata como no-WhatsApp.
   */
  kind?: ConversationKind;
  /** Deshabilita la selección mientras el hilo está ocupado con otro envío. */
  disabled?: boolean;
  /** Pie de foto opcional que acompaña al primer archivo. */
  caption?: string;
  /** Se llama cuando un archivo quedó publicado; el mensaje llega por realtime. */
  onSent?: () => void;
}

export function AttachmentComposer({
  conversationId, kind, disabled = false, caption, onSent,
}: AttachmentComposerProps) {
  const esWhatsapp = kind === "whatsapp";
  const [cola, setCola] = useState<EnCola[]>([]);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * Cerrojo inmediato. `estado` es estado de React y no cambia hasta el próximo
   * render: dos clics en el mismo lote leerían ambos «encolado» y dispararían
   * dos envíos del mismo archivo.
   */
  const enVuelo = useRef<Set<string>>(new Set());
  /**
   * Identidad del mensaje lógico en curso. Se acuña al encolar sobre una cola
   * vacía y se descarta cuando la cola vuelve a vaciarse, de modo que el
   * siguiente envío sea un mensaje nuevo y no un adjunto tardío del anterior.
   */
  const loteRef = useRef<string | null>(null);
  const loteActual = useCallback(() => (loteRef.current ??= crypto.randomUUID()), []);

  useEffect(() => {
    if (cola.length === 0) loteRef.current = null;
  }, [cola.length]);

  // Las miniaturas son ObjectURL: si no se revocan, cada archivo elegido deja su
  // blob retenido mientras viva la pestaña.
  useEffect(() => () => {
    for (const i of cola) if (i.preview) URL.revokeObjectURL(i.preview);
    // Sólo al desmontar: el descarte individual revoca en `descartar`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const elegir = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorGeneral(null);
    const nuevos: EnCola[] = [];
    for (const file of Array.from(files)) {
      const v = precheckAttachment(file);
      if (!v.ok) { setErrorGeneral(v.message); continue; }
      nuevos.push({
        key: crypto.randomUUID(),
        file,
        estado: "encolado",
        preview: tieneVistaPrevia(file.name, file.type) ? URL.createObjectURL(file) : undefined,
      });
    }
    setCola((prev) => {
      const libres = Math.max(0, CLIENT_LIMITS.maxFiles - prev.length);
      if (nuevos.length > libres) {
        setErrorGeneral(`Se pueden adjuntar hasta ${CLIENT_LIMITS.maxFiles} archivos por vez.`);
        for (const sobrante of nuevos.slice(libres)) {
          if (sobrante.preview) URL.revokeObjectURL(sobrante.preview);
        }
      }
      return [...prev, ...nuevos.slice(0, libres)];
    });
  }, []);

  const marcar = useCallback((key: string, cambio: Partial<EnCola>) => {
    setCola((prev) => prev.map((i) => (i.key === key ? { ...i, ...cambio } : i)));
  }, []);

  const descartar = useCallback((key: string) => {
    setCola((prev) => {
      const item = prev.find((i) => i.key === key);
      if (item?.preview) URL.revokeObjectURL(item.preview);
      return prev.filter((i) => i.key !== key);
    });
    enVuelo.current.delete(key);
  }, []);

  const enviarUno = useCallback(async (item: EnCola, total: number) => {
    if (enVuelo.current.has(item.key)) return;
    enVuelo.current.add(item.key);
    try {
      let path = item.finalizedPath;
      if (!path) {
        marcar(item.key, { estado: "subiendo", error: undefined });
        const prep = await prepareAttachmentUploadAction({ conversationId });
        if (!prep.ok) { marcar(item.key, { estado: "error", error: prep.message }); return; }

        const sb = createClient();
        if (!sb) { marcar(item.key, { estado: "error", error: "Demo: adjuntos no disponibles." }); return; }
        const { error: upErr } = await sb.storage
          .from("connect-files")
          .uploadToSignedUrl(prep.path, prep.token, item.file, {
            contentType: item.file.type || "application/octet-stream",
          });
        if (upErr) { marcar(item.key, { estado: "error", error: `Subida: ${upErr.message}` }); return; }
        path = prep.path;
      }

      marcar(item.key, { estado: "verificando" });
      // En WhatsApp, ESTE archivo es su propio mensaje (ver docblock del
      // archivo): acuña su client_msg_id la primera vez y lo persiste en la
      // cola para que un reintento lo reutilice, igual que `loteActual()`
      // hace por lote en interno. `item` es una instantánea recibida como
      // parámetro — se actualiza vía `marcar`, nunca por mutación directa.
      let clientMsgId: string;
      if (esWhatsapp) {
        clientMsgId = item.clientMsgIdPropio ?? crypto.randomUUID();
        if (!item.clientMsgIdPropio) marcar(item.key, { clientMsgIdPropio: clientMsgId });
      } else {
        clientMsgId = loteActual();
      }
      const fin = await finalizeAttachmentAction({
        conversationId,
        path,
        fileName: item.file.name,
        // El pie viaja SIEMPRE. El servidor lo usa sólo al crear el mensaje, así
        // que se publica una vez; mandarlo únicamente con el primer archivo
        // perdería el texto si justo ese archivo fallara.
        body: caption ?? null,
        clientMsgId,
        // En WhatsApp cada archivo es 1 de 1 (su propio mensaje); en interno,
        // 1 de N del lote — es lo que `cuerpoDelMensaje` usa para rotular.
        attachmentCount: esWhatsapp ? 1 : total,
      });
      if (!fin.ok) { marcar(item.key, { estado: "error", error: fin.message }); return; }

      // H2 (FASE B): en WhatsApp, `whatsapp` es el desenlace REAL del envío a
      // Meta. `undefined` (chat interno) y `sent` son éxito pleno. Un
      // `already_claimed` sólo informa una carrera: queda visible como error
      // verificable y otro clic vuelve a pasar por el CAS, nunca directo a Meta.
      // `reconciliation_required` NUNCA se reintenta — ver `EstadoAdjunto`.
      if (fin.whatsapp?.state === "reconciliation_required") {
        marcar(item.key, {
          estado: "incierto",
          error: fin.whatsapp.message ?? "El envío no está confirmado. No lo reintentes.",
          finalizedPath: path,
        });
        onSent?.();
        return; // sin autodescarte: el operador tiene que verlo.
      }
      if (fin.whatsapp?.state === "failed" || fin.whatsapp?.state === "already_claimed") {
        marcar(item.key, {
          estado: "error",
          error: fin.whatsapp.message ?? "No se pudo enviar por WhatsApp.",
          finalizedPath: path,
        });
        return;
      }

      marcar(item.key, { estado: "enviado" });
      onSent?.();
      // El mensaje ya llega por realtime; el chip se retira solo.
      setTimeout(() => descartar(item.key), 400);
    } finally {
      enVuelo.current.delete(item.key);
    }
  }, [conversationId, caption, marcar, descartar, onSent, loteActual, esWhatsapp]);

  const enviarTodo = useCallback(async () => {
    const pendientes = cola.filter((i) => i.estado === "encolado" || i.estado === "error");
    for (const item of pendientes) {
      // En serie y no en paralelo: cinco subidas simultáneas por una conexión
      // de depósito se estorban entre sí y ninguna termina antes.
      await enviarUno(item, cola.length);
    }
  }, [cola, enviarUno]);

  const ocupado = cola.some((i) => i.estado === "subiendo" || i.estado === "verificando");
  const hayPendientes = cola.some((i) => i.estado === "encolado" || i.estado === "error");

  return (
    <div className="contents">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        className="hidden"
        onChange={(e) => { elegir(e.target.files); e.target.value = ""; }}
        data-testid="attachment-input"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || ocupado || cola.length >= CLIENT_LIMITS.maxFiles}
        className="focus-nexus grid h-8 w-8 shrink-0 place-items-center rounded-full border border-stroke-soft text-fg-secondary transition-colors hover:border-tops-red hover:text-tops-red disabled:opacity-40"
        title="Adjuntar archivo"
        aria-label="Adjuntar archivo"
      >
        <ClipIcon size={15} />
      </button>

      {(cola.length > 0 || errorGeneral) && (
        <div className="order-last mt-2 w-full basis-full rounded-lg border border-stroke-soft bg-bg-surface px-3 py-2">
          {errorGeneral && (
            <p role="alert" className="mb-2 text-[11px] text-tops-red">{errorGeneral}</p>
          )}
          <ul className="flex flex-col gap-2">
            {cola.map((i) => (
              <li key={i.key} className="flex items-center gap-2">
                {i.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={i.preview}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded bg-bg-page text-[9px] font-semibold uppercase text-fg-muted"
                  >
                    {i.file.name.split(".").pop()?.slice(0, 4)}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-fg-primary">{i.file.name}</span>
                  <span className="block text-[10px] text-fg-muted">
                    {formatBytes(i.file.size)}
                    {i.estado === "subiendo" && " · Subiendo…"}
                    {i.estado === "verificando" && " · Verificando…"}
                    {i.estado === "enviado" && " · Enviado"}
                    {i.estado === "incierto" && " · Sin confirmar"}
                  </span>
                  {i.estado === "error" && (
                    <span role="alert" className="block text-[10px] text-tops-red">{i.error}</span>
                  )}
                  {i.estado === "incierto" && (
                    // Ámbar, no rojo: no es un error para reintentar — es
                    // incertidumbre real que el operador tiene que leer.
                    <span role="status" className="block text-[10px] text-amber-600">{i.error}</span>
                  )}
                </span>
                {(i.estado === "subiendo" || i.estado === "verificando") && (
                  <span
                    role="progressbar"
                    aria-label={`Enviando ${i.file.name}`}
                    className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-bg-page"
                  >
                    <span className="block h-full w-1/3 animate-pulse rounded-full bg-tops-red" />
                  </span>
                )}
                {i.estado === "error" && (
                  <button
                    type="button"
                    onClick={() => void enviarUno(i, cola.length)}
                    className="btn btn-ghost btn-sm shrink-0 text-[11px]"
                  >
                    Reintentar
                  </button>
                )}
                {i.estado !== "subiendo" && i.estado !== "verificando" && (
                  <button
                    type="button"
                    onClick={() => descartar(i.key)}
                    className="focus-nexus shrink-0 rounded px-1 text-[11px] text-fg-muted hover:text-tops-red"
                    aria-label={`Quitar ${i.file.name}`}
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          {hayPendientes && (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => void enviarTodo()}
                disabled={ocupado || disabled}
                className="btn btn-nexus btn-sm text-xs"
              >
                {ocupado ? "Enviando…" : `Enviar ${cola.length === 1 ? "archivo" : "archivos"}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
