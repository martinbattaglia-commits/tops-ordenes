# Revisión pre-producción — Migración `0011_arca_billing.sql`

> **Propósito:** revisar exactamente qué crea/modifica la migración 0011 **antes**
> de ejecutarla en el Supabase de producción (`arsksytgdnzukbmfgkju`).
> **Estado:** NO aplicada en producción. El deploy actual funciona sin ella
> (las pantallas `/billing`, `/settings/fiscal` y el PDF fiscal devolverán error
> hasta aplicarla — el resto de la app no se ve afectado).
> Archivo fuente: `supabase/migrations/0011_arca_billing.sql` (367 líneas).

---

## 0. Resumen de impacto

| Categoría | Crea | Modifica tablas existentes |
|-----------|------|----------------------------|
| Enums (tipos) | 5 nuevos | — |
| Tablas nuevas | 4 (`fiscal_config`, `puntos_venta`, `customer_invoices`, `invoice_items`, `invoice_audit` = **5**) | — |
| Columnas agregadas | — | `clients` (+3), `orders` (+1) |
| Trigger | 1 (lock de comprobantes autorizados) | sobre `customer_invoices` (nueva) |
| RLS policies | 11 | sobre tablas nuevas |
| Storage | bucket `invoices` (privado) + 1 policy | — |
| Realtime | publica `customer_invoices` | publication `supabase_realtime` |
| Seeds (datos) | `fiscal_config` id=1 (VEROTIN), 2 puntos de venta | — |

**Idempotencia:** segura de re-ejecutar. Usa `create type ... exception when
duplicate_object`, `create table if not exists`, `add column if not exists`,
`on conflict do nothing`, `drop policy if exists`. Re-correrla no duplica datos
ni rompe.

**Riesgo sobre datos existentes:** BAJO. Solo agrega columnas con `default` a
`clients` y `orders` (no borra ni altera datos). El resto son objetos nuevos.

---

## 1. Enums nuevos (5)

- `condicion_iva_t`: RESPONSABLE_INSCRIPTO, MONOTRIBUTO, EXENTO, CONSUMIDOR_FINAL, NO_RESPONSABLE, NO_CATEGORIZADO.
- `comprobante_tipo_t`: FACTURA_A/B/C/E + NOTA_DEBITO_A/B/C + NOTA_CREDITO_A/B/C.
- `invoice_arca_status_t`: BORRADOR, PENDIENTE_ARCA, ENVIADO_ARCA, AUTORIZADO_ARCA, RECHAZADO_ARCA, ERROR_ARCA, ANULADO.
- `arca_ambiente_t`: SANDBOX, HOMOLOGACION, PRODUCCION.
- `punto_venta_tipo_t`: WEBSERVICE, CONTROLADOR_FISCAL, MANUAL.

## 2. Cambios en tablas EXISTENTES (revisar con atención — son tablas vivas)

**`clients`** — agrega 3 columnas con default (no rompe filas actuales):
- `condicion_iva condicion_iva_t NOT NULL default 'RESPONSABLE_INSCRIPTO'`
- `tipo_doc smallint NOT NULL default 80` (80 = CUIT, tabla ARCA)
- `localidad text` (nullable)

**`orders`** — agrega 1 columna + 1 índice:
- `invoice_id uuid references customer_invoices(id) on delete set null` (nullable)
- índice `orders_invoice_idx`

> ⚠️ Nota: el FK `orders.invoice_id → customer_invoices` exige que
> `customer_invoices` exista, por eso 0011 debe correr íntegra (crea la tabla
> antes del alter).

## 3. Tablas nuevas (5)

- **`fiscal_config`** (singleton `id=1`, `check (id=1)`): datos del emisor
  (razón social, CUIT, IIBB, domicilio, condición IVA, **ambiente** = SANDBOX por
  defecto, `cert_alias` — la key X.509 NUNCA acá), `default_punto_venta`,
  `pie_legal`, `updated_by → auth.users`. **Seed VEROTIN S.A. en SANDBOX.**
