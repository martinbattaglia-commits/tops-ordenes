# Propuesta C4 — Filtro fiscal de `libro_iva_compras` (APROBADA, opción A)

> **Estado:** APROBADA por Dirección (Martín). **Doc-first / read-only.** No aplica nada,
> no toca producción, no modifica datos. Acompaña a la migración `0102` (entregada, no aplicada)
> y al kit `supabase/tests/C4_LIBRO_IVA_COMPRAS_VALIDATION.sql`.
>
> Origen del hallazgo: auditoría funcional Etapa 1 — Compras, control **C4** (FALLA REAL,
> 2 comprobantes no aprobados impactando el libro fiscal). Evidencia real obtenida sobre
> `arsksytgdnzukbmfgkju` en Supabase SQL Editor.

---

## 1. Diagnóstico de causa raíz

El libro IVA Compras nació (**0059**) y se endureció (**0071**) con el recorte
`approval_status <> 'anulada'`. Pero el **workflow de aprobación AP**
(`ap_approval_status_t`: `cargada → en_revision → aprobada → anulada`) se incorporó en **0057**,
*después* del libro, y el filtro nunca se ajustó a ese workflow.

**Consecuencia:** un comprobante recién **`cargada`** (alta confirmada, sin validación contable)
**ya suma crédito fiscal** en el libro. Hay un desfase entre *documento cargado* y *documento
fiscalmente computable/validado*.

## 2. Vista involucrada

`public.libro_iva_compras` — definida en `0059_iva_compras_views.sql`, **versión vigente** en
`0071_fiscal_hardening.sql` (incluye factor de signo para `NOTA_CREDITO%` y `security_invoker = true`).
No existe redefinición posterior.

## 3. Filtro actual

```sql
where si.approval_status <> 'anulada'      -- incluye 'cargada' y 'en_revision'
```

## 4. Filtro propuesto

```sql
where si.approval_status = 'aprobada'      -- solo computa lo validado
```

- `aprobada` (y sus `NOTA_CREDITO` aprobadas, que restan por el factor de signo) computan.
- `cargada` / `en_revision` **no** computan en el libro fiscal.
- `anulada` **nunca** computa (`anulada ≠ aprobada`).

## 5. Riesgos

| Riesgo | Severidad | Mitigación |
|---|---|---|
| El crédito fiscal del libro **baja** → cambia la posición IVA y el crédito computable | **Alto (fiscal)** | Es el comportamiento correcto; **avisar al contador** antes de declarar; cuantificar el delta por período (§8) |
| Aguas abajo (`v_posicion_iva`, `v_iva_fiscal_vs_contable`, al aplicarse) reflejarán menos crédito | Medio | Coherente con el criterio fiscal; se valida en la conciliación |
| Comprobantes legítimos aún no aprobados “desaparecen” del control | Medio | **Vista preliminar separada** (§7) los conserva para gestión |
| Dependencias que rompan con `CREATE OR REPLACE` | Bajo | Solo cambia el `WHERE`, **no** estructura/columnas → `REPLACE` seguro |
| Seguridad / RLS | Nulo | Se mantiene `security_invoker = true` |

> El cambio **no depende** de la cadena contable 0085–0101: la vista solo lee `supplier_invoices`
> + `supplier_invoice_vat_lines`, ya presentes. C4 se resuelve **antes** de decidir 0085/0086.

## 6. Impacto esperado sobre los 2 comprobantes detectados

Alícuota efectiva = `167433 / 797300 = 21 %` (`alic_iva_id = 5`), período **2026-06**, estado **`cargada`**.

| supplier_invoice_id | proveedor | numero | neto | iva | percep | estado |
|---|---|---|---|---|---|---|
| `04193a08-3cd9-42ae-a018-adef262aab55` | Neuralsoft | 00124759 | 797300.00 | 167433.00 | 35878.50 | cargada |
| `761c5750-d39a-4091-9481-a1b803e62d1f` | Bulonera Balemap | 00124759 | 797300.00 | 167433.00 | 35878.50 | cargada |

