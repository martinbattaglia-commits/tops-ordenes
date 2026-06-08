# RRHH-19-EMPLOYEES-REVIEW-v2

**Fecha:** 2026-06-08 · Fuente: `Recibos sueldos 2026 05 (1).PDF` · Verotin S.A.
**Cambio vs v1:** **modalidad de contratación corregida por empleado** (ya no todos `tiempo_indeterminado`) + condición **jubilado**.
**Nada aplicado. Cero escritura en prod. Cero Storage.** Pendiente tu aprobación final de la nómina.

## Nómina final — 19 empleados (modalidad corregida)

| Legajo | Apellido y nombre | CUIL | Ingreso | Cargo | Categoría | Banco | **Modalidad (corregida)** | Jubilado |
|--:|---|---|---|---|---|---|---|:--:|
| 1 | Reynoso, Juan Carlos | 20-14824517-8 | 01/04/1988 | Encargado de depósito | Maestranza C | Galicia | Tiempo completo indeterminado | — |
| 3 | Fernandez, Carlos Miguel | 20-18345361-1 | 18/03/2004 | Chofer | Conductor cat. 2 | Galicia | Tiempo completo indeterminado | — |
| 4 | Fernandez Battaglia, Martin | 20-28032178-9 | 01/08/2006 | Agente contable | Director | Galicia | **Director (LRT)** | — |
| 6 | Martinez, Victor Nicolas | 20-17833256-3 | 17/05/2010 | Operario 4 | Operario categ. 4 | Galicia | Tiempo completo indeterminado | — |
| 7 | Rodriguez Silva, Jose Luis | 23-94837779-9 | 18/04/2012 | Administ. de ventas | Administ. vtas. cat 3 | Galicia | Tiempo completo indeterminado | — |
| 8 | Rodriguez Ayala, Eliezer | 20-94838520-2 | 01/03/2012 | Chofer | Conductor cat. 2 | Galicia | Tiempo completo indeterminado | — |
| 9 | Serrano Zapata, Jaime Alberto | 20-95021287-0 | 06/12/2012 | Maestranza | Maestranza A | Galicia | Tiempo completo indeterminado | — |
| 10 | Merino, Jorge Gabriel | 20-24011564-7 | 14/04/2015 | Gerente general | Gerencia General | Galicia | Tiempo completo indeterminado | — |
| 11 | Alba, Cynthia Paola | 27-29245752-4 | 10/08/2015 | Administración | Administrativo A | Galicia | Tiempo completo indeterminado | — |
| 13 | Fernandez Calvo, Angel Benito | 20-04416209-2 | 01/07/2017 | Directivo | Director | Santander Río | **Director (LRT)** | — |
| 14 | Silva Nuñez, Manuel Fernando | 20-95555080-4 | 14/05/2018 | Operario 3 | Operario cat 3 | Galicia | Tiempo completo indeterminado | — |
| 15 | Velazquez, Jose Ezequiel | 20-41969130-6 | 16/05/2018 | Chofer | Conductor cat. 2 | Galicia | Tiempo completo indeterminado | — |
| 16 | Mendoza, Ricardo Anibal | 23-12644035-9 | 05/10/2018 | Sereno | Maestranza A | Galicia | **Tiempo parcial** | — |
| 21 | Rodriguez Rodriguez, Silvio Ivan | 27-96182735-9 | 01/04/2022 | Operario 4 | Operario cat 4 | Galicia | **Tiempo parcial** | — |
| 22 | Gonzalez, Valentina Silvia | 27-28311907-1 | 03/10/2022 | Limpieza | Maestranza A | Galicia | **Tiempo parcial** | — |
| 23 | Carrasquero Jimenez, Ruth Ylianis | 27-19102426-0 | 01/02/2023 | Administración | Administrativo A | Galicia | Tiempo completo indeterminado | — |
| 25 | Ojeda, Juan Carlos | 20-17832359-9 | 04/07/2025 | Maestranza | Maestranza A | Efectivo | **Tiempo parcial** | — |
| 26 | Veliz, Ramon Nestor | 20-12835097-8 | 27/09/2025 | Portero | Maestranza A | Efectivo | **Período de prueba** | **Sí** |
| 27 | Guadalupe, Alberto Jorge | 20-18072454-1 | 14/01/2026 | Sereno | Maestranza A | Efectivo | **Período de prueba** | — |

## Resumen por modalidad
| Modalidad | Cant. | Legajos |
|---|--:|---|
| Tiempo completo indeterminado | 11 | 1, 3, 6, 7, 8, 9, 10, 11, 14, 15, 23 |
| Tiempo parcial | 4 | 16, 21, 22, 25 |
| Director (LRT) | 2 | 4, 13 |
| Período de prueba | 2 | 26, 27 |
| **Condición: Jubilado** | 1 | 26 (Veliz) |

## Modelo de datos (cómo se persiste)
- **`modalidad_contratacion`** (enum) ahora distingue las 4 modalidades reales.
- **`es_jubilado`** (booleano nuevo): se modela como **condición ortogonal**, no como modalidad — un jubilado puede ser parcial o completo. Veliz (26): modalidad=`periodo_prueba` + `es_jubilado=true` (el recibo dice "Nuevo Período de Prueba" y obs. "Empleado Jubilado").

## Nota técnica (para tu decisión informada)
Bajo la LCT, "período de prueba" es **una fase** de un contrato a tiempo indeterminado (primeros meses), y "tiempo parcial" es una **modalidad de jornada** (art. 92 ter). Las modelé como valores propios de modalidad **porque pediste verlas explícitas** y así son consultables. Si preferís el criterio LCT estricto (período de prueba → `tiempo_indeterminado`), lo ajusto en 1 línea por legajo.
- Confirmar legajo 26 (Veliz): figura "jubilado" + "período de prueba" simultáneamente → validar con liquidación.

## Artefactos preparados (NO aplicados)
| Archivo | Contenido | Estado |
|---|---|---|
| `supabase/migrations/0061a_rrhh_modalidad_real.sql` | enum `+tiempo_parcial,+director,+periodo_prueba` + columna `es_jubilado` | ✅ listo · no aplicado |
| `supabase/migrations/0062_rrhh_carga_inicial.sql` (v2) | 19 empleados con modalidad real + es_jubilado | ✅ listo · no aplicado |
| `src/lib/rrhh/validation.ts` | enum Zod del alta con las 3 nuevas modalidades | ✅ |
| `src/lib/rrhh/types.ts` | `MODALIDAD_LABEL` + tipo `Empleado` (modalidad, es_jubilado) | ✅ |
| legajo `empleados/[id]` | muestra Modalidad + badge "Jubilado" | ✅ |

**Validado:** `tsc` EXIT 0 · dry-run CH5-b offline sigue 19/19 sobre `0062 v2`.

## Orden de aplicación (cuando autorices)
```
0061a  → enum + columna es_jubilado   (PREREQUISITO de 0062)
0062   → 19 empleados (modalidad real)
0063   → datos bancarios (16)
0064   → clase documental recibo_sueldo
CH5-b  → ingesta de recibos (dry-run → --apply)
```
> ⚠️ `0061a` debe correr **antes** de `0062` (los valores de enum deben estar committeados antes de usarse). El nombre `0061a` ordena correctamente entre `0061` y `0062`.

## Decisión requerida
1. ✅ **Aprobar la nómina final v2** (modalidades + jubilado), **o** pedir el criterio LCT estricto (prueba→indeterminado).
2. Con tu aprobación → autorizás la secuencia `0061a → 0062 → 0063 → 0064 → CH5-b APPLY`.

> Cero escritura en producción. Cero Storage. Sin commit/push.
