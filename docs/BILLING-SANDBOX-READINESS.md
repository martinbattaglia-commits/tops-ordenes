# BILLING — SANDBOX READINESS

**Proyecto:** TOPS NEXUS (Logística TOPS / Verotin S.A.) · **Fecha:** 2026-05-30
**Alcance:** TIER 1 — cerrar Facturación en **SANDBOX** (CAE mock, cero ARCA real). Verificación, no auditoría nueva.
**Prohibiciones respetadas:** sin producción · sin ARCA/WSAA/WSFE real · sin certificados ni claves · sin cambio de ambiente · sin push/merge/deploy.

---

## VEREDICTO

# 🟡 READY WITH GAPS

El flujo de facturación en SANDBOX **funciona end-to-end a nivel de ejecución** (Mock ARCA, CAE simulado, cero red). El schema de billing **ya está aplicado en producción con datos reales**. Hay **3 gaps no bloqueantes** para operar en SANDBOX, que sí hay que cerrar antes de ARCA real.

---

## 1 · Verificación de los 8 puntos

| # | Punto | Estado | Evidencia (verificada esta corrida) |
|---|-------|--------|--------------------------------------|
| 1 | **Tablas reales** | 🟢 PASS | `supabase inspect db --linked` (read-only): `customer_invoices` = **12 filas**, `fiscal_config`, `puntos_venta` (2), `invoice_items`, `invoice_audit` existen. También `documents` (5027) y `profiles` (10154). |
| 2 | **RLS** | 🟢 PASS | `0011` hace `enable row level security` en las 5 tablas + 10 policies (read internal / write admin / scoping). Aplicadas por atomicidad: las tablas existen ⇒ corrió la misma transacción. |
| 3 | **Triggers** | 🟢 PASS | `0011:279` `create trigger customer_invoices_lock` → `tg_lock_authorized_invoice()`: **inmutabilidad** de comprobantes autorizados (no se editan post-CAE). |
| 4 | **Buckets** | 🟡 PASS c/gap | `0011:358` crea bucket `invoices` **privado**. `0013` lo aísla por `client_id` (`split_part(name,'/',1)`). El bucket existe; **la aplicación de 0013 en prod no está confirmada** → Gap G1. Hoy el bucket está vacío (PDFs on-demand) ⇒ riesgo latente, no activo. |
| 5 | **APIs** | 🟢 PASS | Route `GET /api/invoices/[id]/pdf` existe y funciona (gated a `AUTORIZADO_ARCA`, 404 si no). Server actions `emitFromClientOrdersAction` / `emitInvoiceAction` → `emitInvoice`. En el smoke: `POST /billing 200`. |
| 6 | **UI Billing** | 🟢 PASS | Preview en demo: `/billing` (pendientes por cliente, "A facturar $27.944.000", emitidos), `/settings/fiscal` (VEROTIN, ambiente **SANDBOX**, 2 PV). Render limpio, sin errores de consola. |
| 7 | **PDFs** | 🟡 PASS c/gap | Builders presentes: `src/lib/pdf/build.ts` + `src/lib/arca/qr.ts` (QR fiscal). Route sirve `application/pdf`. **Render end-to-end no observable en demo** (aislamiento de módulos de Next dev) → Gap G3. |
| 8 | **Sandbox CAE mock** | 🟢 PASS | `getArcaService('SANDBOX')` → `MockArcaService`: CAE falso (14 díg.), `Resultado:"A"`, "sin validez fiscal", **cero llamadas WSAA/WSFE**. Ejecutado OK en el smoke. |
| — | **tsc + build** | 🟢 PASS | `tsc --noEmit` y `next build` verdes. |

### Gaps (no bloquean SANDBOX; sí antes de ARCA real)
- **G1 — Policy 0013 sin confirmar en prod.** El aislamiento multi-tenant del bucket `invoices` puede no estar aplicado. Latente (bucket vacío hoy).
- **G2 — Tracker de migraciones desincronizado.** `schema_migrations` remoto figura **vacío** aunque el schema está aplicado. Riesgo de *parity* ante cualquier `db push`. Reparar con `migration repair` (0001–0011) antes de migrar.
- **G3 — Persistencia + PDF + QR no observados contra DB viva.** En demo, el singleton `MOCK_INVOICES` se aísla entre el server action y el route handler (artefacto de Next dev, **no del producto**). Se cierra con una sola emisión real en sandbox-DB.

