# RRHH-CH5B-RECIBOS-LEGAJO

**Fecha:** 2026-06-08 · **`tsc --noEmit` EXIT 0** · `/rrhh/empleados`, `/rrhh/documentos` → **307**.
**Estado:** preparación CH5-b. **Cero escritura en producción.** `0062`/`0063`/`0064` **pendientes** de tu aplicación. Auditoría CH5 sigue vigente (tabla vacía en prod).

---

## 1) NÓMINA PARA REVISIÓN (gate antes de aplicar 0062/0063)

19 empleados detectados (de los recibos 05/2026 · Verotin S.A.). **Revisá CUIL / cuenta / cargo antes de aplicar.**

| Legajo | Apellido y nombre | CUIL | Ingreso | Categoría | Sección | Cargo | Pago |
|--:|---|---|---|---|---|---|---|
| 1 | Reynoso, Juan Carlos | 20-14824517-8 | 1988-04-01 | Maestranza C | Maestranza | Encargado depósito | Galicia |
| 3 | Fernandez, Carlos Miguel | 20-18345361-1 | 2004-03-18 | Conductor cat.2 | Ing. y Producción | Chofer | Galicia |
| 4 | Fernandez Battaglia, Martin | 20-28032178-9 | 2006-08-01 | Director | Gerencia General | Agente contable | Galicia |
| 6 | Martinez, Victor Nicolas | 20-17833256-3 | 2010-05-17 | Operario cat.4 | Ing. y Producción | Operario 4 | Galicia |
| 7 | Rodriguez Silva, Jose Luis | 23-94837779-9 | 2012-04-18 | Admin. ventas cat.3 | Marketing y Ventas | Admin. de ventas | Galicia |
| 8 | Rodriguez Ayala, Eliezer | 20-94838520-2 | 2012-03-01 | Conductor cat.2 | Ing. y Producción | Chofer | Galicia |
| 9 | Serrano Zapata, Jaime Alberto | 20-95021287-0 | 2012-12-06 | Maestranza A | Maestranza | Maestranza | Galicia |
| 10 | Merino, Jorge Gabriel | 20-24011564-7 | 2015-04-14 | Gerencia General | Gerencia General | Gerente general | Galicia |
| 11 | Alba, Cynthia Paola | 27-29245752-4 | 2015-08-10 | Administrativo A | Administración | Administración | Galicia |
| 13 | Fernandez Calvo, Angel Benito | 20-04416209-2 | 2017-07-01 | Director | Dirección | Directivo | Santander |
| 14 | Silva Nuñez, Manuel Fernando | 20-95555080-4 | 2018-05-14 | Operario cat.3 | Ing. y Producción | Operario 3 | Galicia |
| 15 | Velazquez, Jose Ezequiel | 20-41969130-6 | 2018-05-16 | Conductor cat.2 | Ing. y Producción | Chofer | Galicia |
| 16 | Mendoza, Ricardo Anibal | 23-12644035-9 | 2018-10-05 | Maestranza A | Maestranza | Sereno | Galicia |
| 21 | Rodriguez Rodriguez, Silvio Ivan | 27-96182735-9 | 2022-04-01 | Operario cat.4 | Ing. y Producción | Operario 4 | Galicia |
| 22 | Gonzalez, Valentina Silvia | 27-28311907-1 | 2022-10-03 | Maestranza A | Maestranza | Limpieza | Galicia |
| 23 | Carrasquero Jimenez, Ruth Ylianis | 27-19102426-0 | 2023-02-01 | Administrativo A | Administración | Administración | Galicia |
| 25 | Ojeda, Juan Carlos | 20-17832359-9 | 2025-07-04 | Maestranza A | Maestranza | Maestranza | **Efectivo** |
| 26 | Veliz, Ramon Nestor | 20-12835097-8 | 2025-09-27 | Maestranza A | Maestranza | Portero | **Efectivo** (jubilado) |
| 27 | Guadalupe, Alberto Jorge | 20-18072454-1 | 2026-01-14 | Maestranza A | Maestranza | Sereno | **Efectivo** |

- **16 con cuenta bancaria** (15 Galicia + 1 Santander) → migración `0063`. **3 en efectivo** (25/26/27) → sin cuenta.
- DNI derivado de los 8 dígitos centrales del CUIL. Ingreso = reconocida en los 19. Remuneración **no** se carga (la tabla no modela salario).
- **Acción tuya:** ✅ aprobar esta nómina → recién entonces aplicar `0062` → `0063` → `0064`.

---

## 2) CH5-b — Asociación recibos ↔ legajo (preparado, NO ejecutado)

### Por qué no es un simple SQL
`rrhh_documents` exige **`sha256` (tamper-evidence, NOT NULL)** y el binario vive en **Storage** (bucket privado `rrhh-legajo`, lectura solo por URL firmada). Por eso la asociación requiere un **proceso de ingesta** (split → hash → upload → insert), no un INSERT estático con hash falso.

### Artefactos preparados

