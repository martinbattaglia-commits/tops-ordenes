# TOPS NEXUS — Runbook de Encendido: Billing / ARCA

> **Objetivo:** dejar `/billing` y `/settings/fiscal` **operativos**, reutilizando el código
> ya construido (migración `0011_arca_billing`, `0013_invoices_storage_isolation`, `src/lib/arca/*`,
> `src/lib/invoicing/*`). **No hay que programar nada nuevo** para el modo SANDBOX.
> **Fecha:** 2026-05-30 · **Autor:** sesión de encendido financiero.

---

## 0. TL;DR

| Tier | Qué logra | Esfuerzo | Requiere certificado |
|------|-----------|----------|----------------------|
| **TIER 1 — SANDBOX operativo** | `/billing` + `/settings/fiscal` encienden; se emiten comprobantes con **CAE simulado** (sin validez fiscal) de punta a punta (incl. PDF + QR) | Bajo: aplicar 2 migraciones idempotentes + verificar | **No** |
| **TIER 2 — Emisión fiscal real** | Comprobantes con **CAE real de ARCA** (homologación → producción) | Alto: credencial + infra + gate ejecutivo | **Sí** (X.509) |

El ERP **ya distingue** los dos modos por `fiscal_config.ambiente`:
`SANDBOX → MockArcaService` (CAE simulado, sin cert) · `HOMOLOGACION/PRODUCCION → ProductionArcaService`
(WSAA + WSFEv1 reales, firma CMS). El seed de `fiscal_config` nace en `SANDBOX`, así que TIER 1 no
toca AFIP en absoluto.

---

## 1. Estado verificado (2026-05-30)

- **Código:** ✅ READY. `ProductionArcaService` implementado y *credential-gated* (veredicto previo
  `docs/ARCA-GO-NOGO.md` = 🟡 GO con condiciones; C1–C7 completos). El firmador CMS por defecto es
  **`forge` (node-forge, puro-JS)** → no requiere binario `openssl` en runtime (mitiga el riesgo C11
  en Netlify Functions).
- **Migraciones `0011` + `0013`:** ⏳ **NO aplicadas** en la DB de producción. El tracker
  `supabase_migrations.schema_migrations` conoce solo `0001`–`0009` (ver
  `docs/ERP-AUDITORIA-SUPABASE-2026-05-29.md`).
- **Degradación actual:** `/billing` y `/settings/fiscal` muestran `<ModuleUnavailable
  migration="0011_arca_billing"/>` (no rompen el shell). Encienden solos al aplicar la migración.
- **Dependencias (verificado leyendo el SQL):** `0011` y `0013` referencian `clients`, `orders`,
  `profiles.client_id`, `auth.users`, `current_role()`, `storage.*` — **todo de `0001`–`0005`**.
  **NO dependen de `0010_documents`** (corrige el comentario "Aplicar DESPUÉS de 0001-0010", que es
  convención de orden, no dependencia: `profiles.client_id` nace en `0001_init` línea 32, no en 0010).
  ⇒ Billing se enciende **sin** aplicar Documents.
- **Idempotencia `0011`/`0013`:** ✅ enums con `exception when duplicate_object`, `create table/index
  if not exists`, `add column if not exists`, `drop policy/trigger if exists`, seeds `on conflict`,
  buckets `on conflict`. Re-ejecutarlas es seguro.

---

## 2. TIER 1 — Encender en SANDBOX (operativo, sin certificado)

### 2.1 Aplicar migraciones (manual, Supabase SQL Editor)

> Regla vigente del proyecto: **NO `supabase db push`** (el tracker está desincronizado; intentaría
> re-correr DDL). Se aplica el SQL a mano en el **SQL Editor** del dashboard.

1. Hacer **backup/snapshot** del proyecto Supabase antes de tocar el esquema (riesgo RP6 abierto).
2. Abrir el SQL Editor y **pegar y ejecutar, en este orden**:
   1. el contenido completo de `supabase/migrations/0011_arca_billing.sql`
   2. el contenido completo de `supabase/migrations/0013_invoices_storage_isolation.sql`
   (ambos terminan en `notify pgrst, 'reload schema';` → refrescan el cache de PostgREST solos).
3. **Registrar en el tracker** para mantener paridad repo↔DB (sin re-correr SQL), desde local con
   `SUPABASE_ACCESS_TOKEN` en `.env.local`:
   ```bash
   supabase migration repair --status applied 0011 0013 --linked < /dev/null
   ```
   (macOS no tiene `timeout`; `< /dev/null` evita que el CLI cuelgue por prompt.)
   Queda un hueco intencional en `0010`/`0012`/`0014` (Documents, RBAC, Facturas-prov) — correcto,
   no se aplican en este runbook.

### 2.2 Pre-requisito de permisos (RLS)

