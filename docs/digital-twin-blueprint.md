# Digital Twin Logístico — Blueprint Oficial

> **Estado:** aprobado (FASE 4A). Documento rector del modelo físico de TOPS Nexus.
> **Fuente única de verdad:** los planos de incendio oficiales registrados ante el
> Gobierno de la Ciudad de Buenos Aires (GCABA). Toda decisión de modelado físico
> deriva de estos planos. Ignorar croquis o capturas anteriores.

Este documento es la "constitución" del Digital Twin: explica **por qué** existen
los sectores `S1–S5` y `D1–D8`, **de dónde** salieron, y **qué** convenciones rigen
la jerarquía física. Si en el futuro alguien (humano o agente) necesita entender el
modelo, empieza acá.

---

## 1. Sedes

| Sistema | Sede | Dirección | Tipo | Superficie | Titular registral | Certificado |
|---|---|---|---|---|---|---|
| `MAGALDI_1765` | Central | Agustín Magaldi 1765 / Osvaldo de la Cruz 3201, CABA | `mixed` | **6893.87 m²** (certificado) | VEROTIN S.A. | GCABA 460/19 (2019) |
| `PEDRO_LUJAN_3159` | Anexa | Pedro de Luján 3159, CABA | `anmat` | ~7500 m² (**provisional, a validar**) | CLIMAC S.A. | 717/11 |

- **Magaldi** = depósito de consignatarios en general. Superficie cubierta **certificada**.
- **Pedro de Luján** = operación logística regulada (ANMAT). Estibas ≤ 3,70 m. Su m²
  total oficial **aún requiere validación final** → `warehouses.surface_m2 = NULL`
  hasta confirmar. El titular registral del plano es CLIMAC S.A. (TOPS opera la sede).

**Planos analizados:** `PLANO INCENDIOS.pdf` (Magaldi, 4 pp.) y
`Plano Incendios lujan.pdf` (Luján, 1 p. gran formato).

---

## 2. Por qué los sectores de incendio son los `warehouse_sectors`

Los planos definen los polígonos físicos oficiales como **sectores de incendio**,
cada uno con superficie y perímetro registrados y aprobados por el GCABA:

- Magaldi → **Sectores 1 a 5** (planilla de incendio).
- Luján → **Depósitos 1 a 8** (rotulados "sector de incendio" en el plano).

Anclar `warehouse_sectors` a estos polígonos da **trazabilidad regulatoria** (crítico
para la sede ANMAT): la subdivisión no es inventada, es la aprobada por la autoridad.

---

## 3. Jerarquía física oficial (6 niveles)

```
warehouse ──< warehouse_floors ──< warehouse_sectors ──< warehouse_zones ──< warehouse_racks ──< warehouse_positions
 (Sede)          (Piso)              (Sector incendio)     (Subdivisión)        (Estantería)        (Posición = hoja)
```

- **warehouse** — sede física (`MAGALDI_1765`, `PEDRO_LUJAN_3159`).
- **floor** — piso (`PB`, `EP`, `PA`, `P1`, `P2`).
- **sector** — sector de incendio oficial del plano (`S1…S5`, `D1…D8`). Clasificado por `warehouse_sector_type_t`.
- **zone** — subdivisión operativa interna del sector (la define TOPS, no el plano).
- **rack** — estructura física de almacenamiento.
- **position** — unidad atómica. **Toda integración termina acá.**

### Contrato de integración (inmutable)

```
Clave oficial = warehouse_positions.id
```

El botón "Ver ubicación física" del WMS navega a:

```
/operaciones/mapa-inteligente?pos=<warehouse_position_id>
```

El Mapa resuelve solo la cadena depósito→piso→sector→zona→rack→posición por FK.
**Nunca usar otra clave.**

---

## 4. Nomenclatura (`code` por nivel, separador `·`)

| Nivel | Code | Ejemplo |
|---|---|---|
| warehouse | `MAGALDI_1765` / `PEDRO_LUJAN_3159` | — |
| floor | `PB` `EP` `PA` (Magaldi) · `PB` `P1` `P2` (Luján) | `MAGALDI_1765·PB` |
| sector | `S1…S5` (Magaldi) · `D1…D8` (Luján) | `MAGALDI_1765·PB·S1` |
| zone | `A` `B` … | `…·S1·A` |
| rack | `R01` `R02` … | `…·A·R01` |
| position | `N{nivel}-C{columna}` | `…·R01·N1-C03` |

