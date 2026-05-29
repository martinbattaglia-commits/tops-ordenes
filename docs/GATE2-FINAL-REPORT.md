# TOPS NEXUS — GATE 2 · FINAL REPORT (Fase 6)

> **Estado:** veredicto ejecutivo de GATE 2 · **Fecha:** 2026-05-29
> Síntesis de las Fases 1–5 ejecutadas sobre **staging aislado** (`tops-nexus-staging` / `vrxosunxlhohmqymxots`).
> **Producción (`arsksytgdnzukbmfgkju`) intacta — cero comandos mutantes contra prod.**
> Fuentes: [STAGING-SETUP-REPORT](./STAGING-SETUP-REPORT.md) · [GATE2-EVIDENCE-REPORT](./GATE2-EVIDENCE-REPORT.md) ·
> [DOCUMENTS-VALIDATION-REPORT](./DOCUMENTS-VALIDATION-REPORT.md) · [ARCA-SANDBOX-VALIDATION-REPORT](./ARCA-SANDBOX-VALIDATION-REPORT.md) ·
> [RBAC-VALIDATION-REPORT](./RBAC-VALIDATION-REPORT.md).

---

## 0. Veredicto

# ✅ GATE 2 — VERDE (schema/RLS/triggers/storage validados)
# 🟡 Apertura del ERP Financiero — GO CON CONDICIONES

**GATE 2 cumplió su objetivo:** las migraciones `0010` y `0011` aplican limpio en un entorno fiel y aislado,
y **todas** las garantías estructurales del ERP (multi-tenant, auditoría append-only, versionado,
inmutabilidad documental y fiscal) se verificaron **enforced en base de datos** — no asumidas, **ejecutadas**.

**Operar el ERP Financiero** sigue siendo **GO CON CONDICIONES**: el camino está validado y es de bajo riesgo,
pero exige cerrar —en orden y con autorización ejecutiva— los bloqueos *productivos* (C1, ARCA real) y de
*compliance* (R4, G3, G9) que **no son de schema** y por tanto **quedaban fuera del alcance de GATE 2**.

---

## 1. Qué se ejecutó (evidencia real, no asumida)

| Fase | Entregable | Resultado |
|------|-----------|-----------|
| **1 · Provisión** | STAGING-SETUP-REPORT | ✅ Proyecto staging São Paulo, PG 17.6, aislado (V1–V6), prod intacta |
| **2 · GATE 2** | GATE2-EVIDENCE-REPORT | ✅ `0001`→`0011` aplican limpio; batería T1–T8 verde; perf 5 k docs; storage scoping |
| **3 · Documents** | DOCUMENTS-VALIDATION-REPORT | ✅ versionado, auditoría no forjable, soft-delete, bucket privado scoped por path |
| **4 · ARCA Sandbox** | ARCA-SANDBOX-VALIDATION-REPORT | ✅ flujo fiscal A1–A8 (alta→autorización CAE simulado→inmutabilidad→anulación) |
| **5 · RBAC** | RBAC-VALIDATION-REPORT | ✅ SIMPLE activo (50 policies); GRANULAR dormido diagnosticado (G3/G9) |

---

## 2. Garantías no-negociables del charter — verificadas

| Garantía | Mecanismo | Evidencia | Estado |
|----------|-----------|-----------|--------|
| Aislamiento multi-tenant | RLS `current_role()` + scoping por `client_id`/path | T1, T2, storage `split_part` | ✅ |
| Auditoría append-only | trigger `SECURITY DEFINER` + RLS (no forjable) | T3, T4, `documents_audit` | ✅ |
| Versionado íntegro | único `is_current` por grupo (unique) | T6 + test C-1 | ✅ |
| Inmutabilidad documental | trigger `trg_documents_guard` | T7 | ✅ |
| Inmutabilidad fiscal | trigger `tg_lock_authorized_invoice` (8 campos) | T8, A6; anulación A7 | ✅ |

---

## 3. Criterios GO del plan (§4 A1–A10) — todos cumplidos · R1–R9 — ninguno disparado

`A1`–`A10` ✅ (ver GATE2-EVIDENCE-REPORT §5). Ningún criterio de rechazo (`R1`–`R9`) se activó:
no hubo fallos de aplicación, fugas cross-tenant, auditoría forjable ni mutación indebida.

---

## 4. Hallazgos abiertos (no bloquean GATE 2; bloquean *operar* finanzas)