| Artefacto | Qué hace | Estado |
|---|---|---|
| `supabase/migrations/0064_rrhh_doc_class_recibo.sql` | Agrega la clase documental `recibo_sueldo` al enum `rrhh_doc_class_t` (idempotente) | ✅ Listo · **no aplicado** |
| `scripts/rrhh-ch5b-ingest-recibos.mjs` | Ingesta: detecta CUIL por página → agrupa → parte el PDF → sube a `rrhh-legajo/recibos/2026/05/legajo-NN-<cuil>.pdf` → inserta `rrhh_documents` (doc_class=`recibo_sueldo`, sha256, retención 10 años) | ✅ Listo · **no ejecutado** |
| `src/lib/rrhh/data.ts` → `getEmpleadoDocumentos(id)` | Accessor read-only (RLS) de documentos por legajo | ✅ Implementado |
| `src/lib/rrhh/types.ts` → `DocClass` + `DOC_CLASS_LABEL` | `recibo_sueldo` + etiquetas legibles | ✅ Implementado |

### Garantías del script de ingesta
- **DRY-RUN por defecto** (no sube ni inserta nada; solo imprime el plan página→legajo).
- Aplica **solo** con `--apply` **y** `CH5B_CONFIRM=APLICAR` (doble confirmación explícita).
- **Idempotente:** omite documentos cuyo `storage_path` ya exista (unique `bucket+path`).
- Requiere `0062`/`0064` aplicadas (resuelve `empleado_id` por CUIL; falla claro si la tabla está vacía).
- Clasificación: **RRHH → Recibos de sueldo → 2026 → Mayo** (vía `doc_class` + `storage_path` jerárquico + `titulo`).

---

## 3) Estado de los 6 frentes pedidos

| # | Frente | Estado | Detalle |
|---|---|---|---|
| 1 | **Legajo digital** | ✅ Preparado en esta entrega | `/rrhh/empleados/[id]` ahora muestra **Recibos de sueldo** + **Documentación** (descarga por URL firmada y auditada). Antes solo tenía Datos laborales / Bancario / Historial. |
| 2 | **Centro documental RRHH** | ✅ Existente + mejora | `/rrhh/documentos` (migración 0060, buckets privados, URL firmada). Se agregó etiqueta legible (`DOC_CLASS_LABEL`) → "Recibo de sueldo" en vez del enum crudo. |
| 3 | **Asociación empleado ↔ recibos** | ✅ Preparado (no ejecutado) | Migración 0064 + script de ingesta + sección en el legajo. Se ejecuta tras aplicar 0062/0063/0064. |
| 4 | **Vacaciones** | ✅ Existente | Modelado como solicitud `tipo=vacaciones` (migración 0059); el dashboard cuenta vacaciones pendientes/aprobadas. |
| 5 | **Solicitudes** | ✅ Existente | Workflow completo `/rrhh/solicitudes` (borrador→pend. supervisor→pend. RRHH→aprobada), aprobaciones L1/L2, rechazo/cancelación/anulación; transiciones validadas en la base. |
| 6 | **Firma digital** | ✅ Existente (aprobación) | Cadena de aprobación supervisor→RRHH (L1/L2) como firma del circuito. Los recibos son PDFs ya firmados por la liquidación y se guardan tal cual (tamper-evidence por `sha256`). |

> Nota: 4/5/6 ya estaban construidos (rondas R1–R6). Hoy muestran 0/ vacío en prod **por la misma causa raíz**: las tablas RRHH no tienen datos (0062/0063 pendientes). Aplicarlas activa toda la cadena.

---

## 4) Orden de ejecución (cuando autorices el write a prod)

```
1. Aplicar  0062_rrhh_carga_inicial.sql     # 19 empleados
2. Aplicar  0063_rrhh_bancario_carga.sql    # 16 cuentas bancarias
3. Aplicar  0064_rrhh_doc_class_recibo.sql  # clase documental recibo_sueldo
4. Ingesta de recibos (DRY-RUN primero):
   node scripts/rrhh-ch5b-ingest-recibos.mjs "/ruta/Recibos sueldos 2026 05.PDF"
   # revisar el plan página→legajo, luego:
   CH5B_CONFIRM=APLICAR node scripts/rrhh-ch5b-ingest-recibos.mjs "/ruta/recibos.pdf" --apply
5. Verificar en /rrhh/empleados/[id] → sección "Recibos de sueldo".
```

## 5) Validaciones de esta entrega
| | Resultado |
|---|---|
| `tsc --noEmit` | ✅ EXIT 0 |
| `/rrhh/empleados`, `/rrhh/documentos` | ✅ 307 (gate de auth → operativas) |
| Legajo muestra Recibos + Documentación | ✅ (vacío hasta ingesta; mensaje guía) |
| Centro documental etiqueta legible | ✅ "Recibo de sueldo" |
| Migración 0064 | ✅ idempotente, no aplicada |
| Script ingesta | ✅ dry-run por defecto, doble confirmación, idempotente, no ejecutado |
| Escritura a prod | ⛔ ninguna (auditoría + 0062/0063/0064 siguen pendientes) |

> Verificación visual real y aplicación de migraciones/ingesta quedan de tu lado. Sin commit/push.
