# Caja Chica — Informe final de validación E2E (FASE 7)

- **Fecha:** 2026-06-24 (madrugada ART)
- **Rama:** `feat/tesoreria-caja-chica` · **Nada aplicado a producción.**
- **Branch efímero usado:** `caja-chica-e2e` (ref `efewgschhqocrjrrtnbc`) — creado, validado y **eliminado**.

## 1. Resumen ejecutivo
El módulo Caja Chica está **completo y validado end-to-end contra datos reales**, con **reconciliación al peso** (delta $0). El `0082` final (con todos los cambios de F1/F4/F6) re-validó limpio en branch efímero. La sync real escribió las 3 tablas y las vistas devuelven exactamente los KPIs del Excel. Build de producción verde. **Única condición bloqueante para prod: compartir la planilla con el service-account (acción manual de Martín).**

## 2. Métricas clave (datos reales)
| Métrica | Valor |
|---|---|
| Filas parseadas | **164** (35 acreditados + 129 gastos) · 0 corruptos |
| Saldo Excel (celda «SALDO») | **$5.512.186** (`saldo_source: label`) |
| Saldo calculado (Σ) | **$5.512.186** (103.281.117 − 97.768.931) |
| **Delta conciliación** | **$0** · warnings 0 |
| Sync branch | `completed` · rows_inserted **164** · rows_removed 0 |
| Tests | **101 verdes** (6 archivos) |
| Typecheck / Lint / Build | **0 errores / OK / OK** (ruta + página compilan) |

## 3. Checklist A→J
- **A · Pre-flight operativo:** A1 ❌ **planilla NO compartida con el SA** (manual, pendiente Martín) · A2 ⏳ `CAJA_CHICA_DRIVE_FILE_ID` se setea en deploy · A3 ✅ `CRON_SECRET` existe.
- **B · Lógica pura (unit):** ✅ 101 tests (parse 32 · categorize 27 · guards 11 · sync-engine 10 · dashboard-logic 14 · route 7).
- **C · Migración en branch:** ✅ `apply_migration(0082)` OK · 4 tablas · 2 vistas (`security_invoker`) · RPC · RLS (4) · grants (`postgres,service_role`) · advisors cash_box LIMPIOS · `0083` rollback listo (no ejecutado).
- **D · Parse/dryRun real:** ✅ rowsParsed 164 · saldoExcel==saldoCalc · delta 0 · warnings 0 · D4 auth 401 cubierto por route tests.
- **E · Sync real en branch:** ✅ E1 completed 164/164/0removed · E2 idempotencia (RPC DELETE+INSERT; probado en FASE 1 con 2→1 + unit) · E3 sync_log completed · E4 1 snapshot/día/ejercicio · E5 `v_cash_box_resumen` coherente.
- **F · Robustez/negativos:** ✅ guardas (0 filas / caída>40% / corruptos>5% / solapa ausente → **no borra**) + atomicidad — cubierto por 11 tests de guardas + 10 de engine.
- **G · Seguridad/RLS:** ✅ lectura `authenticated` / escritura role-gated · RPC `execute` solo `service_role` · sin secretos en código.
- **H · UI:** ✅ typecheck+lint+build · `/tesoreria/caja-chica` compila · datos validados vía vistas · **render pixel diferido** (el branch no tiene usuarios auth y la RLS es `to authenticated`) → smoke post-deploy.
- **I · Cron:** ✅ `5 0 * * *` = 21:05 ART · `workflow_dispatch` disponible (no disparado en vivo: sin deploy).
- **J · Go/No-Go:** J1 A–I ✅ (A1 pendiente operativo) · J2 typecheck/lint/test/build ✅ · J3 PR → FASE 8 · J4 OK Martín pendiente.

## 4. Hallazgos
1. **Reconciliación perfecta (delta $0)** sobre el archivo real: el parser y el saldo son correctos al peso; el Σ del parser = la fórmula `=C140-F140` de la planilla.
2. **Drift de migraciones confirmado:** una réplica fresca solo reproduce `0001–0011` (`MIGRATIONS_FAILED`). → `0082` a prod debe ir por **SQL Editor**, no por replay.
3. **Cobertura del seed de categorías ≈ 75,6%** (`Otros` ~44% por monto, por reglas faltantes: Visa/Haberes/Obra). No es bug — es configuración, refinable post-deploy vía `cash_box_category_rules`.
4. **Advisors de cash_box limpios.** Persisten advisors **pre-existentes del proyecto** (vistas SECURITY DEFINER ajenas, buckets públicos, funciones anon-ejecutables) → flagueados en task aparte, fuera de alcance.

## 5. Riesgos remanentes
1. 🔴 **Bloqueante operativo:** la planilla **no está compartida con el service-account de Nexus**. Sin eso, el cron en prod daría 403. Mitigación: Martín comparte el `fileId` con el `client_email` del SA (o la mueve bajo el root). *No pude hacerlo: el conector de Drive no expone una tool de compartir.*
2. 🟠 **Captura en vivo del dashboard** no obtenida (el branch no tiene usuarios auth + RLS `to authenticated`). Mitigación: smoke-test visual post-deploy (con un usuario real).
3. 🟡 Política RLS de lectura **temporal** (`using (true)`) → auditoría de seguridad financiera futura (ya documentada).
4. 🟡 Cobertura de categorías mejorable (tabla configurable, post-deploy).

## 6. Recomendación: **GO CONDICIONAL**
El módulo está listo (código completo, 101 tests, build verde, E2E reconciliado al peso). La condición para producción es **operativa, no técnica**. Plan de FASE 8 (deploy), todo con OK explícito de Martín:
1. **Compartir** `Caja chica .xlsx` con el `client_email` del service-account (o moverla bajo el root de Drive). *(Bloqueante #1.)*
2. **Aplicar `0082` a prod** por SQL Editor (validado en branch; el registro está drifteado → no usar replay).
3. **Setear envs en Netlify:** `CAJA_CHICA_DRIVE_FILE_ID` (+ opcional `CAJA_CHICA_PERIODOS`). `CRON_SECRET` ya existe.
4. **Merge / deploy** de `feat/tesoreria-caja-chica` (PR).
5. **Activar** el workflow + setear `APP_URL`/`CRON_SECRET` en GitHub Secrets.
6. **Smoke-test:** `?dry=1` real (debe reconciliar) → abrir el dashboard (captura en vivo) → activar el cron.
