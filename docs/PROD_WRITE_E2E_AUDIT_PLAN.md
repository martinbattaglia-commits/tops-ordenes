# PROD_WRITE_E2E_AUDIT_PLAN — Write E2E sobre entorno productivo

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Autor:** CTO de Release
**Directiva:** consolidar PROD como entorno principal; auditar si el Write E2E puede correr en PROD con el patrón histórico (como WMS). **No modificar PROD hasta aprobar este plan.**

---

## 0. Conclusión ejecutiva

> **Sí, el Write E2E puede correr sobre PROD con el patrón histórico, y NO requiere ninguna credencial nueva.** La app ya apunta a PROD (url+anon+**service-role** presentes) y hay sesión válida. **El único prerequisito es aplicar las migraciones CRM `0041`–`0051` a PROD** — que hoy no están — y eso **es** una modificación de producción (schema + datos de prueba), por lo que va **gateada por autorización + backup**. No es un bloqueo de credenciales; es una decisión de tocar PROD.

---

## 1. ¿Hacen falta credenciales nuevas? — NO (demostrado)

| Dato | Estado real | ¿Falta? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **PROD** (`arsksytgdnzukbmfgkju`) | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | presente | no |
| `SUPABASE_SERVICE_ROLE_KEY` | presente | no |
| `SUPABASE_PROJECT_REF` | PROD | no |
| Sesión de usuario | ya logueado en PROD (browser entró a `/comercial/leads`) | no |

→ Para el **path de navegador** (lo que pide el E2E) **no se necesita nada de staging ni ninguna clave nueva.** Esto invalida el bloqueo "B/C de staging" para el caso PROD.

**Matiz (mecanismo de migración):** no hay connection string de PROD para DDL en el entorno (solo `STAGING_DB_*`), y la `service_role` **no** ejecuta DDL. Aplicar `0041`–`0051` a PROD requiere **una vía de DDL** (ver §5). Eso no es "credencial para el E2E"; es la mecánica del cambio de schema, que de todos modos exige tu autorización.

---

## 2. Tablas afectadas

**Creadas por la migración (0041–0046):**
- 10 tablas `crm_*`: `crm_leads`, `crm_opportunities`, `crm_quotes`, `crm_quote_items`, `crm_proposals`, `crm_contracts`, `crm_onboarding`, `crm_onboarding_tasks`, `crm_stage_history`, `clientify_sync_log`.
- 10 enums `crm_*`, RLS en las 10, vista `profiles_public`.

**Modificadas (additivo):**
- `permissions` + `role_permissions` (0046 inserta `comercial.create/delete/admin` y los mapea a roles). **No** altera tablas existentes de otros módulos.

**Escritas durante el E2E (datos de prueba, persistentes en PROD):**
- `crm_leads` (1 lead de prueba), `crm_opportunities` (1 opp), `crm_stage_history` (transiciones), `crm_onboarding` + `crm_onboarding_tasks` (auto, P0.2), `clientify_sync_log` (evento inbound).
- **Dashboard de vacancia:** el `committed_state` de la opp de prueba se refleja en la **vacancia comercial/proyectada en vivo** (cálculo, no almacenado) hasta limpiar la opp.

---

## 3. Migraciones requeridas

| Migración | Aporta | En PROD hoy |
|---|---|---|
| `0040_profiles_pii_lockdown` | (gap — untracked) | **a confirmar** (no bloquea 0041+; ver nota) |
| `0041`–`0046` | enums + 10 tablas + RLS + `profiles_public` + RBAC seed | ❌ ausentes |
| `0047` | RPC write-path (advance/reserve/complete) | ❌ |
| `0048` | RPC ingest lead | ❌ |
| `0049` | helper comerciales | ❌ |
| `0050` | RPC promote lead | ❌ |
| `0051` | trigger onboarding al ganar (P0.2) | ❌ |

- **Orden estricto** 0041→0051 (cada una depende de la anterior).
- **Evidencia de ausencia:** la UI mostró "fuente: muestra local (sin tabla)" → el `select crm_leads` contra PROD falla con `42P01`.
- **Nota 0040:** `0041`+ no dependen de `0040` (usan `has_permission`/`profiles` ya en PROD). Igual conviene confirmar/cerrar el gap antes (consistencia de secuencia).
- **Validadas en staging:** las 11 corren limpio (≈162 + 9 asserts). Riesgo de fallo de migración: bajo.

---

## 4. Riesgos concretos

| # | Riesgo | Sev. | Mitigación |
|---|---|---|---|
| R1 | **DDL sobre PROD** (crear 10 tablas/enums/funciones/trigger) | 🟠 | Additivo (no altera tablas existentes). Backup fresco antes. Validado en staging. |
| R2 | **Datos de prueba en el CRM productivo** (lead/opp/onboarding falsos) | 🟠 | Marcar como `e2e`, **limpiar al finalizar** (delete cascada). Ventana de baja actividad. |
| R3 | **Dashboard de vacancia en vivo se altera** por el `committed_state` de la opp de prueba | 🟠 | Se restaura al limpiar la opp (es cálculo, no dato fijo). |
| R4 | **0046 modifica RBAC seed** (permissions/role_permissions) | 🟢 | Additivo; son permisos del módulo comercial (deseados en prod). |
| R5 | `profiles_public` creada con `security_invoker` por default → 0 filas a no-admin (R-G3) | 🟢 | Confirmar `security definer` (como en staging). |
| R6 | Webhook crea lead real en PROD vía `crm_ingest_lead` (service role) | 🟢 | Es el flujo previsto; el lead de prueba se limpia. |
| R7 | Usuarios comerciales reales ven el lead/opp de prueba mientras dure | 🟡 | Ventana acordada + cleanup inmediato. |

