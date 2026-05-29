# TOPS NEXUS — MIGRATION 0012 DESIGN REVIEW (Entregable 5 · Fase C)

> **Estado:** revisión de **diseño conceptual** · **NO crea migración, NO escribe SQL, NO modifica esquema** · **Fecha:** 2026-05-29
> Revisa exclusivamente el **diseño conceptual** de las entidades candidatas a `0012`:
> `cost_centers`, `chart_of_accounts`, `tax_rates`, `fiscal_periods`, `currencies`,
> `exchange_rates`, `rbac_audit`. Valida coherencia, dependencias, patrones obligatorios
> (multi-tenant, audit, RLS) y orden — **sin implementar**.
> Fuentes: [erp-arquitectura-objetivo.md](./erp-arquitectura-objetivo.md) ·
> [ERP-DEPENDENCY-GRAPH.md](./ERP-DEPENDENCY-GRAPH.md) ·
> [RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) §8.

---

## 0. Encuadre y alcance

| Dimensión | Definición |
|-----------|------------|
| **Qué hace este doc** | Validar que el **diseño** de las 7 entidades es coherente, completo y compatible con los patrones del proyecto. |
| **Qué NO hace** | NO escribe DDL · NO crea `0012` · NO modifica esquema · NO ejecuta nada. |
| **Patrones obligatorios** (del proyecto) | (1) multi-tenant vía `client_id` + RLS `current_role()`; (2) auditoría append-only patrón `documents_audit`; (3) `SECURITY DEFINER` con `set search_path`; (4) idempotencia (`if not exists`); (5) FKs con política de borrado explícita. |
| **Criterio rector** | Cada entidad existe porque **acerca a reemplazar Neuralsoft** (contabilidad, costos, fiscal multimoneda). |

> **Naturaleza de estas entidades:** la mayoría son **catálogos maestros** (referenciales, casi sin `client_id`
> porque son corporativos de VEROTIN S.A.), salvo `cost_centers` (puede ser por tenant) y `rbac_audit`
> (transversal). Esta distinción es clave para decidir si llevan RLS multi-tenant o solo RLS interno.

---

## 1. Entidad por entidad — revisión de diseño

### 1.1 `currencies` (catálogo base — sin dependencias)
- **Propósito:** monedas soportadas (ARS, USD, EUR…). Maestro corporativo.
- **Campos conceptuales:** `code` (PK natural, ISO 4217, ej. 'ARS'), `name`, `symbol`, `decimals`, `is_active`.
- **Dependencias:** ninguna. **Debe crearse primero** (todas las demás referencian moneda).
- **Multi-tenant:** **No** (catálogo corporativo). RLS: lectura interna, escritura admin.
- **Validación de diseño:** ✅ coherente. PK natural `code` ISO 4217 evita ambigüedad. Sin `client_id`.
- **Riesgo:** definir `decimals` por moneda (ARS=2, algunas cripto>2) para evitar errores de redondeo.

### 1.2 `exchange_rates` (depende de `currencies`)
- **Propósito:** cotizaciones por fecha (para valuación multimoneda y conversión).
- **Campos conceptuales:** `from_currency` (FK→currencies), `to_currency` (FK→currencies), `rate` (numeric alta precisión), `rate_date`, `source` (ej. BNA/MEP), `created_at`.
- **Clave única:** `(from_currency, to_currency, rate_date, source)` → una cotización por par/fecha/fuente.
- **Dependencias:** `currencies`. **Orden: después de currencies.**
- **Validación de diseño:** ✅. **Observación:** definir si se guarda tipo de cambio comprador/vendedor o midpoint, y si ARCA exige un tipo específico (RG fiscales). `rate` debe ser `numeric` (no float) por precisión monetaria.
- **Riesgo:** histórico inmutable — una cotización registrada no debería editarse (considerar append-only o lock por fecha cerrada — ver `fiscal_periods`).

### 1.3 `tax_rates` (catálogo fiscal — relación con ARCA/0011)
- **Propósito:** alícuotas de IVA y otros impuestos (21%, 10.5%, 27%, exento, no gravado).
- **Campos conceptuales:** `code`, `name`, `rate_pct` (numeric), `tax_type` (IVA/percepción/retención), `arca_id` (mapeo al código de alícuota ARCA), `valid_from`, `valid_to`, `is_active`.
- **Dependencias:** conceptualmente alineado con `0011` (los `invoice_items` ya calculan IVA). **Reconciliar** con cómo `0011` representa IVA hoy (campo `iva` en `customer_invoices`).
- **Multi-tenant:** **No** (corporativo/fiscal nacional).
- **Validación de diseño:** ✅ pero **requiere reconciliación con `0011`**: hoy el IVA se calcula en `calc.ts`/`invoice_items`. Introducir `tax_rates` implica decidir si `invoice_items` pasa a FK→`tax_rates` (cambio de `0011`, no de `0012`) o si `tax_rates` es solo referencial. **Decisión de diseño pendiente, no bloqueante.**
- **Riesgo:** versionado temporal de alícuotas (`valid_from/valid_to`) para no recalcular facturas históricas si cambia una alícuota.