- **`puntos_venta`**: numero (unique), descripcion, tipo, activo. **Seed PV 2
  (CONTROLADOR_FISCAL) y PV 3 (WEBSERVICE).**
- **`customer_invoices`**: comprobante electrónico completo — receptor (snapshot),
  tipo/cbte_tipo_arca/concepto/punto_venta/numero, fechas de servicio, CAE +
  vencimiento + QR (data/url/hash), importes `numeric(15,2)` (subtotal, no
  gravado, exento, IVA, percepciones, tributos, total, moneda, cotización),
  `estado_arca` (default BORRADOR), request/response ARCA jsonb, `ambiente`,
  `comprobante_asociado_id` (NC/ND), `anulada` (anulación lógica), PDF
  (bucket/path/url), `emitido_por`. Unicidad `(punto_venta, cbte_tipo_arca,
  numero_comprobante)`. 5 índices.
- **`invoice_items`**: renglones; FK a `customer_invoices` (cascade) y opcional a
  `orders`; cantidad/precio/alícuota IVA/importes; 2 índices.
- **`invoice_audit`**: auditoría fiscal append-only (`bigserial`): invoice_id, ts,
  user_id, action, estado, cae, request/response jsonb, ip.

## 4. Trigger de inmutabilidad fiscal

`tg_lock_authorized_invoice()` (BEFORE UPDATE en `customer_invoices`): si la fila
está `AUTORIZADO_ARCA`, bloquea cambios a campos fiscales (cae, numero, total,
subtotal, iva, cbte_tipo_arca, punto_venta, cuit_cliente) → fuerza emitir NC/ND.
Permite: anulación lógica, materializar PDF, `updated_at`. **Implementa el
no-negociable "no modificar comprobantes autorizados".**

## 5. RLS (11 policies)

- `fiscal_config` / `puntos_venta`: lectura admin/operaciones/supervisor;
  escritura solo admin.
- `customer_invoices`: lectura interna + el cliente ve las suyas
  (`client_id = profiles.client_id`); escritura admin/operaciones.
- `invoice_items`: lectura si existe la factura; escritura admin/operaciones.
- `invoice_audit`: lectura admin/supervisor; insert admin/operaciones (append-only).

> Dependencia: usan `public.current_role()` (creada en `0001_init`, endurecida en
> `0005_fix_rls_recursion`; `0009_rbac` solo la **usa**) y `profiles.client_id`.
> Confirmar que ambas existen en producción antes de aplicar.

## 6. Storage + Realtime

- Bucket privado **`invoices`** (`public=false`) + policy: acceso solo a
  `authenticated`. PDFs fiscales se sirven con URLs firmadas.
- Agrega `customer_invoices` a la publication `supabase_realtime` (si existe).
- `notify pgrst, 'reload schema'` al final (refresca PostgREST).

## 7. Checklist antes de aplicar en producción

- [ ] Confirmar que `current_role()` (de 0001/0005) y `profiles.client_id` ya están en prod.
- [ ] Confirmar backup/restore point del proyecto Supabase.
- [ ] Aceptar que `clients` y `orders` reciben columnas nuevas (con default, sin pérdida).
- [ ] Revisar el seed de `fiscal_config` (VEROTIN, **SANDBOX**) y los 2 puntos de venta.
- [ ] Tras aplicar: verificar que `/billing` y `/settings/fiscal` cargan sin error.
- [ ] Mantener `ambiente=SANDBOX` hasta montar el certificado X.509 en el host
      (`ARCA_CERT_PATH`/`ARCA_KEY_PATH`); PRODUCCIÓN está bloqueada por código sin él.

## 8. Cómo aplicarla (cuando se autorice)

La migración es un `.sql` plano. Opciones: Supabase SQL Editor (pegar el archivo),
`supabase db push` con el CLI apuntando al proyecto, o el script de migraciones
del repo. **No ejecutar sin confirmación explícita** (entorno productivo).