> **Lectura honesta:** correr el Write E2E en PROD = ejecutar de hecho el **alta del schema CRM en producción** + escribir datos de prueba en la base productiva. Es consecuente; por eso va con backup + cleanup + tu go.

---

## 5. Rollback disponible

| Capa | Rollback |
|---|---|
| **DB completa** | Backup **Supabase→Drive productivo** (sistema ya operativo) → restore total. **Tomar backup fresco antes de migrar.** |
| **Datos de prueba** | Borrar el lead + la opp (cascada → quotes/proposals/onboarding/stage_history; `crm_contracts` es `ON DELETE RESTRICT` pero el E2E no crea contrato) + el evento `clientify_sync_log`. |
| **Schema** | Quedaría en PROD (es el schema CRM previsto). Si se quisiera revertir: teardown `drop` de objetos `crm_*` o restore del backup. |
| **App** | Sin cambios de deploy en este E2E (la app ya corre local→PROD). |

---

## 6. ¿Mismo patrón que módulos anteriores (incl. WMS)? — SÍ

- Todos los módulos productivos (WMS, compras, servicios, documental, CCTV) **tienen sus tablas en PROD** (0001–0040) y se validaron operando contra PROD con el usuario logueado. La app **siempre** corrió contra PROD vía supabase-js.
- El CRM es idéntico salvo que **sus tablas aún no están en PROD**. Aplicar `0041`–`0051` a PROD y luego ejercer por navegador = **exactamente el mismo patrón**.
- Diferencia única: el CRM nació con disciplina staging-first (por eso está validado allí), pero su salida a PROD sigue el patrón histórico.

---

## 7. Veredicto sobre STAGING (sin borrarlo)

- **Valor que aportó:** único entorno donde se validó **no-destructivamente** (tx+ROLLBACK) todo el CRM/Clientify (0041–0051). Cumplió como **dry-run de migraciones**.
- **Fricción actual:** duplica config, exige claves supabase-js propias que no están en el flujo, y confunde la ejecución de E2E de navegador (la app nunca apuntó ahí).
- **Recomendación:** **conservar** staging como **entorno de ensayo de migraciones** (aplicar/validar antes de PROD), pero **no** introducirlo en el loop operativo diario ni bloquear avances por sus credenciales. No es necesario para el Write E2E si se adopta PROD.

---

## 8. Plan de ejecución concreto (gateado — NO ejecutar sin tu go)

> Precondición dura: **autorización explícita + backup PROD fresco**. Ventana de baja actividad recomendada.

| Fase | Paso | Mecanismo | Gate |
|---|---|---|---|
| **G0** | Backup PROD fresco (Supabase→Drive) verificado | sistema de backup productivo | backup verde |
| **G1** | Confirmar/cerrar gap `0040` en PROD | SQL editor / DDL | — |
| **G2** | **Aplicar `0041`–`0051` a PROD en orden** | **SQL Editor de Supabase** (manual) **o** conexión DDL a PROD (si la proveés) **o** Management API SQL runner | sin errores; verificación post (10 tablas + RPCs + trigger) |
| **G3** | Verificar repoint efectivo | abrir `/comercial/leads` → **fuente: Supabase** (no "muestra local") | OK |
| **G4** | Setear `CLIENTIFY_WEBHOOK_SECRET` (token de prueba) en Netlify/local | env | para crear el lead vía webhook |
| **G5** | **Ejecutar E2E de 8 pasos** (navegador, usuario comercial real) | runbook `CRM_WRITE_E2E_RUNBOOK.md §3` | V1–V9 |
| **G6** | Capturar before/after (committed_state + Dashboard) + screenshots | pg/REST + browser | evidencia |
| **G7** | **Cleanup**: borrar lead/opp de prueba (cascada) | SQL | CRM productivo limpio |
| **G8** | Reporte: `E2E_WRITE_TEST_REPORT.md` + PASS/FAIL + GO/NO-GO | — | — |

**Mecanismo de DDL para G2 (a decidir):**
- **(a)** SQL Editor del Dashboard (vos/dev pega las 11 migraciones en orden). Cero credenciales nuevas para mí.
- **(b)** Me proveés una **connection string de PROD** (pooler/direct) y aplico con `pg` + guard de ref invertido (igual patrón que staging). *(Credencial nueva — solo si elegís esta vía; demostrado que sin ella no hay DDL programático.)*
- **(c)** Management API SQL runner con `SUPABASE_ACCESS_TOKEN` (presente) — requiere tu autorización explícita (corre SQL sobre PROD).

---

## 9. Restricciones respetadas en esta entrega

- ✅ No merge · No PR · No deploy · **No modificación de PROD** (solo auditoría + plan).
- ✅ No se asumieron bloqueos (todo verificado).
- ✅ No se pidieron credenciales sin probar: se **demostró** que el path de navegador no necesita ninguna; la única credencial *posible* (conexión DDL a PROD) es opcional (vía (b)) y evitable con la vía (a).

> **Decisión pendiente (tuya):** (1) autorizar aplicar `0041`–`0051` a PROD (con backup), y (2) elegir el mecanismo de DDL (a/b/c). Con eso ejecuto el Write E2E completo sobre PROD siguiendo el flujo histórico.