### 1.4 `fiscal_periods` (control de cierres contables)
- **Propósito:** períodos contables (mes/ejercicio) con estado abierto/cerrado para bloquear asientos en períodos cerrados.
- **Campos conceptuales:** `period` (ej. '2026-05' o ejercicio), `start_date`, `end_date`, `status` (abierto/cerrado/bloqueado), `closed_by`, `closed_at`.
- **Dependencias:** ninguna estructural; **gobierna** a futuras tablas de asientos/movimientos.
- **Multi-tenant:** **No** (corporativo VEROTIN).
- **Validación de diseño:** ✅. **Patrón clave:** un período cerrado debe **bloquear escrituras** en tablas dependientes — esto exige un **trigger guard** (patrón `tg_lock_authorized_invoice` de `0011`) en las tablas de movimientos, no en `fiscal_periods` mismo.
- **Riesgo:** definir si el cierre es reversible (reapertura con auditoría) — debería registrarse en `rbac_audit` o un audit contable.

### 1.5 `chart_of_accounts` (plan de cuentas — núcleo contable)
- **Propósito:** plan de cuentas contable (activo/pasivo/patrimonio/resultado) jerárquico.
- **Campos conceptuales:** `code` (PK natural jerárquico, ej. '1.1.01'), `name`, `account_type` (enum: activo/pasivo/PN/ingreso/egreso), `parent_code` (FK self), `is_postable` (hoja vs agrupadora), `currency` (FK→currencies opcional), `is_active`.
- **Dependencias:** `currencies` (opcional). Self-FK jerárquica.
- **Multi-tenant:** **No** (plan único corporativo).
- **Validación de diseño:** ✅ con cuidados: (a) jerarquía self-referencial requiere prevenir ciclos; (b) solo cuentas `is_postable=true` admiten asientos; (c) borrado de cuenta con movimientos → FK `RESTRICT`.
- **Riesgo:** este es el corazón de la "Contabilidad Gerencial" — **PROHIBIDA su creación en Fase C**. Solo se valida que el diseño es coherente para un `0012` futuro.

### 1.6 `cost_centers` (centros de costo)
- **Propósito:** imputación de costos por centro (depósito, cliente, área).
- **Campos conceptuales:** `code`, `name`, `parent_id` (FK self, jerárquico), `client_id` (FK→clients, **opcional** si el centro es por cliente), `is_active`.
- **Dependencias:** `clients` (`0001`) si se scopa por cliente.
- **Multi-tenant:** **Híbrido** — algunos centros son corporativos, otros por cliente. **Decisión de diseño:** `client_id` nullable + RLS que permita ver corporativos (`client_id is null`) + los propios.
- **Validación de diseño:** ✅. **Es la entidad más cercana a "ya casi existe"** (la arquitectura objetivo la lista como roadmap módulo "Cost Centers" con 0 matches actuales).
- **Riesgo:** definir la regla de visibilidad multi-tenant explícitamente (corporativo vs por cliente) para no filtrar centros ajenos.

### 1.7 `rbac_audit` (transversal — cierra G9)
- **Propósito:** bitácora **append-only** de cambios de autorización (grant/revoke permiso, asignar/quitar rol, cambiar rol base).
- **Diseño ya especificado en RBAC-ARCHITECTURE §8:** tabla append-only, FK `RESTRICT`, trigger `tg_rbac_audit()` `SECURITY DEFINER`, RLS append-only, `reason` obligatorio capturado por server actions.
- **Dependencias:** `roles/permissions/role_permissions/user_roles` (`0009`), `profiles` (`0001`).
- **Multi-tenant:** **No** (transversal interno). RLS: lectura admin/supervisor, **sin** policy de update/delete.
- **Validación de diseño:** ✅ — **mejor especificada de las 7** (sigue el gold-standard `documents_audit`). Cierra G9.
- **Riesgo:** ninguno de diseño; el riesgo es de proceso (asegurar que TODA mutación RBAC pase por las server actions auditadas, no por SQL directo).

---

## 2. Grafo de dependencias y orden de creación (conceptual)