`full_code` completo: `MAGALDI_1765·PB·S1·A·R01·N1-C03` (se computa por join/vista, no se persiste denormalizado en esta versión).

---

## 5. Mapa conceptual (datos del plano)

### MAGALDI_1765 (mixed · 6893.87 m²)
```
PB · Planta Baja
 ├─ S1  564.68 m²   almacenamiento
 ├─ S2  786.02 m²   almacenamiento
 ├─ S3  793.30 m²   almacenamiento  (abarca PB+PA)
 ├─ S4  306.31 m²   almacenamiento
 └─ S5  990.27 m²   almacenamiento
 + oficinas, control/acceso, sanitarios, comedor, sala reunión,
   vestuarios, tablero eléctrico, sala de bombas
EP · Entrepiso
PA · Planta Alta   (oficinas, archivo; S3 sube)
+ Torre tanque + equipo de presurización · accesos múltiples (carga/descarga)
```
> m² por sector leídos de PLANILLA DE INCENDIO (cert. 460/19). Decimales a re-verificar
> en relevamiento (el plano de Magaldi es un scan A4 rotado).

### PEDRO_LUJAN_3159 (anmat · ~7500 m² provisional · estibas ≤ 3,70 m)
```
PB · Planta Baja
 ├─ D1  895.05 m²  (per. 123.54 m)
 ├─ D2  (s/verificar) (per. 73.43 m)
 ├─ D3  885.85 m²  (per. 152.83 m)
 ├─ D4  970.56 m²  (per. 125.00 m)
 ├─ D5  806.50 m²  (per. 150.76 m, claraboya)
 └─ D8  356.85 m²  (per. 83.16 m)
 + oficinas, sanitarios, comedor, vestuario, accesos, montacarga (fuera de servicio), cisterna
P1 · Planta 1° Piso
 └─ D7  ~189.47 m²   ⚠️ subdividido operativamente en 12 cubículos (ver §10)
P2 · Planta 2° Piso
 └─ D6  ~350.78 m²  (per. 81.96 m)  ⚠️ subdividido en 12 cubículos (ver §10)
+ "Vacío sobre P.B." (dobles alturas) · playa descubierta
```

---

## 6. Enums

| Enum | Valores | Uso |
|---|---|---|
| `warehouse_type_t` | `general` `anmat` `mixed` | tipo de sede |
| `warehouse_position_status_t` | `disponible` `reservado` `ocupado` `mantenimiento` | estado de posición (colores: verde/amarillo/rojo/gris) |
| `warehouse_sector_type_t` | `almacenamiento` `recepcion` `despacho` `picking` `cuarentena` `oficinas` `servicios` | clasificación operativa del **sector** |
| `warehouse_zone_type_t` | `almacenamiento` `picking` `recepcion` `despacho` `cuarentena` `refrigerado` | clasificación de la **zona** (subdivisión) |

`warehouse_sector_type_t` y `warehouse_zone_type_t` son **distintos a propósito**:
sector y zona son conceptos diferentes; separarlos mantiene la arquitectura limpia
a largo plazo.

---

## 7. Política de seed (FASE 4B)

**SE SIEMBRA** (datos oficiales del plano, no ficticios):
- `warehouses` — las 2 sedes.
- `warehouse_floors` — sus pisos.
- `warehouse_sectors` — `S1–S5` (Magaldi) y `D1–D8` (Luján) con m² del plano.

**NO SE SIEMBRA** (no está en los planos de incendio — requiere relevamiento operativo de TOPS):
- `warehouse_zones`
- `warehouse_racks`
- `warehouse_positions`

> Los planos de incendio definen compartimentos y locales, **no el layout de
> estanterías**. Racks y posiciones se cargan después por UI/CSV con el relevamiento
> real. No se inventan.

---

## 8. Migraciones

