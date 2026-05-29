# TOPS NEXUS — R4 CLOSURE REPORT (FASE E1)

> **Estado:** ✅ **R4 RESUELTO (código + SQL) — validación live en staging PENDIENTE de credenciales** · **Fecha:** 2026-05-29
> Cierre del hallazgo **R4** (bucket `invoices` sin aislamiento multi-tenant) aplicando el patrón
> ya validado para `documents` en GATE 2. Trabajo **aislado** en `feature/arca-production-fase-e`.
> **Sin tocar producción · sin merge a main · sin emitir comprobantes.**

---

## 0. Definición de R4 (recordatorio)

> **R4 (🟠, GATE 2 / ARCA-SANDBOX-VALIDATION):** la policy del bucket `invoices` creada en `0011` era
> `using (bucket_id='invoices' and auth.role()='authenticated')`. Es decir, **cualquier usuario
> autenticado podía leer/escribir cualquier PDF fiscal**, sin scoping por cliente — a diferencia de
> `documents`, que ya usa `split_part(name,'/',1)=client_id` (gold standard, GATE 1C).

---

## 1. Hallazgo confirmado en código (evidencia)

| Fuente | Evidencia |
|--------|-----------|
| `supabase/migrations/0011_arca_billing.sql` (líneas 361-365) | `create policy "invoices bucket internal" … using (bucket_id='invoices' and auth.role()='authenticated')` → **sin** `split_part`/`client_id`. |
| `supabase/migrations/0010_documents.sql` (líneas 380-413) | Patrón correcto: `"documents read scoped"` con `split_part(name,'/',1) = client_id` + write/delete segregados. |
| `src/lib/invoicing/emit.ts` (líneas 352-353) | `pdf_bucket: null, pdf_path: null` **siempre** → hoy **no se persiste ningún PDF** en el bucket. |
| `src/app/api/invoices/[id]/pdf/route.ts` | El PDF se genera **on-demand** desde el comprobante; el bucket `invoices` está **vacío**. |

> **Severidad real:** riesgo **latente**. La policy es insegura, pero como el bucket está vacío y no
> hay ruta cliente-facing que sirva esos blobs todavía, no hay fuga explotable hoy. Cerrarlo **ahora**
> es defensa en profundidad: cuando se materialicen PDFs y se habilite acceso B2B, el aislamiento ya
> estará enforced por construcción.

---

## 2. Remediación entregada

### 2.1 Migración `0013_invoices_storage_isolation.sql` (nueva, aislada)
Replica **exactamente** el predicado validado de `documents`:

| Operación | Policy nueva | Predicado |
|-----------|--------------|-----------|
| SELECT | `invoices read scoped` | internos (`admin/operaciones/supervisor`) ven todo **OR** `split_part(name,'/',1) = profiles.client_id` |
| INSERT | `invoices write internal` | solo internos |
| UPDATE | `invoices update internal` | solo internos |
| DELETE | `invoices delete admin obj` | solo `admin` |

- Elimina la policy permisiva `"invoices bucket internal"` de 0011.
- Reafirma `invoices` como bucket **privado**.
- **Numeración:** se usa `0013` y se deja `0012` **reservada para RBAC** (`MIGRATION-0012-DESIGN-REVIEW`), respetando la restricción "no iniciar 0012".

### 2.2 Convención de path por construcción — `src/lib/invoicing/storage.ts` (nuevo)
`buildInvoicePdfPath()` fuerza el primer segmento = `client_id` (o `_global`):
```
{client_id|'_global'}/{yyyy}/{mm}/{cbteTipo}-{ptoVta}-{nro}-{sha8}.pdf
```
Más `storeInvoicePdf()` (upload privado vía service-role, `upsert:false`) y `getInvoicePdfSignedUrl()`
(signed URL TTL 5 min). Espejo de `lib/documental/storage.ts`. **No** wirea upload automático en `emit.ts`
(no se modifica el flujo de emisión): solo deja el contrato de persistencia aislado listo para el gate
que habilite la materialización de PDFs.

### 2.3 Script de validación — `scripts/r4-invoices-isolation-validation.sql` (nuevo)
Reproduce la batería de storage de GATE 2 (R0–R5): siembra 2 objetos de 2 clientes, simula `auth.uid` +
rol `cliente` y verifica visibilidad. 100% en transacción con `rollback` (no persiste, no emite).

---

## 3. Validación

| Capa | Estado | Detalle |
|------|--------|---------|
| **Equivalencia lógica con patrón validado** | ✅ | El predicado de `invoices read scoped` es **idéntico** (salvo `bucket_id`) al de `documents read scoped`, ya probado **enforced** en GATE 2 (T1 aislamiento, T2 ataque cross-tenant bloqueado). |
| **Sintaxis SQL** | ✅ | DDL estándar (drop/create policy), sin construcciones fuera de transacción; consistente con 0010/0011. |
| **Path isolation por construcción** | ✅ | `buildInvoicePdfPath` garantiza `client_id` como primer segmento — requisito del `split_part`. |
| **Signed URLs** | ✅ | `getInvoicePdfSignedUrl` (TTL 300 s) sobre bucket privado; sin URLs públicas. |
| **Acceso cliente** | ✅ (por diseño) | Cliente solo resuelve su prefijo; staff ve todo; clientes no pueden INSERT/UPDATE/DELETE. |
| **Ejecución live en staging** | ⏳ **PENDIENTE** | `STAGING_DB_URL`/`STAGING_DB_PASSWORD` están **vacíos** en el entorno actual y `SUPABASE_ACCESS_TOKEN` no está seteado → no se pudo correr la simulación viva en esta sesión. Script listo (`scripts/r4-invoices-isolation-validation.sql`). **No se fabricó evidencia de ejecución.** |

> **Honestidad de evidencia (rector "VERIFICAR, no asumir"):** la equivalencia con el patrón ya
> enforced en GATE 2 es la base del cierre lógico; la corrida en vivo queda lista para ejecutarse en
> cuanto se restauren las credenciales de staging (rotadas/limpiadas desde GATE 2).

---

## 4. Aislamiento respetado (restricciones FASE E)

- ❌ No se aplicó nada a producción (`arsksytgdnzukbmfgkju`).
- ❌ No se hizo merge a `main`. Trabajo en `feature/arca-production-fase-e`.
- ❌ No se habilitó `ambiente=PRODUCCION` ni se emitieron comprobantes.
- ❌ No se modificó el **Billing Schema** (tablas) ni el flujo de `emit.ts`.
- ❌ No se tocó la migración `0012` (reservada RBAC).

---

## 5. Estado de R4

> **✅ R4 RESUELTO a nivel código + SQL**, con remediación idéntica al patrón `documents` ya validado
> enforced. **Condición de cierre definitivo:** ejecutar `scripts/r4-invoices-isolation-validation.sql`
> en staging (R2=1 fila propia, R3=0 fugas, R4=0 visibles cross-tenant) y aplicar `0013` en producción
> bajo gate ejecutivo. Hasta entonces: **no exponer PDFs fiscales a clientes B2B** (ya cubierto: el
> bucket está vacío y sin ruta cliente-facing).

---

## 6. ¿Acerca a emitir comprobantes fiscales reales de forma segura y auditada?

**SÍ.** R4 era un pre-requisito de compliance multi-tenant para entregar comprobantes a clientes B2B.
Con el aislamiento del bucket `invoices` resuelto por el mismo patrón gold-standard de `documents`, la
base de almacenamiento fiscal queda lista para operar de forma segura una vez habilitada la emisión real.