| ID | Hallazgo | Sev. | Bloquea schema GATE 2 | Bloquea operar ERP financiero | Cierre |
|----|----------|------|:---------------------:|:------------------------------:|--------|
| **C1** | En prod `isMock=false` consulta tablas `0010/0011` ausentes | 🔴 | No (GATE 2 valida aplicarlas) | **Sí** | Aplicar `0010/0011` en prod (autorizado) |
| **ARCA-STUB** | `ProductionArcaService=NOT_READY` (sin WSAA/WSFEv1/X.509) | 🔴 | No | **Sí** | Implementar + homologar (post-GATE 2) |
| **R4** | Bucket `invoices` sin scoping por cliente | 🟠 | No | **Sí** (multi-tenant fiscal) | Patrón `documents` (split_part) |
| **G3** | RBAC granular dormido (`user_roles=0`, sin SoD) | 🟠 | No | **Sí** (control interno) | Poblar `user_roles` + cablear `has_permission` |
| **G9** | `rbac_audit` no existe | 🟠 | No | **Sí** (auditoría privilegios) | Crear `rbac_audit` (`0012+`) |
| **AUDIT-DEF** | `invoice_audit` por policy, no trigger SECURITY DEFINER | 🟡 | No | Mejorable | Patrón `documents_audit` |
| **P-1** | Listado documental por Seq Scan (~60 ms @ 5 k) | 🟡 | No | No | Índice parcial en `0012+` |

---

## 5. Ruta crítica al ERP Financiero (orden obligatorio, cada flecha = gate)

```
[✓] GATE 2 VERDE (esta entrega)  ── evidencia completa, riesgo nulo, prod intacta
        │
[1] Autorización ejecutiva  ──►  aplicar 0010 + 0011 en PRODUCCIÓN     (cierra C1)
        │
[2] Implementar ProductionArcaService (WSAA + WSFEv1 + cert X.509 sólo host)
        │     + corregir R4 (scoping bucket invoices)
        ▼
[3] Homologación ARCA (CUIT prueba)  ──►  emitir en HOMOLOGACION OK
        │
[4] Cerrar G3 + G9 (0012: user_roles, has_permission en RLS, rbac_audit)  ──►  SoD auditada
        ▼
[5] Smoke productivo controlado (1er comprobante real mínimo + verificación CAE/QR)
        ▼
      ERP FINANCIERO OPERATIVO
```

> **Punto de no-retorno seguro:** nada después de GATE 2 se ejecuta sin **autorización ejecutiva explícita
> por paso**. Cada flecha hacia producción es un gate independiente.

---

## 6. Decisión sobre Migración 0012 y ERP Financiero

| Pregunta del MASTER PROMPT | Respuesta |
|----------------------------|-----------|
| ¿Producción intacta? | ✅ Sí — cero operaciones mutantes contra `arsksytgdnzukbmfgkju` |
| ¿Staging validado? | ✅ Sí — entorno fiel, aislado, `0010/0011` aplicadas |
| ¿GATE 2 ejecutado? | ✅ Sí — Fases 1–5 con evidencia registrada por paso |
| ¿Evidencia completa? | ✅ Sí — 5 reportes + baterías T1–T8 / A1–A8 / P/S |
| ¿Riesgos actualizados? | ✅ Sí — C1, ARCA-STUB, R4, G3, G9, AUDIT-DEF, P-1 clasificados |
| **¿Habilitar Migración 0012?** | ✅ **SÍ** — el diseño de `0012` es coherente y resuelve G3/G9/AUDIT-DEF/P-1. Recomendado proceder a su **construcción** (no a su aplicación en prod sin gate). |
| **¿Abrir ERP Financiero hoy?** | 🟡 **NO todavía** — requiere cerrar C1 + ARCA real + R4 (pasos [1]–[3]) con autorización ejecutiva. |

---

## 7. Recomendación ejecutiva única

> **Autorizar la aplicación de `0010` + `0011` en PRODUCCIÓN** (paso [1]), dado que GATE 2 verde ya eliminó
> el riesgo de schema y **C1 sólo se cierra aplicándolas**. En paralelo, **iniciar la construcción de `0012`**
> (cierra G3/G9) y la **implementación de `ProductionArcaService` + R4**. La habilitación de emisión fiscal real
> queda condicionada a homologación ARCA exitosa. **No abrir facturación productiva hasta completar [1]–[3].**

---

## 8. Cierre del entorno staging

| Acción recomendada al cerrar GATE 2 | Estado |
|-------------------------------------|--------|
| Conservar staging para construir/validar `0012` | Sugerido (reutilizable) |
| Rotar/borrar `STAGING_DB_PASSWORD` si se descarta el proyecto | Pendiente de decisión |
| Mantener claves de prod en `.env.local` intactas | ✅ Ya garantizado |

---

## 9. ¿Acerca a reemplazar Neuralsoft?

**SÍ — éste es el avance más concreto hasta la fecha.** GATE 2 certifica, con evidencia ejecutada y riesgo nulo,
que la **base documental y fiscal del ERP es estructuralmente sólida y segura**. A partir de aquí, cada paso de
la ruta crítica (§5) es una habilitación real de capacidades que Neuralsoft provee hoy. El proyecto pasa de
**"diseñado y codificado"** a **"validado con evidencia"** — el siguiente movimiento es **ejecutivo**:
autorizar `0010/0011` en producción y habilitar la construcción de `0012`.