| Archivo | Contenido | Nota |
|---|---|---|
| `0020_wms_physical_model.sql` | 4 enums + 6 tablas + índices + RLS + seed (sedes/pisos/sectores) | self-contained |
| `0021_wms_permission_module.sql` | `permission_module_t ADD VALUE 'wms'` | aislada (regla del enum) |
| `0022_wms_rbac_seed.sql` | permisos `wms.view/edit/admin` + mapeo a roles | requiere 0021 commiteada |

Orden obligatorio **0020 → 0021 → 0022**, en transacciones separadas. Las aplica
Martín a mano en Supabase (`arsksytgdnzukbmfgkju`).

---

## 9. Roadmap de fases

`4A Blueprint` ✅ → `4B Migraciones físicas` → `5 WMS` → `6 Pedidos` → `7 Mapa Inteligente` → `8 Integración`.

Regla permanente: additive only, sin commit/push/deploy sin OK, migraciones aplicadas
por Martín, una fase por vez con aprobación explícita.

---

## 10. Addendum operativo (2026-06-02) — Cubículos ANMAT · Luján P1/P2

> **Dos referencias conviven:** el **plano municipal GCABA** es la referencia **legal y
> estructural** (sectores D6/D7). El **croquis operativo** es la referencia **vigente de
> operación**. No se contradicen: el croquis subdivide internamente al sector municipal.

**Realidad física actual (posterior al plano municipal):** el sector servido por
montacargas de cada piso superior fue subdividido en **12 cubículos independientes**,
con distribución **idéntica** en P1 y P2:

```
PEDRO_LUJAN_3159 · P1  → Sector D7 "Montacargas"  → 12 cubículos (C1…C12)
PEDRO_LUJAN_3159 · P2  → Sector D6 "Montacargas"  → 12 cubículos (C1…C12)
```

Geometría (s/croquis): pasillo central longitudinal; **6 cubículos por lado**
(izq. C1–C6 ≈ 4,48 × 4,00 m; der. C7–C12 ≈ 3,32 m, alturas 2,86–3,80 m); acceso por
**montacargas** + **escalera** secundaria; servicios (hidrante + baño) en el frente.
Cada cubículo tiene **estado propio**: disponible / reservado / ocupado / mantenimiento.

### Modelado (APROBADO — 2026-06-02)

Los cubículos **NO son sectores** (no reemplazan D6/D7); son **subdivisiones operativas
internas** del sector montacargas. Se representan **dentro de la jerarquía de 6 niveles
ya congelada, sin tablas nuevas** (rechazadas explícitamente: `warehouse_units`,
`warehouse_compartments`, cualquier tabla adicional):

```
warehouse(PEDRO_LUJAN_3159) → floor(P1|P2) → sector(D7|D6 "Montacargas")
   → zone("MC") → rack(A | B) → position(C01…C12)  ← el cubículo
```

**El cubículo = `warehouse_position`.** Razón decisiva: el estado
(disponible/reservado/ocupado/mantenimiento) vive en `warehouse_position_status_t`,
que solo existe en `warehouse_positions`. Así el cubículo es además el destino natural
del contrato `?pos=<warehouse_position_id>`. **Sin cambios de esquema.**

**Convención lockeada:**
- `MC` = Sector Montacargas · `A` = fila izquierda · `B` = fila derecha.
- Nomenclatura `code` = `C01`…`C12` (simple, sin prefijo `CUB-`/`CUBICULO-`).
- **Fila A (izquierda):** C01 C02 C03 C04 C05 C06 · **Fila B (derecha):** C07 C08 C09 C10 C11 C12 · pasillo central.
- **Orientación idéntica en P1 y P2** (misma distribución y numeración).
- `full_code`: `PEDRO_LUJAN_3159·P1·D7·MC·A·C01` … `PEDRO_LUJAN_3159·P2·D6·MC·B·C12`.
- `surface_m2` / `volume_m3` por cubículo: **NULL permitido inicialmente**; carga
  definitiva con el relevamiento físico.

Seed de cubículos = dato operativo oficial (croquis) → migración **dedicada
`0023_lujan_cubiculos.sql`** ✅ generada (provenance separada: 0020 = verdad municipal,
0023 = realidad operativa). Crea zona MC + racks A/B + **exactamente 24 posiciones**
(12 P1 + 12 P2), ni una más. Sin aplicar.
