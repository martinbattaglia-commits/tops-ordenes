# TOPS Nexus — Estado Actual del Proyecto

> Handoff generado 2026-06-02. Información verificada contra repo, migraciones y Supabase (`arsksytgdnzukbmfgkju`). No asume nada no verificable.

## 1. Resumen ejecutivo
TOPS Nexus es el **sistema operativo / ERP vertical** de **Logística TOPS (VEROTIN S.A.)**, en construcción para reemplazar progresivamente a Neuralsoft. Hoy tiene módulos productivos (Cockpit, Compras, Operaciones/Servicios, Workspace, ANMAT, CCTV, Tracking GPS, Billing ARCA) y un bloque nuevo recién construido y validado: **WMS + Digital Twin** (Sprint 1 y Sprint 2). Todo el trabajo nuevo está en **commits locales (no pusheado)**; producción (Netlify) refleja un estado anterior.

## 2. Objetivo del proyecto
ERP logístico integral propio que cubra Compras, Operaciones, Servicios, Comercial/CRM, Compliance ANMAT, Seguridad/CCTV, Tracking de flota y **WMS (depósito de terceros) con gemelo digital**, con auditoría e inmutabilidad como no-negociables.

## 3. Arquitectura general
- **Frontend + backend:** Next.js 14.2.18 (App Router, server components + server actions). Shell único (`Sidebar`/`Topbar`) con dominios colapsables.
- **Base de datos:** Supabase Postgres (proyecto `arsksytgdnzukbmfgkju`) con RLS en todas las tablas, PostgREST para la API, Realtime para tracking.
- **Diseño:** Tailwind + design system propio `nx-*` (alias de `gws-*`) en `globals.css`. Regla de affordance (info=surface, acción=interactive).
- **Deploy:** Netlify (`tops-ordenes.netlify.app`). Dominio objetivo `nexus.logisticatops.com` (pendiente del diseñador).
- **Auth/RBAC:** Supabase Auth + tablas `roles`/`permissions`/`role_permissions`/`user_roles`; función `public.current_role()` (lee `profiles.role`); enum `permission_module_t`.

## 4. Stack tecnológico
Next.js 14 · React · TypeScript · Supabase (Postgres + Auth + RLS + PostgREST + Realtime) · PostGIS (tracking) · Tailwind CSS · Netlify · integraciones: Clientify (CRM), Hikvision (CCTV), Google Workspace, OpenAI (OCR), Resend (email), ARCA (facturación AR), Traccar (GPS), Mapbox (mapa flota).

## 5. Estructura de módulos (dominios del Sidebar)
`Cockpit` (Cockpit ejecutivo, Mapa operativo, **Mapa Inteligente**, Tracking de flota) · `Google Workspace` · `Compras · Proveedores` · `Operaciones · Servicios` · **`WMS · Depósito`** · **`Pedidos · Logística`** · `Comercial · CRM` · `Compliance · ANMAT` · `Seguridad · CCTV` · `Analytics & Finanzas` · `Sistema`.

## 6. Estado general
- **Migraciones:** `0001`→`0027` (el `0012` no existe — gap histórico). Todas aplicadas en `arsksytgdnzukbmfgkju`.
- **Git:** `main` está **20 commits ADELANTE de origin, 0 detrás, SIN pushear**. Últimos hitos: `7aa9e52` (**FASE 9A — Lotes y Vencimientos**), `8108fb2` (Herramientas Comerciales V1), `e1c29c9` (WMS + Digital Twin v1 — BASELINE), `e8959717` (Tracking).
- **Working tree:** WMS Sprint 2 + Grupo C aún sin commitear (ver §10).

### Actualización 2026-06-02 — FASE 9A COMPLETADA Y VALIDADA ✅
- **Commit aislado `7aa9e52`** — `feat(wms): FASE 9A — Lotes y Vencimientos (lectura)` (5 archivos: `lib/wms/types.ts`, `lib/wms/lots.ts`, `wms/lotes/page.tsx`, `wms/vencimientos/page.tsx`, `wms/vencimientos/export/route.ts`).
- **Alcance:** 100% lectura — 0 tablas, 0 migraciones, 0 RPC nuevas; sin tocar stock ni módulos validados.
- **Entregado:** `/wms/lotes` (KPIs, filtros, badge ANMAT, ubicación física) y `/wms/vencimientos` (semáforo ANMAT 5 estados, KPIs incl. Unidades comprometidas, CSV con BOM). Orden FEFO. Modelo canónico `getLotInventory` (FEFO, con `inventory_item_id`/`lot_id`/`position_id`) reutilizable por 9B/Picking/Packing/Despachos sin refactor.
- **Validado:** `tsc`/`eslint` EXIT 0; verificación funcional en preview demo — KPIs (6/2/1/2/1.200 base; 3/2/0/1/1.160 filtrado), FEFO, semáforo, filtros, CSV (`EF BB BF`), responsive, **sin errores de consola/runtime/hidratación**. Caveat: probado con datos demo; query real reutiliza el embed productivo de `listInventory`.
- **Próxima fase recomendada: 9B — Pedidos + Reservas (`stock_allocations`)** (ver `FASE_9_DESIGN.md`).

