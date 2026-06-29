# Diseño — Reglas Fiscales / Contables (reunión Contadora 2026-06-28)

Estado: **Accepted (implementación autónoma autorizada por Martín)**
Autor: Claude (Opus) · Fecha: 2026-06-28 · Branch: `feat/fiscal-contadora-rules`

## 0. Contexto y hallazgo clave del relevamiento

Relevamiento paralelo de 7 subsistemas (`src/lib/{erp,compras,comercial,arca,invoicing,fiscal,pdf}`)
verificado **contra la base de producción** (`arsksytgdnzukbmfgkju`), no solo contra los archivos
de migración.

Hallazgo central: **el "Plan de Cuentas" ya existe en producción** como tabla `chart_of_accounts`
(67 cuentas, plan GAAP argentino jerárquico) + `accounting_rules` (18 reglas), pero:
- fue aplicado **directo a prod vía MCP**, sin archivo de migración en el repo;
- **ningún código de aplicación** lo toca (sin tipos, sin data layer, sin UI);
- el motor de asientos (`acc_post_*`, `journal_entries`) existe pero está **dormido** (0 filas) y es
  **NO-GO sin contador** → fuera de alcance de esta entrega.

Por lo tanto el trabajo es **mayormente superficie de aplicación sobre un catálogo que ya existe**,
más reglas fiscales nuevas, no un rediseño de esquema.

## 1. Principios de diseño (respetan arquitectura actual)