```
currencies ──┬──> exchange_rates
             └──> chart_of_accounts (currency opcional)

tax_rates        (reconciliar con 0011)        [independiente]
fiscal_periods   (gobierna movimientos futuros)[independiente]
cost_centers ──> clients (0001)  [client_id opcional]
rbac_audit  ───> roles/permissions/user_roles/profiles (0009/0001)
```

**Orden sugerido dentro de `0012` (futuro):**
1. `currencies` → 2. `exchange_rates` → 3. `tax_rates` → 4. `fiscal_periods` → 5. `chart_of_accounts` → 6. `cost_centers` → 7. `rbac_audit`.

> Ninguna entidad de `0012` depende de `0010`/`0011` a nivel estructural, **pero** `tax_rates` debe
> **reconciliarse** con la representación de IVA de `0011` antes de diseñarse en firme.

---

## 3. Conformidad con patrones obligatorios

| Patrón | currencies | exchange_rates | tax_rates | fiscal_periods | chart_of_accounts | cost_centers | rbac_audit |
|--------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Multi-tenant `client_id`+RLS | N/A | N/A | N/A | N/A | N/A | ✅ híbrido | N/A (transversal) |
| RLS interno (`current_role()`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Audit append-only | — | recomendado (histórico) | versionado temporal | cierre auditado | — | — | ✅ núcleo |
| `SECURITY DEFINER`+search_path | — | — | — | guard trigger | — | — | ✅ |
| Idempotencia (`if not exists`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| FK con política de borrado | — | `RESTRICT` | — | — | `RESTRICT` (self) | `RESTRICT` | `RESTRICT` |

> **Observación general:** todas las entidades **encajan** en los patrones del proyecto. La única que requiere
> diseño multi-tenant real es `cost_centers`; las demás son catálogos corporativos (RLS interno basta).

---

## 4. Hallazgos de diseño (no bloqueantes para Fase C)

| # | Hallazgo | Severidad | Acción para `0012` futuro |
|---|----------|-----------|----------------------------|
| D1 | `tax_rates` solapa con el IVA ya calculado en `0011` (`invoice_items`/`calc.ts`) | 🟡 medio | Decidir si `invoice_items` pasa a FK→`tax_rates` (toca `0011`) o si `tax_rates` es solo referencial |
| D2 | `exchange_rates` y `tax_rates` necesitan versionado temporal (no editar histórico) | 🟡 medio | `valid_from/valid_to` + lock por período cerrado |
| D3 | `fiscal_periods` solo es útil con triggers guard en tablas de movimientos (que aún no existen) | 🟢 bajo | Diseñar junto con la tabla de asientos (fase contable posterior) |
| D4 | `cost_centers` multi-tenant híbrido necesita regla de visibilidad explícita | 🟡 medio | RLS: `client_id is null OR client_id = own` |
| D5 | `chart_of_accounts` self-FK jerárquica puede formar ciclos | 🟢 bajo | Validación de no-ciclo en server action / check |
| D6 | `rbac_audit` solo es efectiva si TODA mutación RBAC pasa por server actions | 🟢 bajo | Prohibir SQL directo; gate `is_admin()` + `reason` |

> **Ninguno bloquea GATE 2** (que valida `0010`/`0011`, no `0012`). Son notas para el diseño firme de `0012`.

---

## 5. ¿Acerca a reemplazar Neuralsoft?

| Entidad | ¿Acerca? | Comentario |
|---------|----------|------------|
| `rbac_audit` | **SÍ (prioritario)** | Cierra G9; control interno auditable. Mejor especificada hoy. |
| `tax_rates` | **SÍ** | Fiscalidad correcta = núcleo ERP AR. Reconciliar con `0011`. |
| `currencies` + `exchange_rates` | **SÍ** | Multimoneda = requisito para valuación e importación. |
| `chart_of_accounts` | **SÍ (a futuro)** | Corazón contable; **PROHIBIDO crear en Fase C**. |
| `fiscal_periods` | **SÍ** | Cierres contables auditables. |
| `cost_centers` | **SÍ** | Imputación de costos 3PL por depósito/cliente. |

> **Recomendación:** el diseño de las 7 entidades es **coherente y compatible** con los patrones del proyecto.
> Para un `0012` futuro: respetar el orden de §2, resolver D1 (reconciliación IVA con `0011`) y D4 (multi-tenant
> de `cost_centers`) antes de escribir DDL. **Priorizar `rbac_audit`** (cierra G9 y desbloquea SoD financiera).
> **No se crea migración ni SQL en esta fase.** Esto alimenta el GO/NO-GO (Entregable 6).
