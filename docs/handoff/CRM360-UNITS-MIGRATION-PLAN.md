# CRM360-UNITS-MIGRATION-PLAN (E3 · plan de implementación)

**Fecha:** 2026-06-08 · Pasos para que CRM360 lea `crm_units`. **No implementado** (espera aprobación).

## Principio
Cambio de **lectura** (display de disponibilidad) + **selector de reserva**. Sin tocar sync/webhooks/tablas existentes. `crm_units` y `crm_reserve_units` ya están (E1/E2).

## E3.1 — Capa de datos (nuevo accessor, read-only)
`src/lib/comercial/units-data.ts` (cliente de sesión, RLS):
```
getUnitsBySite(site)                  → CrmUnit[]
getUnitCounts(site)                   → {disponible,reservada,ocupada,bloqueada,no_comercializable}
getAvailableUnits(site, category?)    → CrmUnit[] where state='disponible'
getOpportunityUnits(oppId)            → CrmUnit[] where opportunity_id=oppId
```
Tipo `CrmUnit` (espejo de la tabla): id, site, unit_code, name, tipo, category, floor, m2, state, opportunity_id, ocupado_por.
Resiliente: si la tabla no existe (entornos viejos) → []. No rompe la app.

## E3.2 — Capacity Tab (Opportunity360View) lee unidades
- Reemplazar `findAvailability({category, m2})` como fuente de la tab por `getAvailableUnits(site, category)` + `getUnitCounts(site)`.
- Selector de reserva: pasar de **input de texto libre** a **lista de unidades disponibles reales** (checkbox/multiselect de `getAvailableUnits`). `reserveCapacity` recibe los `unit_code` reales.
- Mostrar contadores por los 5 estados (UX plan).
- m² (`o.m2`) sigue visible como **demanda** de la oportunidad, no como disponibilidad.

## E3.3 — Resumen / assigned_units → unidades reales
- En Resumen y en la fila, resolver `getOpportunityUnits(oppId)` → mostrar código + estado real (no sólo el texto de `assigned_units`).

## E3.4 — Backfill de enlaces (oportunidades ya reservadas)
- Las oportunidades con `committed_state in ('reservado','comprometido','ocupado')` y `assigned_units` de **texto libre** (pre-E2) no tienen `crm_units.opportunity_id`.
- Script/migración de conciliación (read-then-write, idempotente): para cada opp reservada, intentar matchear `assigned_units` (texto) contra `crm_units.unit_code`; si matchea → marcar la unidad con el estado/opportunity_id; si no matchea → reportar para revisión manual (no inventar). **No aplicar sin tu OK** (escribe `crm_units`).
- Las 3 reservas actuales de prueba pueden resetearse en vez de migrarse (son test).

## E3.5 — m² como métrica derivada (no romper vacancia)
- `findAvailability` / `getCommittedSnapshot` quedan para el **dashboard-vacancia** (métrica ejecutiva en m²). No se borran en E3.
- (Opcional, futuro) derivar la vacancia desde `crm_units` para unificar — fuera de E3.

## Compatibilidad
- No se tocan: `crm_opportunities` (esquema), Clientify, sync, webhooks, backfill 172, RBAC.
- `assigned_units` jsonb se mantiene (denormalización + compat).
- Cambios = nuevos accessors read-only + UI de la Capacity Tab.

## Orden + validación
`E3.1 (accessors) → E3.2 (Capacity Tab) → E3.3 (assigned_units real) → E3.4 (backfill, con OK) → E3.5 (no-op)`, con `tsc`/`build` PASS y verificación read-only + validación visual por sub-etapa. Sin escritura a prod salvo E3.4 (backfill, autorizado aparte).