Las policies de `0011` permiten **emitir** solo a `profiles.role ∈ {admin, operaciones}` (RLS basada
en el enum `profiles.role`, no en el RBAC granular que sigue dormido). Verificar que el usuario emisor
(Martín = presidente) tenga `profiles.role = 'admin'`. Si no, ajustarlo en la tabla `profiles` antes de
emitir. (Lectura de comprobantes: `admin/operaciones/supervisor`.)

### 2.3 Verificación de encendido

- [ ] `/settings/fiscal` carga (sin `ModuleUnavailable`) y muestra el seed **VEROTIN S.A.**, CUIT
      `33-60489698-9`, ambiente **SANDBOX**, puntos de venta 2 y 3.
- [ ] `/billing` carga y lista "Pendientes de facturar" (OS en estado `FIRMADA`) + "Comprobantes
      emitidos" (vacío al inicio).
- [ ] **Emitir un piloto SANDBOX**: desde `/billing`, botón *Emitir* sobre un cliente con OS firmadas
      → debe crear un `customer_invoices` en estado `AUTORIZADO_ARCA` con **CAE simulado** y QR.
- [ ] El PDF abre en `/api/invoices/<id>/pdf`.
- [ ] (Opcional) confirmar fila en `invoice_audit` (auditoría append-only).

Al cierre de 2.3, **Billing está encendido** funcionalmente. Los CAE son simulados (sin validez fiscal)
hasta TIER 2.

---

## 3. TIER 2 — Habilitar emisión fiscal REAL (bajo gate ejecutivo)

Reproduce las 5 condiciones de `docs/ARCA-GO-NOGO.md §3`. **Cada una es un gate; ninguna es código.**

1. **Certificado de homologación** de ARCA para CUIT `33-60489698-9` + delegar el WS **wsfe** en el
   portal de ARCA. Luego correr el check de homologación:
   ```bash
   node scripts/arca-homologation-check.mjs   # G4 (login/token/firma) + G5 (lectura) = OK
   ```
2. **Runtime de firma CMS:** mantener `ARCA_CMS_SIGNER=forge` (default) para no depender de `openssl`
   en Netlify Functions. (Cierra C11 sin código adicional.)
3. **Aislamiento R4 en vivo + `0013` en prod:** validar `r4-invoices-isolation-validation.sql`
   (propia=1, fugas=0, cross-tenant=0). `0013` ya se aplica en TIER 1 §2.1 — confirmar enforced.
4. **Entrega del certificado en Netlify (CAVEAT de infraestructura):** el código lee `ARCA_CERT_PATH`
   / `ARCA_KEY_PATH` como **rutas de archivo en el host**. En Netlify Functions (serverless) **no hay
   filesystem persistente con esas rutas**. Opciones: (a) inyectar cert+key como **env vars base64** y
   materializarlas a `/tmp` al arrancar la función, o (b) adaptar el loader de `src/lib/arca/wsaa.ts`
   para leer el contenido directamente de env. **La clave privada NUNCA va al repo ni a la DB.**
   → Esta es la **única adaptación de código potencialmente necesaria** para producción en Netlify;
   evaluar antes del piloto.
5. **Certificado productivo + switch de ambiente + piloto controlado:** setear `ARCA_CUIT` +
   cert/key, cambiar `fiscal_config.ambiente` `SANDBOX → HOMOLOGACION` (probar) → `PRODUCCION` desde
   `/settings/fiscal`, **bajo autorización ejecutiva explícita**, y emitir **un** comprobante piloto;
   verificar CAE + QR contra el visor de ARCA. No saltear el piloto.

**Orden recomendado:** 1 → 2 → 3 → 4 → (revisión) → 5.

---

## 4. Alcance — qué NO toca este runbook

- ❌ No aplica `0010_documents` (Centro Documental) — es ítem separado del roadmap.
- ❌ No aplica `0014_supplier_invoices` (Cuentas por pagar / F3) — ya desplegado en código, migración
  pendiente aparte.
- ❌ No emite comprobantes fiscales reales (eso es TIER 2 bajo gate).
- ❌ No toca RBAC granular (`user_roles` sigue dormido; la RLS de billing usa `profiles.role`).
- ❌ No hace `supabase db push`.

---

## 5. Rollback

- **TIER 1:** las tablas nuevas (`fiscal_config`, `puntos_venta`, `customer_invoices`, `invoice_items`,
  `invoice_audit`) son aditivas; no alteran datos existentes salvo columnas nuevas en `clients`
  (`condicion_iva`, `tipo_doc`, `localidad`) y `orders` (`invoice_id`), todas con default y nullable.
  Revertir el tracker: `supabase migration repair --status reverted 0011 0013 --linked < /dev/null`.
  (Dropear tablas solo si es imprescindible y con backup previo.)
- **TIER 2:** volver `fiscal_config.ambiente` a `SANDBOX` desactiva instantáneamente la emisión real
  (vuelve al Mock). No requiere deploy.
