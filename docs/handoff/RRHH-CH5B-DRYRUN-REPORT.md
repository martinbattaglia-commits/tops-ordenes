# RRHH-CH5B-DRYRUN-REPORT

**Fecha:** 2026-06-08 · **Modo: DRY-RUN (offline).** **No se escribió en prod. No se subió a Storage. No se aplicó ninguna migración.**
**Comando ejecutado:**
```
node scripts/rrhh-ch5b-ingest-recibos.mjs "/…/Recibos sueldos 2026 05 (1).PDF" --offline
```
`--offline` resuelve la nómina desde `0062` (no consulta producción). Salida real abajo.

## Resultado del dry-run
```
PDF: …/Recibos sueldos 2026 05 (1).PDF · páginas: 34 · empleados detectados: 19
Modo: DRY-RUN (no escribe)
OFFLINE: nómina resuelta desde 0062 (19 empleados). No se consulta producción.
Resumen: planeados=19 · escritos=0 · omitidos(existían)=0 · sin_empleado=0
DRY-RUN: nada fue escrito.
```

## Evidencia de asociación — PDF ↓ Legajo ↓ Empleado (19/19)

Cada página trae el **CUIL en el encabezado** → agrupamiento determinístico por CUIL consecutivo. Validado contra lectura visual de las 34 páginas.

| Legajo | Empleado | CUIL | Páginas PDF | Recibo Nº | storage_path destino (NO subido) |
|--:|---|---|---|---|---|
| 1 | Reynoso, Juan Carlos | 20-14824517-8 | 1–2 | 1 | recibos/2026/05/legajo-01-20148245178.pdf |
| 3 | Fernandez, Carlos Miguel | 20-18345361-1 | 3–4 | 2 | recibos/2026/05/legajo-03-20183453611.pdf |
| 4 | Fernandez Battaglia, Martin | 20-28032178-9 | 5 | 3 | recibos/2026/05/legajo-04-20280321789.pdf |
| 6 | Martinez, Victor Nicolas | 20-17833256-3 | 6–7 | 4 | recibos/2026/05/legajo-06-20178332563.pdf |
| 7 | Rodriguez Silva, Jose Luis | 23-94837779-9 | 8–9 | 5 | recibos/2026/05/legajo-07-23948377799.pdf |
| 8 | Rodriguez Ayala, Eliezer | 20-94838520-2 | 10–11 | 6 | recibos/2026/05/legajo-08-20948385202.pdf |
| 9 | Serrano Zapata, Jaime Alberto | 20-95021287-0 | 12–13 | 7 | recibos/2026/05/legajo-09-20950212870.pdf |
| 10 | Merino, Jorge Gabriel | 20-24011564-7 | 14 | 8 | recibos/2026/05/legajo-10-20240115647.pdf |
| 11 | Alba, Cynthia Paola | 27-29245752-4 | 15–16 | 9 | recibos/2026/05/legajo-11-27292457524.pdf |
| 13 | Fernandez Calvo, Angel Benito | 20-04416209-2 | 17 | 10 | recibos/2026/05/legajo-13-20044162092.pdf |
| 14 | Silva Nuñez, Manuel Fernando | 20-95555080-4 | 18–19 | 11 | recibos/2026/05/legajo-14-20955550804.pdf |
| 15 | Velazquez, Jose Ezequiel | 20-41969130-6 | 20–21 | 12 | recibos/2026/05/legajo-15-20419691306.pdf |
| 16 | Mendoza, Ricardo Anibal | 23-12644035-9 | 22–23 | 13 | recibos/2026/05/legajo-16-23126440359.pdf |
| 21 | Rodriguez Rodriguez, Silvio Ivan | 27-96182735-9 | 24–25 | 14 | recibos/2026/05/legajo-21-27961827359.pdf |
| 22 | Gonzalez, Valentina Silvia | 27-28311907-1 | 26–27 | 15 | recibos/2026/05/legajo-22-27283119071.pdf |
| 23 | Carrasquero Jimenez, Ruth Ylianis | 27-19102426-0 | 28–29 | 16 | recibos/2026/05/legajo-23-27191024260.pdf |
| 25 | Ojeda, Juan Carlos | 20-17832359-9 | 30–31 | 17 | recibos/2026/05/legajo-25-20178323599.pdf |
| 26 | Veliz, Ramon Nestor | 20-12835097-8 | 32 | 18 | recibos/2026/05/legajo-26-20128350978.pdf |
| 27 | Guadalupe, Alberto Jorge | 20-18072454-1 | 33–34 | 19 | recibos/2026/05/legajo-27-20180724541.pdf |

**Cobertura: 34/34 páginas · 19/19 empleados · 0 páginas huérfanas · 0 CUIL sin empleado.**
- Recibos de **1 página** (directores/único): legajos 4, 10, 13, 26.
- Recibos de **2 páginas**: los otros 15. (15×2 + 4×1 = 34 ✓).

## Cross-validación (triple)
1. **Agrupamiento del script (pdfjs)** → 19 grupos por CUIL.
2. **Lectura visual de las 34 páginas** → mismos rangos exactos.
3. **Resolución contra nómina `0062`** → 19/19 CUIL encontrados, 0 sin empleado.
Los tres coinciden → la asociación PDF→Legajo→Empleado es **correcta para los 19 casos**.

## Qué hará el APPLY (cuando lo autorices, NO ahora)
Por cada empleado: parte las páginas → calcula `sha256` → sube a bucket privado `rrhh-legajo` → inserta `rrhh_documents` (`doc_class='recibo_sueldo'`, `titulo='Recibo de sueldo · Mayo 2026'`, `retention_class='recibo_laboral'`, `retention_until=2036-05-01`). Idempotente (omite `storage_path` existentes). Requiere `0062`/`0064` aplicadas y doble confirmación (`--apply` + `CH5B_CONFIRM=APLICAR`).

## Garantías de este dry-run
| | |
|---|---|
| Escritura en prod | ⛔ ninguna |
| Subida a Storage | ⛔ ninguna |
| Migraciones aplicadas | ⛔ ninguna (0062/0063/0064 pendientes) |
| Consulta a producción | ⛔ ninguna (modo `--offline`, nómina desde 0062) |
| Páginas asociadas | ✅ 34/34 |
| Empleados cubiertos | ✅ 19/19 |
| `escritos` | 0 |

## Próximo paso
Validados **(1) nómina** (`RRHH-19-EMPLOYEES-REVIEW.md`) y **(2) asociación PDF↔empleado** (este reporte), recién entonces avanzamos con: `0062` → `0063` → `0064` → **CH5-b APPLY**.

> Sin commit/push.
