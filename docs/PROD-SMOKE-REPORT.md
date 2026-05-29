# TOPS NEXUS — PROD SMOKE REPORT (FASE D · read-only)

> **Estado:** ✅ **SMOKE TESTS READ-ONLY EN VERDE** · **Fecha:** 2026-05-29
> Verificación read-only de producción (`arsksytgdnzukbmfgkju`) tras aplicar `0010`+`0011`.
> **Cero escrituras a producción en esta fase.** Todas las consultas son `SELECT`/catálogo.

---

## 0. Confirmación de presencia (requisito FASE D §2)

| Tabla requerida | Presente |
|-----------------|:--------:|
| `documents` | ✅ |
| `documents_audit` | ✅ |
| `customer_invoices` | ✅ |
| `invoice_items` | ✅ |
| `fiscal_config` | ✅ |

(+ `puntos_venta`, `invoice_audit` también presentes.)

---

## 1. Smoke tests read-only

| # | Prueba | Resultado | Veredicto |
|---|--------|-----------|-----------|
| **S1** | Conteo de filas | `documents=0`, `documents_audit=0`, `customer_invoices=0`, `invoice_items=0`, `fiscal_config=1` (singleton default de 0011, SANDBOX) | ✅ tablas nuevas vacías; sin datos espurios |
| **S2** | RLS policies por tabla | documents=4, documents_audit=1, customer_invoices=2, invoice_items=2, fiscal_config=2, puntos_venta=2, invoice_audit=2 | ✅ todas con políticas |
| **S3** | RLS habilitado | `relrowsecurity=true` en las 7 tablas | ✅ |
| **S4** | Triggers de negocio | `trg_documents_audit/guard/version`, `customer_invoices_lock` | ✅ |
| **S5** | Función inmutabilidad fiscal | `tg_lock_authorized_invoice` existe | ✅ |
| **S6** | Helpers RBAC (de 0009) | `current_role`, `has_permission`, `is_staff` presentes | ✅ |
| **S7** | Buckets privados | `documents` (public=false), `invoices` (public=false) | ✅ |
| **S8** | Total tablas `public` | 27 (23 baseline + 4 nuevas de 0010/0011 contadas como base) | ✅ |

---

## 2. Verificación del singleton `fiscal_config`

```
id=1 · razon_social="VEROTIN S.A." · cuit="33-60489698-9"
ambiente=SANDBOX · default_punto_venta=2 · cert_alias=null
```
→ Es el **default sembrado por la migración 0011** (línea 93). `ambiente=SANDBOX` + `cert_alias=null` ⇒
**no habilita emisión productiva**. No es dato fiscal real ni un comprobante.

---

## 3. Lo que NO se hizo (por diseño de FASE D)

- ❌ No se insertó ningún documento, comprobante ni renglón en prod (smoke 100% read-only).
- ❌ No se emitió ninguna factura (ni mock ni real).
- ❌ No se probó escritura RLS con usuarios simulados en prod (eso se validó en GATE 2/staging).
- ❌ No se tocó Tesorería ni Cuentas Corrientes.

> La validación funcional profunda (T1–T8, A1–A8) ya se ejecutó en **staging idéntico** durante GATE 2.
> En producción se limita —deliberadamente— a **confirmar presencia e integridad estructural** sin mutar.

---

## 4. Veredicto Smoke

> **✅ VERDE.** Las 5 tablas requeridas (y 2 adicionales) existen, con RLS activo, políticas, triggers de
> auditoría/guard/versionado e inmutabilidad fiscal, buckets privados y helpers RBAC. La estructura aplicada
> coincide con la validada en GATE 2. Producción quedó **estructuralmente lista** para operación documental,
> sin datos espurios y sin emisión fiscal habilitada.

---

## 5. ¿Acerca a reemplazar Neuralsoft?

**SÍ.** Confirma con evidencia que el schema documental/fiscal está **vivo y sano en producción**, base
necesaria para que los módulos `/documents`, `/billing` y `/settings/fiscal` operen contra datos reales.
