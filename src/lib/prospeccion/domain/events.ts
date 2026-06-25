// Dominio · Domain Events (Parte II §2.1). Inmutables, en pasado, versionados.
// F0 materializa los pasos 1-2: ProspectCreated y ProspectImported. El resto del catálogo
// (enriched/scored/ai_analyzed/approved/crm_sync_*/customer_created + *.failed) llega en F1+.
//
// CONTRATO DE NOMBRE DE EVENTO (reconciliación CR-HIGH #2/#4): el valor canónico del `name` es el
// MISMO slug que la RPC `prospeccion_ingest` persiste en `prospeccion_events.type` y que el Event
// Catalog operativo (32 EVT-11) usa: `prospect.created` / `prospect.imported`. Es la clave de ruteo
// del Dispatcher (F2). Este archivo es el **contrato TS forward** (lo consumirá el Dispatcher en F2);
// se mantiene en sync 1:1 con el `type` del SQL para evitar drift TS↔Outbox.
import type { ProspectId } from "./vo/prospect-id";
import type { SourceSlugValue } from "./vo/source-slug";

export interface DomainEvent<TName extends string, TPayload> {
  readonly eventId: string; // IdGeneratorPort
  readonly name: TName;
  readonly aggregateId: ProspectId;
  readonly occurredAt: string; // ISO, ClockPort
  readonly version: 1;
  readonly payload: Readonly<TPayload>;
}

export type ProspectCreated = DomainEvent<
  "prospect.created",
  { source: SourceSlugValue; shortId?: string | null }
>;

export type ProspectImported = DomainEvent<
  "prospect.imported",
  {
    source: SourceSlugValue;
    isDuplicate: boolean;
    dedupeOf: ProspectId | null;
    status: "imported" | "duplicado";
    email: string | null;
    cuit: string | null;
    linkedinUrl: string | null;
  }
>;

export type ProspeccionDomainEvent = ProspectCreated | ProspectImported;