- Capas: Feature/UI → Server Action / Route Handler → `src/lib/<ctx>/data.ts` → Supabase (RPC-first).
- Lógica fiscal = **funciones puras testeables** en `src/lib/fiscal/` (ya postulado por `fiscal/engine.ts`).
- Invariantes en TS (ADR-017); RLS-primary (lectura `authenticated`, escritura `service_role`/RPC).
- Tipos a mano espejando schema (no hay `gen types`).
- Migraciones nuevas: **0120+** (evita colisión con F0.5 0106-0111 / F1 0112-0118 reservadas en otras ramas).
  Idempotentes (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`); en prod se renombran a timestamp al aplicar.
- Dinero: `fmtMoney` (centavos exactos) en transaccional; `fmtCurrency` (redondeo) en display/PDF.
- No se activa el motor de asientos ni el posting automático (NO-GO sin contador).

## 2. Alcance por requerimiento

| # | Requerimiento | Estado real hoy | Acción |
|---|---------------|-----------------|--------|
| 1 | Plan de Cuentas catálogo reutilizable | Tabla existe en prod, sin código/UI/migración | Migración baseline + tipos + data layer + UI read-only + picker reutilizable |
| 2 | Campos Cuenta + Plan de Cuentas en legajos | No existen en `vendors`/`clients` | `cuenta_contable` (texto, validado vs catálogo); "Categoría Fiscal" = `condicion_iva`/`cond_iva` existente |
| 3 | Validación MiPyME contra ARCA | No hay padrón WS, no FCE, credenciales ausentes | Servicio de decisión + datos + **guard de pre-emisión que bloquea**; consulta ARCA tras puerto (provider), activable |
| 4 | IVA en PDF de Orden de Servicio | PDF muestra solo total neto | Subtotal + IVA (21%) + Total, reusando `ivaEstimate()` |
| 5 | Control Tipo C antes de retención Ganancias | **Ya implementado** (regla R2 inline) | Consolidar en servicio único + tests |
| 6 | Exclusión conceptos exentos/no alcanzados | Lógica **fragmentada y duplicada** (motor + panel) | Servicio único `evaluarExclusionRetencion()` reutilizable |
| 7 | Alta proveedores/clientes con Cat. Fiscal + Cuenta + Plan | Alta no captura ni `condicion_iva` | Extender zod + forms + actions de alta (+ edición en ficha) |
| 8 | Arquitectura limpia | Patrón maduro existente | Respetar capas; servicios en `src/lib/fiscal/` |
| 9 | Calidad | `lint`/`typecheck`/`test`/`build` | Ejecutar y dejar verde |

## 3. Plan de Cuentas (req. 1)

- **Migración `0120_chart_of_accounts_baseline.sql`**: trae `account_type_t`, `chart_of_accounts`,
  `accounting_rules` a control de versiones (idempotente; en prod es no-op salvo cuentas nuevas).
  Agrega como cuentas **gestionables** (`is_system=false`) bajo `6.1 Gastos Operativos` las que pide
  la Contadora y faltan: `6.1.14 Alquileres`, `6.1.15 Combustible`, `6.1.16 Gastos de Representación`,
  `6.1.17 Telefonía`, `6.1.18 Internet`, `6.1.19 Celulares`, `6.1.20 Mantenimiento de Software`,
  `6.1.21 Medicina Laboral`, `6.1.22 Ropa de Trabajo`, `6.1.23 Movilidad`, `6.1.24 Viáticos`,
  `6.1.25 Publicidad`. Las restantes del pedido ya existen (Cargas Sociales 6.1.04, Servicios Públicos
  6.1.05, Mantenimiento 6.1.07, Honorarios 6.1.08, Seguros 6.1.09, Impuestos y Tasas 6.1.11,
  Gastos e Intereses Bancarios 6.1.12).
- **Tipos** (`src/lib/erp/types.ts`): `ChartAccount`, `AccountType`, `AccountingRule`.
- **Data layer** (`src/lib/erp/accounting-data.ts`): `listChartOfAccounts({type?, postableOnly?, activeOnly?})`,
  `getAccountByCode()`, `listAccountingRules()` — read-only, RLS, fallback mock (patrón `erp/data.ts`).
- **UI** (`/finanzas/plan-de-cuentas`): server component read-only, árbol jerárquico por código.
- **Picker reutilizable** (`AccountPicker`): `<select>` alimentado por `listChartOfAccounts`, filtrable por tipo.

## 4. Campos de legajo (req. 2 y 7)

- **Migración `0121_legajo_cuenta_contable.sql`**: `ALTER TABLE vendors/clients ADD COLUMN cuenta_contable text`
  (nullable, sin FK dura — se valida app-side contra el catálogo, igual que `accounting_rules.account_code`).
  RPCs `ap_set_vendor_cuenta_contable` / `crm_set_client_cuenta_contable` (SECURITY DEFINER, auditoría).
- "Categoría Fiscal" = `condicion_iva` (clients, enum `condicion_iva_t`) / `cond_iva` (vendors, texto). No se
  duplica para evitar dos fuentes de verdad (riesgo señalado en relevamiento).
- Tipos `Vendor`/`Client` actualizados (también se corrige el drift previo: faltaban campos de 0011/0100).
- Alta: `createVendor` captura `cuenta_contable` + `cond_iva` + `concepto_ganancias`; `createClient` captura
  `condicion_iva` + `cuenta_contable`. Edición desde la ficha vía RPC para backfill de la base existente.
- Ficha proveedor/cliente muestra Cuenta contable + Categoría fiscal.

## 5. MiPyME (req. 3) — terminado lo factible, preparado lo bloqueado por ARCA

- **Migración `0122_mipyme_foundation.sql`**: `clients` += `es_mipyme bool default false`,
  `mipyme_categoria text`, `mipyme_verificado_at timestamptz`, `mipyme_fuente text`;
  `fiscal_config` += `emisor_es_mipyme bool`, `emisor_mipyme_categoria text`;
  tabla `mipyme_config(param_key, valor, vigente_desde)` con seed del umbral mínimo (parametrizable por Contadora).
- **Migración `0123_comprobante_tipo_fce_enum.sql`** (standalone, solo `ALTER TYPE ADD VALUE`, ADR-011):
  agrega `FACTURA_MIPYME_A`, `NOTA_DEBITO_MIPYME_A`, `NOTA_CREDITO_MIPYME_A` y variantes B a `comprobante_tipo_t` (preparado).
- **ARCA** (`src/lib/arca/types.ts`): códigos FCE (201/202/203/206/207/208) en `CbteTipo`, `ComprobanteTipo`,
  `CBTE_MAP`, `COMPROBANTE_LETRA/LABEL`.
- **`src/lib/fiscal/mipyme/`**:
  - `decision.ts` (puro): `evaluarMiPyME({clienteEsMiPyME, emisorEsMiPyME, montoTotal, umbralMinimo}) → {corresponde, comprobanteSugerido, motivo}`.
  - `padron-provider.ts` (puerto): `MiPyMEPadronProvider`; `ManualFlagPadronProvider` (activo, lee `clients.es_mipyme`),
    `ArcaPadronProvider` (stub preparado: lanza `MiPyMENoDisponibleError` hasta tener WS + credenciales).
- **Guard de pre-emisión** en `invoicing` (consumido por `emitInvoiceAction` y `emitFromClientOrdersAction`):
  si corresponde MiPyME y el tipo solicitado es común (no FCE) → **bloquea** la emisión con mensaje claro.
  La emisión efectiva de FCE (Opcionales/CBU/wsfecred + padrón en vivo) queda **preparada para activación**
  (limitación externa: WS de padrón no cableado + clave privada ARCA ausente).

## 6. IVA en Orden de Servicio (req. 4)

- `order.total` es **neto**. IVA = `ivaEstimate(total, 0.21)` (helper existente en `pricing/calculator.ts`).
- `OrderPdfDocument.tsx`: reemplazar la fila única "Total estimado" por tres filas
  (Subtotal neto / IVA (21%) / Total) usando estilos existentes (`styles.totalRow`, `fmtCurrency`).
- `order-email.ts`: discriminar Subtotal / IVA (21%) / Total en cada rol. Espejo `PdfPreview.tsx` y legacy `email.ts` por coherencia.

## 7. Servicio único de exclusión de retención (req. 5 y 6)

- **`src/lib/fiscal/exclusion-retenciones.ts`** (puro): `evaluarExclusionRetencion(input) → ResultadoExclusion`
  con `{ excluido, categoria, motivo, confianza }`. Categorías:
  `exento_proveedor | certificado_vigente | factura_C | factura_no_A | concepto_excluido | no_alcanzado`.
  Centraliza las reglas hoy dispersas (R1/R2/R3 del motor + `isMonotributista`/`buildAlertas` del panel).
- `calculateIncomeTaxRetention` (prod, aprobado) se refactoriza para **delegar** en el servicio,
  **preservando comportamiento** (TDD: tests de caracterización primero).
- `RetenciongananciasPanel.tsx` consume el mismo servicio (elimina duplicación).
- La lista de conceptos excluidos se mantiene (luz/gas/telefonía/internet/seguros) y se documenta como
  candidata a parametrización futura en DB.

## 8. Calidad y entrega

- Tests nuevos (vitest, funciones puras): `exclusion-retenciones.test.ts`, `mipyme/decision.test.ts`,
  caracterización de `retencion-ganancias`. Se amplía `vitest.config.ts` include a `src/lib/fiscal/**` y `src/lib/compras/**`.
- Gates: `npm run lint && npm run typecheck && npm run test && npm run build`.
- Riesgos principales: DDL prod no versionado (mitigado por migración baseline idempotente); refactor de
  código fiscal en producción (mitigado por TDD); numeración de migraciones (mitigado usando 0120+).

## 9. Addendum — review adversarial y migración 0124

Tras implementar, se corrió una review adversarial (4 dimensiones × verificación por hallazgo).
Motor de retenciones y MiPyME quedaron **sin hallazgos reales**. Se corrigieron 2 hallazgos medium:

1. **`0124_contabilidad_permissions_seed.sql`** — los slugs RBAC `contabilidad.view/create/edit/export/admin`
   existían en prod fuera de banda; ninguna migración los seedeaba. Sin esto, una reconstrucción limpia
   dejaría las RLS accesibles solo al rol `admin`. La 0124 los seedea idempotentemente (espejo de prod, no-op).
2. **`AccountPicker`** — ahora preserva la cuenta guardada aunque caiga fuera del filtro (no la blanquea
   silenciosamente); las fichas inyectan la cuenta imputada (`getAccountByCode`) para resolver su nombre.

Gates finales: `lint` (sin errores nuevos) · `typecheck` OK · `test` 231/231 · `build` OK.
**No se aplicó ninguna migración a prod ni se desplegó** — queda para el proceso de release manual.
