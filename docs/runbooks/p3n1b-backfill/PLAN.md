# P3-N1B · Auditoría de identidad canónica WMS y plan de resolución

**Estado: AUDITORÍA COMPLETADA — SIN BACKFILL EJECUTABLE EN ESTE ÁRBOL.**

**No existe actualmente ningún artefacto de backfill ejecutable.** El backfill
será un **candidato separado de mutación de datos**, que sólo se construirá
después de que Dirección resuelva las identidades pendientes (§3), y deberá
cumplir: asignaciones completas y exactas designadas por Dirección; cobertura
incompleta = `EXCEPTION` con `ROLLBACK` (nunca éxito parcial); rollback
ejecutable con ids explícitos; rollback probado en un entorno representativo;
hashes y evidencia; y el Guardián de la clase que Dirección determine para
scripts DML.

Generado: 2026-08-13 · rectificado por orden de Dirección (retiro del SQL
ejecutable del changeset del puente). Expediente: MANDATO DE REMEDIACIÓN
P3-N1B. Fuente: lectura read-only del proyecto Supabase `arsksytgdnzukbmfgkju`
(producción ERP), 2026-08-13.

## 1. Estado medido (HECHO VERIFICADO, 2026-08-13)

| Tabla | Filas totales | Filas sin `client_id`* | Nombres distintos |
|---|---|---|---|
| `inventory_items` | 3 | 3 | 3 |
| `receptions` | 3 | 3 | 3 |
| `logistics_orders` | 0 | 0 | — |

\* La columna `client_id` aún no existe (0219 sin aplicar): toda fila histórica
carece de identidad canónica por definición.

`public.clients`: 27 filas canónicas; 0 razones duplicadas; columnas de
evidencia disponibles: `cuit`, `razon`, `activo`.

## 2. Matriz de resolución (fila por fila)

Regla del mandato: una asignación sólo es DETERMINÍSTICA con evidencia estable
(FK, CUIT, referencia contractual, relación documental, id de sistema externo,
decisión administrativa registrada). **Prohibido** asignar por similitud de
nombres, único candidato, heurística o intuición.

| # | Tabla | id | client_name | Referencias | Match exacto razón | Clasificación |
|---|---|---|---|---|---|---|
| 1 | inventory_items | `c0c5b7b7-27be-4cdd-8031-c07087a34fc7` | `Test  Piloto` | sku 23/3433 | NO | **REQUIERE DECISIÓN DE DIRECCIÓN** |
| 2 | inventory_items | `ff6ae320-c829-4958-a744-df49da4e6842` | `Avantecno` | sku 009-355 | NO | **REQUIERE DECISIÓN DE DIRECCIÓN** |
| 3 | inventory_items | `ea478b80-e80b-420b-ba45-1aa704fc352d` | `Logistica tops ` | sku ab015 | NO | **REQUIERE DECISIÓN DE DIRECCIÓN** |
| 4 | receptions | `0dcb674b-e91c-4eb0-9848-029e332c6d27` | `Test  Piloto` | OC 20261233 · remito 44666698 | NO | **REQUIERE DECISIÓN DE DIRECCIÓN** |
| 5 | receptions | `7677a585-c7a2-47cf-adb6-335cb3b7fee4` | `Avantecno` | OC 55566777 | NO | **REQUIERE DECISIÓN DE DIRECCIÓN** |
| 6 | receptions | `7a09a850-8e21-47aa-bdde-a71561a054d8` | `Logistica tops ` | OC 0001 · remito 00003 | NO | **REQUIERE DECISIÓN DE DIRECCIÓN** |

**Resultado: 0 filas DETERMINÍSTICAS · 6 REQUIEREN DECISIÓN DE DIRECCIÓN ·
0 CONFLICTIVAS · 0 NO RESOLUBLES.**

## 3. Decisiones pendientes de Dirección

Efecto sobre 0220 (común a las tres): sus gates G-1/G-2/G-3 cuentan **todas**
las filas con `client_id NULL` — `active=false` no exime; sólo la asignación o
la baja física documentada despejan los gates.

1. **`Test  Piloto`** (filas 1 y 4): a) asignar `client_id` designado; b) baja
   física como dato de prueba; c) no resolver (0220 bloqueada). Candidatos
   canónicos posibles: `ea06b8f6-7fc3-4ab9-8131-f6f00d0bf0d7` (CLIENTE TEST QA
   TOPS, CUIT 30999999995, activo) · `4585ec1e-e98f-4ba9-b5dd-80f104c7a25b`
   (Test3, CUIT 33604896539, activo). Sin evidencia estable: la afinidad de
   nombre NO alcanza.
2. **`Avantecno`** (filas 2 y 5): ídem. Candidato único:
   `ba9b83a2-8fdc-41bd-9673-44862eadd220` (Avantecno SA, CUIT 33707181139,
   activo). Sin vínculo documental: exige decisión administrativa registrada.
3. **`Logistica tops `** (filas 3 y 6, posible consumo interno): ídem.
   Candidatos: `02b55b5d-59f1-4295-8bfe-af31cd32d1f8` (Logistica tops, CUIT
   30714333182, activo) · `ea06b8f6…` (CLIENTE TEST QA TOPS). El consumo
   interno como cliente-de-sí-misma es decisión de modelo, no un hecho.

## 4. Coreografía futura (autoridades separadas por paso)

```text
0219 → merge+deploy del puente (PR #64) → decisiones de Dirección (§3)
     → candidato separado de backfill (validado y probado) → 0220 en la misma
       ventana, con confirmaciones y reservas WMS congeladas
     → revalidación PR #63 → release final de Custodia
```

Hallazgos de ventana a coreografiar (C4 del puente): entre 0219 y 0220 el
`confirm_reception` vigente (0027) crea `inventory_items` por nombre y sin
`client_id`, y `allocate_order` (0031) matchea stock por nombre ⇒ el backfill
y 0220 deben ejecutarse en una misma ventana con la operación WMS congelada.
Las recepciones «no listado» posteriores a 0220 no tienen UI de resolución
(alcance futuro).

## 5. Prohibiciones vigentes

No inventar ni completar valores para lograr cobertura 100 %. Las filas sin
decisión quedan excluidas y **0220 permanece bloqueada** hasta que la
cobertura real sea total.
