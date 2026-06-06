"use server";

/**
 * capture-actions.ts — UX-1 · server action que persiste la captura del artefacto.
 *
 * Recibe el payload crudo de `window.__nexusCapture()`, lo valida (capture-bridge)
 * y lo escribe en crm_quotes(+items) / crm_proposals para la oportunidad.
 * Resiliente: si Supabase no está / la tabla no existe → devuelve {ok:false}.
 * (La app apunta a una base que puede no tener crm_*; la persistencia real se
 * prueba contra staging — ver CRM_CAPTURE_BRIDGE_IMPLEMENTATION.md §evidencia.)
 */

import { createClient } from "@/lib/supabase/server";
import { parseCapture } from "./capture-bridge";

export interface SaveResult {
  ok: boolean;
  message: string;
  publicId?: string;
}

export async function saveCaptureForOpportunity(opportunityId: string, raw: unknown): Promise<SaveResult> {
  const parsed = parseCapture(raw);
  if (!parsed.ok) return { ok: false, message: parsed.reason };

  const supabase = createClient();
  if (!supabase) return { ok: false, message: "Supabase no configurado en este entorno." };

  const p = parsed.payload;
  try {
    if (p.kind === "proposal") {
      const { data, error } = await supabase
        .from("crm_proposals")
        .insert({
          opportunity_id: opportunityId,
          tipo: p.tipo,
          version: 1,
          status: "borrador",
          payload: (p.raw ?? p.fields ?? {}) as object,
        })
        .select("public_id")
        .single();
      if (error) return { ok: false, message: error.message };
      return { ok: true, message: "Propuesta guardada en Nexus.", publicId: data?.public_id ?? undefined };
    }

    // quote → crm_quotes (+ items)
    const { data, error } = await supabase
      .from("crm_quotes")
      .insert({
        opportunity_id: opportunityId,
        service_type: p.serviceType ?? "general",
        tarifario_ref: p.tarifarioRef ?? null,
        subtotal: p.subtotal,
        descuento_total: p.descuentoTotal,
        iva: p.iva,
        total: p.total,
        currency: p.currency,
        status: "borrador",
        payload: (p.raw ?? {}) as object,
      })
      .select("id, public_id")
      .single();
    if (error || !data) return { ok: false, message: error?.message ?? "No se pudo crear la cotización." };

    if (p.items.length > 0) {
      const { error: itErr } = await supabase.from("crm_quote_items").insert(
        p.items.map((it, i) => ({
          quote_id: data.id,
          concepto: it.concepto,
          categoria: it.categoria ?? null,
          cantidad: it.cantidad,
          unidad: it.unidad,
          precio_unit: it.precioUnit,
          importe: it.importe,
          orden: i,
        })),
      );
      if (itErr) return { ok: false, message: `Cotización creada pero ítems fallaron: ${itErr.message}` };
    }
    return { ok: true, message: "Cotización guardada en Nexus.", publicId: data.public_id ?? undefined };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
