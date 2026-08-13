# P3-N1B · Plan determinista de backfill de identidad canónica WMS

**Estado: PREPARADO — NO EJECUTADO. La ejecución exige autorización expresa de
Dirección con la fórmula de migración/mutación de datos del canon.**

Generado: 2026-08-13 · Expediente: MANDATO DE REMEDIACIÓN P3-N1B.
Fuente de la auditoría: lectura read-only del proyecto Supabase `arsksytgdnzukbmfgkju`
(producción ERP) realizada el 2026-08-13, sesión WMS-CI → P3-N1B.

## 1. Estado medido (HECHO VERIFICADO, 2026-08-13)

| Tabla | Filas totales | Filas sin `client_id`* | Nombres distintos |
|---|---|---|---|
| `inventory_items` | 3 | 3 | 3 |
| `receptions` | 3 | 3 | 3 |
| `logistics_orders` | 0 | 0 | — |

\* La columna `client_id` aún no existe (0219 sin aplicar): TODA fila histórica
carece de identidad canónica por definición.

`public.clients`: 27 filas canónicas; 0 razones duplicadas; columnas de
evidencia disponibles: `cuit`, `razon`, `activo`.

## 2. Matriz de resolución (fila por fila)

Regla del mandato: una asignación sólo es DETERMINÍSTICA con evidencia estable
(FK, CUIT, referencia contractual, relación documental, id de sistema externo,
decisión administrativa registrada). **Prohibido** asignar por similitud de
nombres, único candidato, heurística o intuición.

| # | Tabla | id (8) | client_name | Referencias | Match exacto razón | Clasificación |
|---|---|---|---|---|---|---|
| 1 | inventory_items | `c0c5b7b7` | `Test  Piloto` | sku 23/3433 | NO | **REQUIERE DECISIÓN DE DIRECCIÓN** |
| 2 | inventory_items | `ff6ae320` | `Avantecno` | sku 009-355 | NO | **REQUIERE DECISIÓN DE DIRECCIÓN** |
| 3 | inventory_items | `ea478b80` | `Logistica tops ` | sku ab015 | NO | **REQUIERE DECISIÓN DE DIRECCIÓN** |
| 4 | receptions | `0dcb674b` | `Test  Piloto` | OC 20261233 · remito 44666698 | NO | **REQUIERE DECISIÓN DE DIRECCIÓN** |
| 5 | receptions | `7677a585` | `Avantecno` | OC 55566777 | NO | **REQUIERE DECISIÓN DE DIRECCIÓN** |
| 6 | receptions | `7a09a850` | `Logistica tops ` | OC 0001 · remito 00003 | NO | **REQUIERE DECISIÓN DE DIRECCIÓN** |

Hechos auxiliares (NO son asignaciones): existen en `clients` 1 razón que
contiene «avantecno», 2 que contienen «tops» y 2 que contienen «test/piloto».
Los números de OC/remito no correlacionan con ninguna tabla documental del
esquema (no hay FK ni registro que los vincule a un cliente).

**Resultado: 0 filas DETERMINÍSTICAS · 6 filas REQUIEREN DECISIÓN DE DIRECCIÓN
· 0 CONFLICTIVAS · 0 NO RESOLUBLES.**

## 3. Tabla de decisión mínima para Dirección

Para cada uno de los TRES nombres, Dirección debe elegir UNA opción:

1. `Test  Piloto` (filas 1 y 4 — datos del piloto 2026-07-14):
   - a) designar `client_id` canónico exacto; o
   - b) declararlas dato de prueba y ordenar su baja administrativa (`active=false`
     no alcanza para 0220: los gates cuentan TODAS las filas); o
   - c) mantener sin resolver (0220 permanece bloqueada).
2. `Avantecno` (filas 2 y 5): ídem a/b/c.
3. `Logistica tops ` (filas 3 y 6 — posible consumo interno TOPS): ídem a/b/c.

## 4. Artefacto ejecutable

`backfill.sql` (en este directorio) es un template transaccional determinista:

- `ON_ERROR_STOP` + transacción única + conteos before/after verificados;
- se completa EXCLUSIVAMENTE con los pares (id → client_id) que Dirección
  designe; el set embebido actual está **VACÍO** — ejecutarlo hoy es un no-op
  que falla explícitamente en el gate de cobertura;
- compensación: los UPDATE registran los ids tocados; revertir = volver esos
  `client_id` a NULL (incluida en el propio script como bloque comentado);
- verificación posterior: reproduce los gates G-1/G-2/G-3 de 0220.

Precondiciones de ejecución: 0219 aplicada · puente publicado · ventana WMS sin
operación · decisión de Dirección registrada en el expediente.

SHA-256 del artefacto: ver `backfill.sql.sha256` (regenerar con
`shasum -a 256 backfill.sql`).

## 5. Prohibiciones vigentes

No inventar valores para lograr cobertura 100 %. Las filas sin decisión quedan
excluidas y **0220 permanece bloqueada** hasta que la cobertura real sea total.
