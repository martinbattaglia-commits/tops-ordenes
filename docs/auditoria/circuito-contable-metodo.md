# Método de Auditoría Funcional — Circuito Contable Nexus

> **Naturaleza:** 100 % **read-only**. No modifica datos, no aplica migraciones, no toca
> estructura. Se ejecuta sobre la base única `arsksytgdnzukbmfgkju` (productiva) leyendo
> tablas y vistas existentes.
>
> **Objetivo:** validar funcionalmente que los **números cierran** a lo largo del circuito
> `Compras → IVA Compras → Ventas → IVA Ventas → Posición IVA → Asientos → Balance`, que es
> donde aparecen los huecos reales (la infraestructura ya existe; esto audita el contenido).

---

## Régimen de evidencia

- Ningún ítem se declara **OK REAL** sin la **salida real** de su query pegada como evidencia.
- Sin salida → **NO VERIFICABLE**. Nunca inferir, asumir ni completar evidencia faltante.
- Cualquier diferencia ≠ 0 → **FALLA**: se **aísla** el/los comprobante(s) que la generan y se
  busca causa raíz con dato real (G6). **No se "ajusta" a ciegas.**
- El veredicto de circuito se emite **por etapa**, no como GO global, y solo sobre evidencia.

## Tolerancia monetaria

- Importes en `numeric(14,2)` (subledgers) / `numeric(15,2)` (contable). **Tolerancia = `0.00`**
  para identidades de cabecera (total = neto + iva + …) y para cabecera-vs-líneas de IVA.
- Excepción documentada: la coherencia interna `base · alícuota` de una línea de IVA admite la
  tolerancia AFIP de redondeo `≤ 0.02` (ya impuesta por constraint en `supplier_invoice_vat_lines`).

## Aplicabilidad por estado actual de migraciones

Estado al momento de redactar (aplicadas **0082–0084**; pendientes 0085+):

| Etapa | Depende de | Ejecutable hoy |
|---|---|---|
| 1 — Compras | capa fiscal AP (0014, 0056–0059) | ✅ **SÍ** |
| 2 — IVA Compras | `libro_iva_compras` (0059/0071) | ✅ **SÍ** |
| 3 — Ventas | capa fiscal ARCA (0011, 0072–0073) | ✅ **SÍ** |
| 4 — IVA Ventas | `libro_iva_ventas` | ✅ **SÍ** |
| 5 — Posición IVA | `v_posicion_iva` (0086) | ⚠️ requiere **0086** (vistas) |
| 6 — Asientos → Balance | RPC de posteo (0085) + vistas (0086) | ❌ requiere **0085 + 0086** |

> 0085 son **funciones** y 0086 son **vistas**: ninguna crea tablas de negocio. La mitad fiscal
> (Etapas 1–4) se audita **sin aplicar nada más**.

---

## Objetos reales del circuito (verificados contra el repo)

| Dominio | Tabla / Vista | Columnas clave |
|---|---|---|
| Compras (cabecera) | `supplier_invoices` | `neto`, `iva`, `percepciones`, `total`, `approval_status`, `vendor_id`, `tipo_comprobante`, `punto_venta`, `numero` (text), `fecha_emision` |
| Compras (líneas IVA) | `supplier_invoice_vat_lines` | `supplier_invoice_id`, `base_neto`, **`importe_iva`**, `alic_iva_id`, `alicuota_iva` |
| Estados AP | enum `ap_approval_status_t` | `cargada` · `en_revision` · `aprobada` · `anulada` |
| IVA Compras | vista `libro_iva_compras` | filtra `approval_status <> 'anulada'`; agrega por período/alícuota |
| Ventas (cabecera) | `customer_invoices` | `subtotal` (neto gravado), `importe_no_gravado`, `importe_exento`, `iva`, `percepciones`, `total`, `estado_arca`, `cae`, `punto_venta`, `numero_comprobante`, `tipo_comprobante`, `condicion_iva` |
| Ventas (líneas IVA) | `customer_invoice_vat_lines` | `importe_iva` por alícuota |
| Estados venta | enum `invoice_arca_status_t` | `BORRADOR` … `AUTORIZADO_ARCA` |
| IVA Ventas | vista `libro_iva_ventas` | agrega por período/alícuota |
| Posición IVA | vista `v_posicion_iva` | débito − crédito − percep./retenc. |
| Asientos | `journal_entries` / `journal_entry_lines` + `v_libro_diario`, `v_comprobantes_sin_asiento`, `v_asientos_descuadrados`, `v_iva_fiscal_vs_contable` | partida doble, trazabilidad `source_type/source_id` |
| Balance | `v_balance_sumas_saldos`, `v_libro_mayor`, `v_estado_resultados` | sumas y saldos, ecuación contable |