## 7. Componentes productivos (en commits / aplicados)
Cockpit ejecutivo · Compras y Proveedores (+ OC, facturas proveedor, ARCA billing) · Operaciones/Servicios (OS, clientes) · Google Workspace · ANMAT cockpit · CCTV (Hikvision) · Tracking GPS de flota (PostGIS, commit `e8959717`) · RBAC · Documental/Drive · **WMS v1 + Digital Twin** (commit `e1c29c9`) · **Herramientas Comerciales V1** (commit `8108fb2`: cotizador + propuestas + recorridos).

## 8. Componentes en desarrollo (construidos, SIN commitear)
- **WMS Sprint 2** (Recepciones + Movimientos + ledger): migraciones `0025/0026/0027` (aplicadas en DEV), capa TS (`src/lib/wms/{receptions,movements,data,types}.ts`), UI (`/wms/recepciones`, `/wms/recepciones/nueva`, `/wms/movimientos`) + server actions. **Caso 1 validado** (ver `WMS_HANDOFF.md`). Falta commit.
- Instrumentación temporal de diagnóstico en `src/lib/wms/receptions.ts` (`console.error` del error completo) — **quitar** antes del commit.

## 9. Componentes pendientes
- **Digital Twin v2** (espacios operativos: `facility_space`, business_unit, cubículos clasificados): diseño congelado, **EN ESPERA** del relevamiento de Dirección (matriz maestra). Migración futura `0028_facility_spaces.sql`.
- WMS: Picking, Packing, Despachos, transferencias UI, quarantine flow UI.
- Dashboard Ejecutivo consolidado, CRM/Clientify avanzado, Mapa Inteligente a escala.

## 10. Riesgos conocidos
1. **`main` 19 commits sin pushear** → todo el trabajo nuevo vive solo local (riesgo de pérdida; sin backup remoto).
2. **WMS Sprint 2 sin commitear** (working tree) → no encapsulado en Git.
3. **Grupo C acumulado** (15 modificados sin commitear): `clients/*`, `clientify`, `org`, `globals.css` (a11y), `middleware` (tracking ingest), `compras/pdf`+`email`, `OrderDetailTabs` — parked, sin decisión de commit.
4. **App apunta a `arsksytgdnzukbmfgkju`** (que el baseline llama "prod") usado como DEV → no hay separación clara DEV/PROD.
5. **Migraciones aplicadas a mano** (sin pipeline CI). Orden estricto requerido.
6. Sin UI de traslado de movimientos (Caso 4 solo por RPC).

## 11. Deuda técnica
- Quitar instrumentación temporal en `receptions.ts`.
- Commitear WMS Sprint 2 (commit aislado, post-validación de los 6 casos).
- Decidir destino del Grupo C.
- Pushear/backupear `main`.
- Resolver numeración Twin v2 (`0028`).

## 12. Próximos pasos recomendados
0. **FASE 9B — Pedidos + Reservas (`stock_allocations`)** ← **PRÓXIMA FASE** (diseño en `FASE_9_DESIGN.md`; reserva vía `stock_allocations`, no `stock_reserved` plano). FASE 9A ya cerrada y commiteada (`7aa9e52`).
1. **Completar validación funcional WMS Sprint 2** (Casos 2-6; Caso 1 ya verde; kit en `wms_validation_kit_casos_2-6.sql`).
2. **Commit aislado de WMS Sprint 2** (mismo método: staged → revisión → OK).
3. Decidir push/backup de `main` (riesgo #1).
4. Retomar **Digital Twin v2** cuando llegue la matriz maestra de Dirección.
5. WMS Sprint 3 (Picking/Packing/Despachos) — solo tras consolidar Recepciones+Movimientos.

Ver `WMS_HANDOFF.md`, `NEXT_STEPS.md`, `DEVELOPMENT_RULES.md`, `CHAT_CONTINUATION_PROMPT.md`.