- **Tras el cambio salen del libro fiscal.** Período 2026-06 baja: **neto gravado −1.594.600,00** y
  **crédito fiscal −334.866,00** (2 × 167.433) en la alícuota 21 %.
  *(Las percepciones no están en esta vista; impactan donde se computen las percepciones sufridas.)*
- Pasan a la **vista preliminar** como “IVA en gestión”.
- Al **aprobarse**, reingresan automáticamente al libro fiscal (sin intervención manual).

## 7. Vista preliminar recomendada

Vista de **control operativo** (no fiscal), con la **misma estructura** que el libro fiscal:

- **`public.libro_iva_compras_preliminar`** — filtro `approval_status in ('cargada','en_revision')`.

Set final con responsabilidad clara:

| Vista | Estados | Naturaleza |
|---|---|---|
| `libro_iva_compras` | `aprobada` | **fiscal real** |
| `libro_iva_compras_preliminar` | `cargada`, `en_revision` | **gestión / no fiscal** |
| (ninguna) | `anulada` | **nunca computa** |

## 8. SQL de validación read-only

Ver kit completo en `supabase/tests/C4_LIBRO_IVA_COMPRAS_VALIDATION.sql`. Controles:

1. `libro_iva_compras` (vista) == recompute `aprobada` → ya no incluye `cargada`/`en_revision`/`anulada`.
2. `libro_iva_compras_preliminar` (vista) == recompute `cargada`/`en_revision`.
3. Los 2 comprobantes (Neuralsoft / Bulonera Balemap) fuera del fiscal y dentro del prelibro.
4. Delta de crédito fiscal 2026-06 = **334866.00**.
5. Notas de crédito conservan signo correcto en la vista fiscal.
6. Las columnas de `libro_iva_compras` no cambiaron (nombre/orden/tipo).
7. Ningún `anulada` en ninguna de las dos vistas.

## 9. Plan de migración

- **Archivo:** `supabase/migrations/0102_libro_iva_compras_fiscal_filter.sql` (siguiente número libre).
- **Naturaleza:** correctiva, **idempotente** (`create or replace view`), **no toca tablas ni datos**,
  **independiente** de 0085–0101 (aplicable de forma aislada).
- **Contenido:**
  1. `create or replace view public.libro_iva_compras` idéntica a la 0071 (conservando el
     `cross join lateral` del signo de NOTA_CREDITO y `security_invoker = true`), cambiando **solo**
     el `where` a `si.approval_status = 'aprobada'`.
  2. `create or replace view public.libro_iva_compras_preliminar` con la misma estructura y
     `where si.approval_status in ('cargada','en_revision')`.
  3. `comment on view` en ambas (fiscal real / prelibro operativo).
  4. `notify pgrst, 'reload schema';`.
- **Reversibilidad:** un `create or replace view` posterior restaura la definición 0071 si hiciera falta.
- **Pre-aplicación:** restore point (G4) + aviso al contador por el cambio de crédito fiscal.

## 10. Decisión funcional aprobada

- ✅ `libro_iva_compras` = **solo `aprobada`** (libro fiscal real).
- ✅ `libro_iva_compras_preliminar` = `cargada` / `en_revision` (prelibro operativo, no fiscal).
- ✅ `anulada` **nunca** computa en ninguna de las dos.

## 11. Observación secundaria — data quality (hallazgo abierto)

Los dos comprobantes detectados tienen **proveedores distintos** (Neuralsoft / Bulonera Balemap)
pero **mismo `numero`** (`00124759`), **misma fecha** (`2026-06-01`) y **mismos montos**
(neto 797.300 / iva 167.433 / percep 35.878,50).

- **No rompe C3**: la clave de unicidad incluye `vendor_id`, y el proveedor es distinto.
- Es un patrón **anómalo** (probable carga de prueba o duplicada entre proveedores).
- Queda como **hallazgo abierto para revisión manual**, **independiente** del fix C4 (no lo bloquea).

---

*Documento de propuesta aprobada. Read-only. No constituye aplicación ni modificación de datos.*