---

## Etapa 1 — COMPRAS (subdiario) · `supplier_invoices`

| # | Qué se chequea | Criterio OK | Hueco clásico que detecta |
|---|---|---|---|
| C1 | `iva` de cabecera = Σ `supplier_invoice_vat_lines.importe_iva` por factura `aprobada` | diferencia = 0 en todas | cabecera editada sin recalcular líneas |
| C2 | `total` = `neto` + `iva` + `percepciones` | se cumple en todas | total cargado a mano inconsistente |
| C3 | Unicidad `(vendor_id, tipo_comprobante, punto_venta, numero)` | 0 grupos duplicados | doble carga del mismo comprobante |
| C4 | Estados que impactan `libro_iva_compras` | solo `aprobada` (según criterio de auditoría) | borradores/en revisión computando crédito fiscal |
| C5 | `percepciones` sufridas en aprobadas | total por factura disponible | percepción sufrida no computada |

> **Hallazgo conocido (C4):** la vista `libro_iva_compras` filtra **`approval_status <> 'anulada'`**,
> por lo que **incluye `cargada` y `en_revision`**, no solo `aprobada`. Contra el criterio de
> auditoría ("solo aprobada"), C4 **marcará FALLA por diseño actual**. No es un bug de cálculo: es
> una **decisión semántica a confirmar con el contador** — *crédito fiscal computable* (suele
> computarse al recibir/cargar el comprobante) vs *aprobación de pago* (`aprobada` = aprobada para
> pago, concepto de tesorería). Se reporta como FALLA y se eleva para definición, **no** se silencia.

## Etapa 2 — IVA COMPRAS · `libro_iva_compras`

| # | Qué se chequea | Criterio OK |
|---|---|---|
| IC1 | Σ `neto_gravado`/`iva_credito_fiscal`/`total_gravado` del libro = Σ de `supplier_invoices` (no anuladas, con líneas) del período | igualdad exacta |
| IC2 | Cada comprobante cae en el período de su `fecha_emision` | 0 fuera de período |

## Etapa 3 — VENTAS (subdiario) · `customer_invoices`

| # | Qué se chequea | Criterio OK | Hueco clásico |
|---|---|---|---|
| V1 | `iva` cabecera = Σ `customer_invoice_vat_lines.importe_iva` | diferencia = 0 | cabecera ≠ líneas |
| V2 | `total` = `subtotal` + `iva` + `percepciones` + `importe_no_gravado` + `importe_exento` | se cumple en todas | suma fiscal mal armada |
| V3 | Solo `estado_arca='AUTORIZADO_ARCA'` **con `cae` no nulo** entra al libro | `BORRADOR`/rechazada fuera | factura sin CAE contada como fiscal |
| V4 | Numeración correlativa de `numero_comprobante` **por `punto_venta`** | sin saltos ni duplicados | gap de numeración (observación AFIP) |
| V5 | Coherencia `condicion_iva` ↔ `tipo_comprobante` (RI→A, Monotributo/CF→B) | sin combinación inválida | tipo de comprobante mal emitido |

## Etapa 4 — IVA VENTAS · `libro_iva_ventas`

| # | Qué se chequea | Criterio OK |
|---|---|---|
| IV1 | Σ del libro = Σ de `customer_invoices` autorizadas del período | igualdad exacta |
| IV2 | Débito fiscal por alícuota = Σ líneas IVA por alícuota | por alícuota, diferencia = 0 |

## Etapa 5 — POSICIÓN IVA · `v_posicion_iva`  *(requiere 0086)*

| # | Qué se chequea | Criterio OK |
|---|---|---|
| P1 | Débito (ventas) − Crédito (compras) − percep./retenc. sufridas = saldo del período, con **signo correcto** (a pagar / a favor) | aritmética y signo correctos |
| P2 | `v_posicion_iva` concuerda con la suma manual de ambos libros | diferencia = 0 |

## Etapa 6 — ASIENTOS → BALANCE  *(requiere 0085 + 0086)*

