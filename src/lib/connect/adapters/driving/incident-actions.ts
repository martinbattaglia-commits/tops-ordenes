"use server";

// Nexus Link · driving adapter (server actions del Centro de Incidentes, F4.2).
// Patrón canónico (message-actions.ts): createClient→getUser→canAccess→zod→
// use-case(adapter sesión)→revalidatePath→union. El RPC de 0165 re-valida la
// máquina de estados, connect.incident_admin y audita al usuario real.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canAccess } from "@/lib/rbac/guard";
import { createClient } from "@/lib/supabase/server";
import {
  OpenIncidentUseCase, AssignIncidentUseCase, SetIncidentStatusUseCase,
  SetIncidentSeverityUseCase, ResolveIncidentUseCase,
} from "../../application/incident-use-cases";
import { IncidentRpcAdapter } from "../supabase/incident-rpc.adapter";
import type { RpcCapableClient } from "../supabase/connect-rpc.adapter";
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES } from "../../types";

export type SimpleIncidentResult = { ok: true } | { ok: false; message: string };
export type OpenIncidentResult =
  | { ok: true; id: string; publicId: string; conversationId: string }
  | { ok: false; message: string };

type Guarded =
  | { ok: true; client: RpcCapableClient }
  | { ok: false; message: string };

/** Guard común: sesión + permiso (fail-closed; el RPC re-valida todo). */
async function guard(perm: "connect.view" | "connect.create"): Promise<Guarded> {
  const supabase = createClient();
  if (!supabase) {
    return { ok: false, message: "Modo demo: la acción no se persiste (sin Supabase configurado)." };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Sesión no autenticada." };
  if (!(await canAccess(perm))) {
    return { ok: false, message: `Sin permiso para esta acción (${perm}).` };
  }
  return { ok: true, client: supabase as unknown as RpcCapableClient };
}

function revalidateIncidents(incidentId?: string) {
  revalidatePath("/connect/incidentes");
  if (incidentId) revalidatePath(`/connect/incidentes/${incidentId}`);
}

const OpenSchema = z.object({
  titulo: z.string().min(1).max(160), // alineado a MAX_INCIDENT_TITLE y al RPC (M-3)
  severidad: z.enum(INCIDENT_SEVERITIES),
  sector: z.string().max(60).nullable().optional(),
  ubicacion: z.string().max(120).nullable().optional(),
  tipoAveria: z.string().max(80).nullable().optional(),
  descripcion: z.string().max(8000).nullable().optional(),
});

export async function openIncidentAction(raw: unknown): Promise<OpenIncidentResult> {
  const g = await guard("connect.create");
  if (!g.ok) return g;
  const parsed = OpenSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };

  const result = await new OpenIncidentUseCase(new IncidentRpcAdapter(g.client)).execute({
    titulo: parsed.data.titulo,
    severidad: parsed.data.severidad,
    sector: parsed.data.sector ?? null,
    ubicacion: parsed.data.ubicacion ?? null,
    tipoAveria: parsed.data.tipoAveria ?? null,
    descripcion: parsed.data.descripcion ?? null,
  });
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidateIncidents(result.value.id);
  return {
    ok: true,
    id: result.value.id,
    publicId: result.value.publicId,
    conversationId: result.value.conversationId,
  };
}

const AssignSchema = z.object({
  incidentId: z.string().uuid(),
  toProfileId: z.string().uuid(),
});

export async function assignIncidentAction(raw: unknown): Promise<SimpleIncidentResult> {
  const g = await guard("connect.view");
  if (!g.ok) return g;
  const parsed = AssignSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };
  const result = await new AssignIncidentUseCase(new IncidentRpcAdapter(g.client)).execute({
    incidentId: parsed.data.incidentId,
    toProfileId: parsed.data.toProfileId,
  });
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidateIncidents(parsed.data.incidentId);
  return { ok: true };
}

const SetStatusSchema = z.object({
  incidentId: z.string().min(1),
  status: z.enum(INCIDENT_STATUSES),
});

export async function setIncidentStatusAction(raw: unknown): Promise<SimpleIncidentResult> {
  const g = await guard("connect.view");
  if (!g.ok) return g;
  const parsed = SetStatusSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };
  const result = await new SetIncidentStatusUseCase(new IncidentRpcAdapter(g.client)).execute({
    incidentId: parsed.data.incidentId,
    status: parsed.data.status,
  });
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidateIncidents(parsed.data.incidentId);
  return { ok: true };
}

const SetSeveritySchema = z.object({
  incidentId: z.string().min(1),
  severity: z.enum(INCIDENT_SEVERITIES),
});

export async function setIncidentSeverityAction(raw: unknown): Promise<SimpleIncidentResult> {
  const g = await guard("connect.view");
  if (!g.ok) return g;
  const parsed = SetSeveritySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos." };
  const result = await new SetIncidentSeverityUseCase(new IncidentRpcAdapter(g.client)).execute({
    incidentId: parsed.data.incidentId,
    severity: parsed.data.severity,
  });
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidateIncidents(parsed.data.incidentId);
  return { ok: true };
}

const ResolveSchema = z.object({
  incidentId: z.string().min(1),
  resolution: z.string().min(1).max(2000),
});

export async function resolveIncidentAction(raw: unknown): Promise<SimpleIncidentResult> {
  const g = await guard("connect.view");
  if (!g.ok) return g;
  const parsed = ResolveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "Datos inválidos (la resolución es obligatoria)." };
  const result = await new ResolveIncidentUseCase(new IncidentRpcAdapter(g.client)).execute({
    incidentId: parsed.data.incidentId,
    resolution: parsed.data.resolution,
  });
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidateIncidents(parsed.data.incidentId);
  return { ok: true };
}
