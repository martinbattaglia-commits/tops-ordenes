# RRHH-STAGED-EXECUTION-PLAN

**Fecha:** 2026-06-08 · Proyecto: `arsksytgdnzukbmfgkju`.
**Criterio:** ejecución escalonada con **gate de verificación entre fases**. **El asistente NO ejecuta escrituras (ni service-role).** Vos aplicás cada fase (SQL Editor / tu corrida de CH5-b); el asistente verifica **read-only** y entrega evidencia antes de habilitar la siguiente.
**Baseline confirmado hoy:** `rrhh_empleados` = 0 · `rrhh_empleado_bancario` = 0 · `rrhh_documents` = 0.

---

## FASE 1 — Empleados (objetivo: 0 → 19)

### Aplicás vos (SQL Editor, en orden)
```
1) supabase/migrations/0061a_rrhh_modalidad_real.sql   -- enum +tiempo_parcial/+director/+periodo_prueba + columna es_jubilado
2) supabase/migrations/0062_rrhh_carga_inicial.sql     -- INSERT 19 empleados (modalidad real + es_jubilado)
```

### Verificación que corro (read-only) y criterio GO/NO-GO
```sql
select count(*) from rrhh_empleados;                                  -- esperado 19
select modalidad_contratacion, count(*) from rrhh_empleados group by 1 order by 2 desc;
   -- esperado: tiempo_indeterminado 11 · tiempo_parcial 4 · director 2 · periodo_prueba 2
select count(*) from rrhh_empleados where es_jubilado;                 -- esperado 1 (legajo 26)
```
- **Dashboard RRHH:** Dotación **0 → 19**, Activos **0 → 19** (getDashboardCounts cuenta esta tabla).
- **GO** si: 19 empleados, breakdown 11/4/2/2, jubilados 1, Dashboard 19/19.
- **NO-GO** si cualquier conteo difiere → detengo, reporto, no se avanza a Fase 2.

### Entregable Fase 1
`RRHH-PHASE1-EVIDENCE.md` — conteos reales, breakdown, captura del Dashboard (0→19), GO/NO-GO.

> **Gate explícito:** sólo con tu OK sobre la evidencia de Fase 1 se habilita la Fase 2.

---

## FASE 2 — Bancarios + clase documental

### Aplicás vos (SQL Editor, en orden)
```
3) supabase/migrations/0063_rrhh_bancario_carga.sql    -- INSERT 16 cuentas (resuelve empleado_id por CUIL)
4) supabase/migrations/0064_rrhh_doc_class_recibo.sql  -- enum +recibo_sueldo
```

### Verificación read-only / criterio
```sql
select count(*) from rrhh_empleado_bancario;                          -- esperado 16
select banco, count(*) from rrhh_empleado_bancario group by 1;        -- Galicia 15 · Santander 1
-- enum recibo_sueldo disponible (se valida al usarlo en Fase 3)
```
- **GO** si: 16 cuentas (15 Galicia + 1 Santander); 3 empleados sin cuenta (25/26/27, efectivo) — correcto.
- Legajo: la sección Bancario muestra las cuentas (sólo `rrhh.admin`).
- **NO-GO** si cuentas ≠ 16 o algún `empleado_id` quedó sin resolver.

### Entregable Fase 2
`RRHH-PHASE2-EVIDENCE.md` — conteo de cuentas, breakdown por banco, confirmación enum, GO/NO-GO.

> **Gate:** sólo con tu OK se habilita la Fase 3.

---

## FASE 3 — CH5-b: recibos ↔ legajo

### Corrés vos (NO service-role del asistente)
```
# control:
node scripts/rrhh-ch5b-ingest-recibos.mjs "/ruta/Recibos sueldos 2026 05 (1).PDF"            # dry-run
# aplicar:
CH5B_CONFIRM=APLICAR node scripts/rrhh-ch5b-ingest-recibos.mjs "/ruta/recibos.pdf" --apply
```

### Verificación read-only / criterio
```sql
select count(*) from rrhh_documents where doc_class='recibo_sueldo';  -- esperado 19
select e.public_id, count(d.*) docs
  from rrhh_empleados e left join rrhh_documents d
       on d.empleado_id=e.id and d.doc_class='recibo_sueldo'
  group by 1 order by 1;                                              -- 19 legajos, 1 doc c/u
```
- **GO** si: 19 documentos, 1 por legajo, clasificados Recibos→2026→Mayo; 0 legajos sin recibo.
- Legajo: sección "Recibos de sueldo" muestra el recibo descargable (URL firmada).
- **NO-GO** si docs ≠ 19 o algún legajo quedó sin recibo.

### Entregable Fase 3 (cierre)
`RRHH-PRODUCTION-CLOSURE-REPORT.md` — empleados, cuentas, documentos asociados, estado Dashboard RRHH, evidencia final.

---

## Reglas transversales
- **Idempotencia:** todas las migraciones y CH5-b son re-ejecutables sin duplicar (`on conflict` / `not exists` / `if not exists` / unique `storage_path`).
- **Orden estricto:** 0061a antes de 0062 (enum committeado antes de usarse); 0062 antes de 0063 (FK por CUIL); 0064 antes de CH5-b (enum `recibo_sueldo`).
- **Verificación = read-only** (conteos `count=exact`); el asistente no escribe.
- **Detención ante desvío:** cualquier NO-GO frena el escalón y se reporta antes de continuar.

## Estado actual
- ✅ Validación nómina v2 + legajos 26/27 cerrada.
- ⏸️ **Esperando que apliques FASE 1** (0061a + 0062). Avisame cuando corra y verifico + entrego `RRHH-PHASE1-EVIDENCE.md`.
