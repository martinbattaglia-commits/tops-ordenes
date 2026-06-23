# Caja Chica — Checklist de validación (Go/No-Go antes de prod)

Gate de aceptación. Cada ítem es verificable. **Ningún cambio toca prod hasta que V20 esté en verde con OK explícito de Martín.** Convención: ☐ pendiente · ✅ ok · ❌ bloquea.

## A. Pre-flight (operativo)
- ☐ **A1** Service-account de Nexus tiene acceso de lectura a `Caja chica .xlsx` (compartido o bajo root). Verif.: el dry-run (V5) baja el archivo sin 403/404.
- ☐ **A2** `CAJA_CHICA_DRIVE_FILE_ID` seteado en Netlify y en GitHub Secrets.
- ☐ **A3** `CRON_SECRET` presente (ya existía) y coincide app ↔ GitHub Secret.

## B. Lógica pura (unit, CI local)
- ☐ **B1** `npm test` → 100% verde (parse, categorize, guards).
- ☐ **B2** `parseImporte` corre los 4 formatos (number, US, AR, basura→null).
- ☐ **B3** `parseArgDate` normaliza `dd/mm`+periodo y rechaza `31/02`.
- ☐ **B4** `parseMatrix` separa ACREDITADOS/GASTOS con largos distintos y lee la celda SALDO.
- ☐ **B5** `evaluateGuards` bloquea 0-filas, caída >40% y >5% corruptos.

## C. Migración en branch efímero de Supabase (NO prod)
- ☐ **C1** `create_branch` (rama efímera) — registrar branch id.
- ☐ **C2** `apply_migration(0082)` sin error.
- ☐ **C3** `list_tables` muestra: `cash_box_transactions`, `cash_box_category_rules`, `cash_box_sync_log`, `cash_box_snapshots` + vistas `v_cash_box_movimientos`, `v_cash_box_resumen`.
- ☐ **C4** `execute_sql("select count(*) from cash_box_category_rules")` ≥ 20 (seed cargó).
- ☐ **C5** RPC vacía OK: `select public.cash_box_replace_periodo(2099,'[]'::jsonb, gen_random_uuid())` → `0`.
- ☐ **C6** `get_advisors(security)` sin findings nuevos de RLS sobre las 4 tablas.
- ☐ **C7** `apply_migration(0083)` revierte limpio; `list_tables` ya no las muestra. Luego `delete_branch`.

## D. Sync dry-run contra el archivo real (no escribe)
> Requiere A1–A3 + `0082` aplicada en el entorno de prueba (branch o local).
- ☐ **D1** `curl "$APP_URL/api/tesoreria/caja-chica/sync?dry=1" -H "Authorization: Bearer $CRON_SECRET"` → HTTP 200, `status:"completed"`.
- ☐ **D2** `rows_parsed > 0` y `per_periodo[0].periodo == año configurado`.
- ☐ **D3** **Conciliación:** `per_periodo[0].saldoExcel` == el saldo visible en la planilla (hoy $5.512.186); `saldoDelta` razonable (idealmente 0).
- ☐ **D4** Auth: el mismo curl **sin** header `Authorization` → HTTP 401.

## E. Sync real en branch/staging (escribe en DB de prueba)
- ☐ **E1** Primera corrida real (`?dry=0`): `status:"completed"`, `rows_inserted == rows_parsed`, `rows_removed == 0`.
- ☐ **E2** **Idempotencia:** segunda corrida inmediata → `rows_inserted == 0`, `rows_removed == 0`, `count(*)` por período idéntico (sin duplicados).
- ☐ **E3** `cash_box_sync_log` tiene 2 filas `completed` con `finished_at` y `report` jsonb.
- ☐ **E4** `cash_box_snapshots` tiene **1** fila por período por día (upsert, no duplica).
- ☐ **E5** `v_cash_box_resumen` devuelve `saldo_calculado`, `saldo_excel`, `saldo_delta`, `movimientos` coherentes.

## F. Robustez / negativos (no debe borrar datos)
- ☐ **F1** Apuntar a un fileId/solapa inexistente → período `skipped`/`error`, **datos previos intactos** (count sin cambios).
- ☐ **F2** Simular planilla con la solapa del año vaciada (0 filas) → guarda dispara, `status:"partial"`, **no borra** el set previo.
- ☐ **F3** Atomicidad: la `cash_box_replace_periodo` deja la tabla consistente (nunca medio-borrada) ante error de insert.

## G. Seguridad / RLS
- ☐ **G1** Un usuario `authenticated` sin rol tesorería puede **leer** (select) pero **no escribir** las tablas.
- ☐ **G2** El job escribe con service-role (bypass RLS) — confirmado por E1.
- ☐ **G3** No hay secretos en código ni en los workflows (solo `secrets.*`).

## H. UI
- ☐ **H1** `/tesoreria/caja-chica` renderiza: banner conciliación, 4 KPIs, bar + donut, tabla.
- ☐ **H2** Saldo en **verde** si >0 / **rojo** si ≤0.
- ☐ **H3** Filtros (fecha/categoría), búsqueda y orden funcionan; export CSV y Excel descargan.
- ☐ **H4** Selector de ejercicio cambia el período mostrado (multi-ejercicio).
- ☐ **H5** Sin errores en consola del navegador; responsive desktop/mobile.
- ☐ **H6** Ítem "Caja Chica" aparece en el sidebar de Tesorería y respeta el permiso `finanzas.*`.

## I. Cron
- ☐ **I1** `workflow_dispatch` manual del workflow corre y devuelve 200.
- ☐ **I2** Cron `5 0 * * *` confirmado = 21:05 ART, sin solaparse con compliance/contratos (21:00).

## J. Go/No-Go a producción
- ☐ **J1** A–I en verde.
- ☐ **J2** `npm run typecheck`, `lint`, `test`, `build` verdes.
- ☐ **J3** PR `feat/tesoreria-caja-chica` revisado.
- ☐ **J4** **OK explícito de Martín** para: (a) aplicar `0082` a prod por SQL Editor, (b) setear envs en Netlify, (c) activar el workflow.
- ☐ **V20 — GO:** recién con J1–J4 ✅ se aplica a prod. Rollback listo: `0083` + desactivar workflow + `git revert`.