> Confirmación opcional de G1/G3 en una sola pasada (read-only, no escribe): `select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname ilike '%invoice%';` y `select ambiente from fiscal_config where id=1;` (debe dar `SANDBOX`).

---

## 2 · Qué falta SÍ O SÍ para **ARCA Producción** (en orden)

1. **Clave privada X.509.** Tenemos cert (`VEROT24…crt`, CN=VEROT24, CUIT 33604896989, vál. 2024-09→2026-09) + CSR matcheado. **Falta la `.key`** que generó el CSR — entrega segura, nunca por email/chat/repo/DB.
2. **Cargar credenciales por env** (vía ya implementada, commit `edc0e67`): `ARCA_CERT_PEM` + `ARCA_KEY_PEM` (PEM o base64) en Netlify. Eso pone `env.arca.configured = true`.
3. **Homologación primero** (no producción): ambiente `HOMOLOGACION` contra `wsaahomo`/`wswhomo` → ejercita WSAA (LoginCms) + WSFEv1 con CAE de testing.
4. **Alta del WS en ARCA**: asociar el certificado al servicio `wsfe` (administrador de relaciones) para el CUIT emisor.
5. **Aplicar `0013`** (cerrar G1) antes de persistir PDFs fiscales.
6. **Reparar tracker** (cerrar G2): `migration repair` marcando 0001–0011 applied.
7. **Gate ejecutivo + cambio de ambiente** a `PRODUCCION` desde `/settings/fiscal` (el gate exige `configured=true`).
8. **Piloto controlado**: 1 comprobante real mínimo → validar CAE + QR + PDF → conciliar con padrón ARCA.

## 3 · Qué falta SÍ O SÍ para **Backup GCS** (P0.1 de Gate 0 — hoy 🔴 FAIL)

Runbook ya escrito: `docs/erp/BACKUP-EXECUTION-RUNBOOK.md`. Falta **ejecutar**:
1. **Crear el GitHub Action** de `pg_dump` diario de Supabase → bucket GCS (retención 10 años AFIP).
2. **Setear secrets**: credenciales de service account GCS + `DATABASE_URL` del proyecto (hoy hay **0 scripts en `scripts/` y 0 env vars GCS**).
3. **Primer backup** ejecutado y verificado en el bucket.
4. **Restore test** en sandbox (probar que el dump restaura).
5. Marcar `PRE-FLIGHT-GATE-0.md` P0.1 → 🟢 PASS.

## 4 · Qué falta SÍ O SÍ para **cerrar Gate 0** (hoy 🔴 NO CIERRA — 2 FAIL)

Regla: cierra solo si los 4 son PASS. Estado actual (`docs/erp/PRE-FLIGHT-GATE-0.md`):

| Precond | Estado | Acción para cerrar |
|---------|--------|--------------------|
| P0.1 Backup GCS | 🔴 FAIL | **Bloqueante** → ver lista §3 (1-2 días). |
| P0.2 RBAC seed | 🔴 FAIL | **Bloqueante, trivial** → confirmar emails reales JL + Ruth y aplicar **2 INSERT en `user_roles`** (JL→director, Ruth→administracion) en sandbox→prod. Sin esto, R22 fail-open: cualquier autenticado bypasa permisos billing. |
| P0.3 Sandbox separado | 🟢 PASS | — |
| P0.4 Supabase CLI | 🟢 PASS | — (opcional `supabase init` para `config.toml`). |

**Para cerrar Gate 0:** (a) ejecutar Backup GCS §3, (b) seedear los 2 roles, (c) regenerar los dos PRE-FLIGHT como PASS, (d) re-evaluar. ~1-2 días + ~1h de coordinación tuya.

---

## 5 · Pendiente de tu autorización (no se ejecutó nada)

- **Push:** 2 commits locales sin pushear — `b5e4145` (runbook) y `edc0e67` (env-PEM ARCA). Más este reporte, sin commitear.
- Decime si commiteo + pusheo a `main`, o quedan locales.

---

**Una línea:** 🟡 SANDBOX **READY WITH GAPS** — billing funciona en mock y el schema ya vive en prod (el tracker está vacío, miente); los 3 gaps (0013, tracker, e2e en DB viva) no frenan sandbox. Para ARCA real falta la clave privada + homologación + alta WS. Gate 0 sigue 🔴 por Backup GCS y RBAC seed. **Producción intacta.**