| # | Qué se chequea | Objeto | Criterio OK |
|---|---|---|---|
| A1 | Todo documento fiscal tiene asiento | `v_comprobantes_sin_asiento` | **vacío** |
| A2 | Cada asiento cuadra (Σ debe = Σ haber) | `v_asientos_descuadrados` | **vacío** |
| A3 | IVA contable = IVA fiscal (débito vs libro ventas; crédito vs libro compras) | `v_iva_fiscal_vs_contable` | diff = 0 |
| A4 | Sin doble contabilización | índice `je_source_unique` | 1 asiento activo por documento |
| B1 | Balance de sumas y saldos global | `v_balance_sumas_saldos` | Σ debe = Σ haber |
| B2 | Ecuación contable: Activo = Pasivo + PN + Resultado | `v_balance_sumas_saldos` / `v_estado_resultados` | identidad se cumple |
| B3 | Cuentas puente: saldo `1.1.05` = Σ crédito libro compras; saldo `2.1.02` = Σ débito libro ventas | `v_libro_mayor` + libros | diferencia = 0 |

---

## Reglas de cierre del método

- Un ítem pasa a **OK REAL** solo con su salida pegada. Sin salida → **NO VERIFICABLE**.
- Diferencia ≠ 0 → **FALLA** + aislamiento del comprobante + causa raíz con dato real (G6).
- **No** se avanza a la etapa siguiente hasta cerrar la anterior con evidencia.
- El **veredicto de circuito** se emite por etapa; el tramo 6 queda condicionado a 0085/0086.

## Criterio de estado — OK REAL / FALLA / NO VERIFICABLE

| Estado | Significado |
|---|---|
| **OK REAL** | La query corrió y su salida cumple el criterio (diferencia 0 / conjunto vacío esperado). |
| **FALLA** | La query corrió y su salida **incumple** el criterio (diferencia ≠ 0 / filas inesperadas). Se aísla y diagnostica; no se ajusta a ciegas. |
| **NO VERIFICABLE** | No hay salida real, o el objeto/dato necesario no existe en el modelo actual (p. ej. desglose de percepción por tipo sin la migración que lo habilita). |

---

## Ejecución Etapa 1 — Compras

1. **Archivo SQL a correr:** `supabase/tests/AUDIT_ETAPA1_COMPRAS.sql` (100 % read-only).
2. **Dónde correrlo:** **Supabase → SQL Editor** del proyecto `arsksytgdnzukbmfgkju`, con un rol de
   lectura. El kit **no** escribe (sin INSERT/UPDATE/DELETE/DDL); puede ejecutarse entero.
3. **Qué salida copiar:**
   - **Principal:** la tabla del bloque **`8. RESUMEN ETAPA 1`** (columnas
     `control · descripcion · estado · cantidad_fallas · monto_diferencia · criterio_ok`).
     En el SQL Editor, al ejecutar todo el archivo se muestra el resultado del **último** bloque
     (el resumen) — esa es la salida a pegar.
   - **Si algún control da `FALLA`:** correr además el **bloque de detalle** de ese control
     (C1/C2/C3/C4) — están rotulados en el archivo — y pegar sus filas para aislar el comprobante.
4. **Cómo interpretar:**
   - `OK` → control cumplido; se registra **OK REAL** con la evidencia.
   - `FALLA` → hay diferencia; se registra **FALLA**, se corre el detalle y se aísla el comprobante.
   - `NO_VERIFICABLE` → el modelo actual no permite el chequeo a ese nivel (caso C5: sin desglose
     por tipo de percepción mientras no esté la migración que lo habilita). Se documenta como tal.
5. **Qué hacer si hay diferencias:**
   - **No ajustar manualmente** ningún importe ni estado.
   - **Aislar** el/los comprobante(s) con el bloque de detalle.
   - **Revisar causa raíz** (cabecera editada sin líneas, doble carga, estado mal seteado, etc.).
   - **Documentar la evidencia** (salida cruda + comprobante identificado) antes de proponer
     cualquier corrección, que será siempre por el flujo válido (RPC), nunca por UPDATE directo.

> No avanzar a Etapa 2 (IVA Compras), 3 (Ventas), 4 (IVA Ventas), 5 (Posición IVA) ni 6
> (Asientos → Balance) hasta cerrar la Etapa 1 con evidencia real.

---

*Documento de método. Read-only. No constituye ejecución ni modificación de datos.*
