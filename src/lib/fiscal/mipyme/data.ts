import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/**
 * Accesores read-only del estado MiPyME (config + cliente). Mismo patrón que
 * el resto de data layers: producción = Supabase (RLS), demo = valores seguros.
 * En demo / sin Supabase, la validación queda DESACTIVADA (no bloquea).
 */

function isMock(): boolean {
  return env.app.demoMode || env.app.needsSupabase;
}

export interface MiPyMERuntimeConfig {
  /** Validación FCE activa. */
  activo: boolean;
  /** Monto mínimo para FCE obligatoria. */
  montoMinimo: number;
  /** El emisor está registrado como MiPyME. */
  emisorEsMiPyme: boolean;
}

const CONFIG_OFF: MiPyMERuntimeConfig = { activo: false, montoMinimo: 0, emisorEsMiPyme: false };

/**
 * Lee la configuración de la validación FCE MiPyME (mipyme_config) y el estado
 * MiPyME del emisor (fiscal_config). Degrada a "desactivado" ante cualquier
 * problema, de modo que un fallo de lectura nunca bloquee una emisión.
 */
export async function getMiPyMEConfig(): Promise<MiPyMERuntimeConfig> {
  if (isMock()) return CONFIG_OFF;
  const supabase = createClient();
  if (!supabase) return CONFIG_OFF;
  try {
    const [{ data: cfg }, { data: fc }] = await Promise.all([
      supabase.from("mipyme_config").select("activo, monto_minimo").eq("id", 1).maybeSingle(),
      supabase.from("fiscal_config").select("emisor_es_mipyme").eq("id", 1).maybeSingle(),
    ]);
    return {
      activo: Boolean(cfg?.activo),
      montoMinimo: Number(cfg?.monto_minimo ?? 0),
      emisorEsMiPyme: Boolean(fc?.emisor_es_mipyme),
    };
  } catch {
    return CONFIG_OFF;
  }
}

export interface ClientMiPyMEStatus {
  esMiPyme: boolean;
  categoria: string | null;
}

/** Estado MiPyME del cliente (clients.es_mipyme). null clientId ⇒ no MiPyME. */
export async function getClientMiPyMEStatus(clientId: string | null): Promise<ClientMiPyMEStatus> {
  if (!clientId || isMock()) return { esMiPyme: false, categoria: null };
  const supabase = createClient();
  if (!supabase) return { esMiPyme: false, categoria: null };
  try {
    const { data } = await supabase
      .from("clients")
      .select("es_mipyme, mipyme_categoria")
      .eq("id", clientId)
      .maybeSingle();
    return { esMiPyme: Boolean(data?.es_mipyme), categoria: data?.mipyme_categoria ?? null };
  } catch {
    return { esMiPyme: false, categoria: null };
  }
}
