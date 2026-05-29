# TOPS NEXUS — GO / NO-GO · C1 (FASE D)

> **Estado:** veredicto de cierre del bloqueo **C1** · **Fecha:** 2026-05-29
> ¿Quedó cerrado el riesgo C1 (runtime error por tablas `0010/0011` ausentes en producción)?
> Fuentes: [PROD-MIGRATION-REPORT](./PROD-MIGRATION-REPORT.md) · [PROD-SMOKE-REPORT](./PROD-SMOKE-REPORT.md).

---

## 0. Veredicto

# ✅ GO — C1 CERRADO (a nivel de schema)

Las tablas que el runtime consulta cuando `isMock()=false` (`documents`, `documents_audit`,
`customer_invoices`, `invoice_items`, `fiscal_config`, `puntos_venta`, `invoice_audit`) **ya existen,
registradas y con RLS, en producción**. El error de runtime que C1 describía **ya no puede ocurrir por
ausencia de tablas**.

---

## 1. Definición de C1 (recordatorio)

> **C1:** en producción `isMock()=false` → el código de `/billing` y `/settings/fiscal` consulta tablas de
> `0010/0011`; como no estaban aplicadas, esas consultas **fallaban en runtime**.

---

## 2. Evidencia de cierre

| Condición de C1 | Antes | Ahora | Evidencia |
|-----------------|-------|-------|-----------|
| Tablas `0010/0011` existen en prod | ❌ | ✅ | 7/7 presentes (PROD-SMOKE §0) |
| Migraciones registradas | ❌ | ✅ | `schema_migrations` incluye `0010`,`0011` (PROD-MIGRATION §4.1) |
| RLS activo (no fuga al exponer) | n/a | ✅ | `relrowsecurity=true` en las 7 (S3) |
| Triggers de integridad presentes | n/a | ✅ | audit/guard/version + lock fiscal (S4/S5) |
| `getFiscalConfig/listInvoices/getInvoice` resolverían | ❌ falla | ✅ resuelven (tablas + `fiscal_config` singleton) | S1, §2 |

---

## 3. Qué cierra y qué NO cierra este GO

### ✅ Cierra
- **C1 (schema):** runtime ya no falla por tablas ausentes. `/documents`, `/billing`, `/settings/fiscal` tienen su base de datos.

### ⛔ NO cierra (fuera del alcance de FASE D — siguen abiertos)
| ID | Sigue abierto | Por qué no lo aborda FASE D |
|----|---------------|------------------------------|
| **ARCA-STUB** | `ProductionArcaService=NOT_READY` | FASE D explícitamente NO implementa ARCA productivo |
| **R4** | Bucket `invoices` sin scoping por cliente | No corregido (no se modificó código/policies fuera de 0011) |
| **G3** | RBAC granular dormido (sin SoD) | FASE D NO modifica RBAC |
| **G9** | `rbac_audit` inexistente | FASE D NO inicia 0012 |

> **Importante:** que C1 esté cerrado **no** significa que se pueda **emitir facturación real**. La emisión
> fiscal sigue bloqueada por `ARCA-STUB`. Lo que se habilita es que la app **no rompa** y que la base
> documental/fiscal **opere** (lectura, alta de documentos, persistencia en SANDBOX/mock).

---

## 4. Estado de seguridad operacional

- **Buckets `documents` e `invoices` privados** → sin exposición anónima.
- `documents` con scoping por path (gold standard); ⚠️ `invoices` con **R4 pendiente** → **no exponer PDFs fiscales a clientes B2B** hasta corregir el scoping.
- `fiscal_config` en **SANDBOX**, sin certificado → ninguna vía a emisión productiva accidental.

---

## 5. Recomendación

> **GO confirmado para el cierre de C1.** Producción quedó con la base documental/fiscal aplicada, registrada
> y verificada, sin datos espurios y sin habilitar emisión real. **Próximos gates independientes** (cada uno
> con autorización ejecutiva explícita): corregir **R4**, implementar **ProductionArcaService** + homologación
> ARCA, y construir **0012** (cierra G3/G9). **No abrir facturación productiva** hasta completar ARCA real.

---

## 6. ¿Acerca a reemplazar Neuralsoft?

**SÍ — hito.** C1 era el bloqueo que impedía que el ERP documental/fiscal **viviera en producción sin romper**.
Cerrado con evidencia y riesgo controlado, TOPS Nexus pasa de "validado en staging" a "estructura productiva
operativa". El reemplazo de facturación se completa al habilitar ARCA real sobre esta base ya aplicada.
