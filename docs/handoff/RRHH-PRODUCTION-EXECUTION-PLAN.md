# RRHH-PRODUCTION-EXECUTION-PLAN

**Fecha:** 2026-06-08 · Proyecto productivo: `arsksytgdnzukbmfgkju`.
**Estado:** plan consolidado **previo a ejecución**. **Nada aplicado aún. Cero escritura en prod / Storage.**
Base aprobada: nómina v2. Espera autorización final para ejecutar.

## Baseline actual (PROD · verificado read-only con service role)
| Tabla | Filas hoy |
|---|--:|
| `rrhh_empleados` | **0** |
| `rrhh_empleado_bancario` | **0** |
| `rrhh_documents` | **0** |

→ Dashboard RRHH muestra **Dotación 0 / Activos 0** (correcto sobre tablas vacías).

---

## Secuencia de ejecución (5 pasos)

| Orden | Artefacto | Acción | Escribe |
|:--:|---|---|---|
| 1 | `0061a_rrhh_modalidad_real.sql` | enum `+tiempo_parcial,+director,+periodo_prueba` + columna `es_jubilado` | DDL |
| 2 | `0062_rrhh_carga_inicial.sql` (v2) | INSERT 19 empleados (modalidad real + jubilado) | 19 filas |
| 3 | `0063_rrhh_bancario_carga.sql` | INSERT 16 cuentas (resuelve `empleado_id` por CUIL) | 16 filas |
| 4 | `0064_rrhh_doc_class_recibo.sql` | enum `+recibo_sueldo` | DDL |
| 5 | **CH5-b** `scripts/rrhh-ch5b-ingest-recibos.mjs` | DRY-RUN → `--apply`: split PDF → Storage `rrhh-legajo` → 19 `rrhh_documents` | 19 docs + 19 objetos Storage |

> ⚠️ `0061a` **antes** de `0062` (valores de enum committeados antes de usarse). Triggers append-only ⇒ todo en el INSERT.
> CH5-b se corre primero en DRY-RUN; el `--apply` exige `CH5B_CONFIRM=APLICAR`.

---

## 1) Empleados — cantidad final: **19**

| Concepto | Valor |
|---|--:|
| Total a cargar | **19** |
| Estado inicial | `activo` (19/19) |
| Legajos | 1, 3, 4, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 21, 22, 23, 25, 26, 27 |

## 2) Modalidades (verificado en `0062` v2)
| Modalidad | Cant. | Legajos |
|---|--:|---|
| `tiempo_indeterminado` (completo) | **11** | 1, 3, 6, 7, 8, 9, 10, 11, 14, 15, 23 |
| `tiempo_parcial` | **4** | 16, 21, 22, 25 |
| `director` (LRT) | **2** | 4, 13 |
| `periodo_prueba` | **2** | 26, 27 |
| **Total** | **19** | ✓ |

## 3) Jubilados (condición `es_jubilado`)
| Cant. | Legajo | Nota |
|--:|---|---|
| **1** | 26 (Veliz, Ramon Nestor) | modalidad `periodo_prueba` + `es_jubilado=true` (recibo: "Empleado Jubilado") |

## 4) Cuentas bancarias (verificado en `0063`)
| Banco | Cant. |
|---|--:|
| Banco Galicia y Bs.As. | **15** |
| Banco Santander Río | **1** |
| **Con cuenta** | **16** |
| En efectivo (sin cuenta) | **3** (legajos 25, 26, 27) |
| **Total** | **19** ✓ |

## 5) Documentos — recibos de sueldo (CH5-b)
| Concepto | Valor |
|---|--:|
| Recibos a asociar | **19** (1 por empleado) |
| Páginas PDF procesadas | **34** (15 recibos de 2 pág + 4 de 1 pág) |
| Páginas huérfanas / errores | **0 / 0** (dry-run validado) |
| Clasificación | RRHH → Recibos de sueldo → 2026 → Mayo (`doc_class='recibo_sueldo'`) |
| Bucket / ruta | `rrhh-legajo` · `recibos/2026/05/legajo-NN-<cuil>.pdf` |
| Retención | `recibo_laboral` · hasta 2036-05-01 (10 años) |
| Integridad | `sha256` por archivo (tamper-evidence) |

## Impacto esperado en Dashboard RRHH

| KPI (getDashboardCounts) | Antes | Después |
|---|--:|--:|
| Dotación total | 0 | **19** |
| Activos | 0 | **19** |
| En licencia | 0 | 0 |
| Solicitudes pendientes | 0 | 0 |
| Vacaciones pendientes | 0 | 0 |
| Licencias activas | 0 | 0 |

Otros efectos:
- **Listado de empleados** (`/rrhh/empleados`): 19 legajos.
- **Legajo** (`/rrhh/empleados/[id]`): Datos laborales con **Modalidad** + badge **Jubilado** (legajo 26); sección **Bancario** (16 con cuenta); sección **Recibos de sueldo** (1 c/u tras CH5-b).
- **Centro documental** (`/rrhh/documentos`): 19 documentos clase "Recibo de sueldo".

## Idempotencia y seguridad
- `0062`/`0063`: `on conflict (cuil) do nothing` / `not exists` → re-ejecutables sin duplicar.
- `0061a`/`0064`: `add value if not exists` / `add column if not exists` → idempotentes.
- CH5-b: omite `storage_path` ya existentes; DRY-RUN por defecto; doble confirmación para escribir.
- PII (CUIL, cuentas, recibos): RLS `rrhh.admin`/dueño ya vigente (migraciones 0058/0060); buckets privados (sólo URL firmada + auditada).

## Verificación post-ejecución (sugerida)
```sql
select count(*) from rrhh_empleados;            -- 19
select modalidad_contratacion, count(*) from rrhh_empleados group by 1;  -- 11/4/2/2
select count(*) from rrhh_empleados where es_jubilado;   -- 1
select count(*) from rrhh_empleado_bancario;    -- 16
select count(*) from rrhh_documents where doc_class='recibo_sueldo';  -- 19
```

## Estado de validaciones
| | |
|---|--:|
| `tsc --noEmit` | ✅ EXIT 0 |
| Dry-run CH5-b (offline) | ✅ 19/19 · 34 págs · 0 huérfanas |
| Conteos de migraciones | ✅ 19 / 11-4-2-2 / 1 / 16 |
| Baseline prod | ✅ 0/0/0 (read-only) |
| Escritura productiva | ⛔ NO realizada |

## Autorización requerida
Revisado este plan, tu **"ejecutar"** habilita la secuencia: `0061a → 0062 → 0063 → 0064 → CH5-b (dry-run → apply)`.
Hasta entonces: **cero escritura en producción, cero Storage.** Sin commit/push.
