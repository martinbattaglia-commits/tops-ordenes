# TOPS NEXUS — RBAC READINESS REPORT (Entregable 3 · Fase C)

> **Estado:** análisis de readiness · **NO implementa nada** · **Fecha:** 2026-05-29
> Valida el estado real del control de acceso (`profiles.role`, `user_roles`,
> `role_permissions`, `current_role()`, policies RLS), confirma gaps, mide impacto
> en los módulos financieros y entrega un **checklist** para habilitar RBAC auditado.
> Verifica especialmente **G3** (RBAC granular dormido) y **G9** (cambios RBAC sin versionar).
> Fuente de verdad: [RBAC-ARCHITECTURE.md](./RBAC-ARCHITECTURE.md) ·
> [ERP-INFORME-EJECUTIVO-RIESGOS.md](./ERP-INFORME-EJECUTIVO-RIESGOS.md).

---

## 0. Resumen ejecutivo

| Pregunta | Respuesta |
|----------|-----------|
| ¿El acceso actual es seguro para lo que ya está en producción? | **SÍ.** El modelo **SIMPLE** (`profiles.role` + `current_role()`) está enforced en todas las RLS y es coherente. |
| ¿Está listo el RBAC **granular** (7 roles / permisos finos)? | **NO.** Existe en esquema (`0009`) pero está **dormido**: `user_roles = 0`, `has_permission()` **no se usa en ninguna RLS**. (G3) |
| ¿Los cambios de autorización quedan auditados? | **NO.** No hay `rbac_audit`; grants/revokes/asignaciones no dejan rastro. (G9) |
| ¿Bloquea esto el ERP financiero? | **Parcialmente.** El ERP financiero **puede** arrancar sobre el modelo SIMPLE, pero la **segregación de funciones** fiscal/contable (quién emite, quién autoriza, quién exporta) exige cerrar G3 **y** G9 antes de operar con dinero real. |

> **Criterio rector:** cerrar G3+G9 **acerca a reemplazar Neuralsoft**, porque un ERP financiero
> sin segregación de funciones auditada no es auditable ni cumple control interno. → **Documentar y priorizar.**

---

## 1. Estado verificado (no asumido)

### 1.1 Dos modelos coexisten — solo uno está enforced

| Modelo | Dónde vive | Estado | ¿Enforced en RLS? |
|--------|-----------|--------|-------------------|
| **SIMPLE** | `profiles.role` enum `user_role_t` = `admin / operaciones / supervisor / cliente` | ✅ **ACTIVO** | **SÍ** — vía `current_role()` en todas las policies |
| **GRANULAR** | `0009`: tablas `roles` (7), `permissions` (22), `role_permissions`, `user_roles` | ⚠️ **DORMIDO** | **NO** — `has_permission()` no aparece en ninguna RLS |

**Verificado en código (`supabase migration list` + grep sobre migraciones):**
- `0001_init.sql:23` → `create type user_role_t as enum ('admin','operaciones','supervisor','cliente')`.
- `0005_fix_rls_recursion.sql:23` → `current_role()` `SECURITY DEFINER` (anti-recursión, `set search_path`), lee `profiles.role`.
- `0009_rbac.sql:217-224` → **7 roles** granulares: `director_ops, admin, operaciones, compliance, comercial, seguridad, cliente_b2b`.
- `0009_rbac.sql:180` → **22 permisos** sembrados (verificado: 22 inserts `modulo.accion`).
- `0010` agrega 2 permisos (`documental.export`, `documental.admin`) → **catálogo objetivo 24 / 22 en DB** (0010 no aplicada en remoto).

### 1.2 RLS: qué función gobierna realmente el acceso

| Función | Definida en | Uso real |
|---------|-------------|----------|
| `current_role()` | `0001` + `0005` | **TODAS** las RLS de negocio (clients, documents, invoices, etc.) |
| `is_staff()`, `is_admin()` | `0005` | helpers derivados de `current_role()` |
| `has_permission(slug)` | `0009` | **0 usos en RLS** → el RBAC granular no decide nada hoy |

> **Conclusión:** el catálogo granular (`roles/permissions/role_permissions`) es **metadata inerte**
> hasta que (a) se pueblen `user_roles` y (b) las RLS consulten `has_permission()`. Hoy ninguna de las dos ocurre.

---

## 2. G3 — RBAC granular dormido (verificación específica)

| Evidencia | Estado |
|-----------|--------|
| `roles` sembrados | 7 ✅ |
| `permissions` sembrados | 22 ✅ (objetivo 24 con 0010) |
| `role_permissions` (mapeo) | sembrado (director_ops=ALL, admin=ALL−`compras.sign`, etc.) ✅ |
| **`user_roles` (asignación usuario→rol)** | **0 filas → nadie tiene rol granular asignado** ⚠️ |
| RLS que consulten `has_permission()` | **0** ⚠️ |

**Implicancia:** aunque se poblara `user_roles`, **no cambiaría el acceso** porque las policies siguen
mirando `profiles.role`. Activar el granular requiere un trabajo de migración de policies (no trivial,
fuera de GATE 2). **G3 = vivo.**

---

## 3. G9 — Cambios de autorización sin versionar (verificación específica)

| Pregunta | Estado |
|----------|--------|
| ¿Existe tabla de auditoría de cambios RBAC? | **NO** (`rbac_audit` no existe en `0001`→`0011`) |
| ¿`grant`/`revoke`/`assign role` dejan rastro inmutable? | **NO** |
| ¿Quién/cuándo/por qué cambió un permiso? | **No registrable hoy** |
| ¿Existe patrón de referencia para construirla? | **SÍ** — `documents_audit` (`0010`): append-only + trigger `SECURITY DEFINER` |

**Diseño ya documentado (RBAC-ARCHITECTURE §8, NO implementado):** `rbac_audit` append-only con
FK `RESTRICT`, trigger `tg_rbac_audit()` `SECURITY DEFINER`, RLS append-only, y server actions
(`grantPermission/revokePermission/assignRole/setUserBaseRole`) con `reason` obligatorio + gate `is_admin()`.
**Destino:** migración `0012+`, **no ahora**. **G9 = vivo.**

---

## 4. Impacto en módulos financieros

El ERP financiero introduce **segregación de funciones** (SoD) — el control interno más básico de un ERP contable:

| Función financiera | Quién debería poder | Hoy con modelo SIMPLE | Riesgo si se abre sin cerrar G3/G9 |
|--------------------|---------------------|------------------------|-------------------------------------|
| Emitir factura (CAE) | rol facturación | `admin`/`operaciones` (grueso) | un mismo usuario emite y autoriza → sin SoD |
| Autorizar / anular comprobante | rol supervisor fiscal | `admin` | no se distingue emisor de autorizador |
| Exportar datos fiscales | rol compliance | cualquier `admin` | `documental.export` no enforced |
| Cargar/aprobar factura de proveedor (AP) | roles separados | no existe módulo | sin separación captura↔aprobación↔pago |
| Cambiar permisos de otro usuario | solo admin auditado | admin sin auditoría (G9) | escalada de privilegios no trazable |

> **Veredicto de impacto:** el modelo SIMPLE **alcanza para operar documentos**, pero **no satisface
> el control interno de un ERP financiero**. La facturación fiscal (`0011`) y la futura AP/Tesorería
> necesitan SoD real (G3) **con** trazabilidad de cambios de autorización (G9).

---

## 5. Gaps consolidados

| ID | Gap | Severidad | Bloquea GATE 2 (schema)? | Bloquea apertura ERP financiero? |
|----|-----|-----------|--------------------------|----------------------------------|
| G3 | RBAC granular dormido (`user_roles=0`, `has_permission` sin uso) | 🟠 alto | No | **Sí (para SoD)** |
| G9 | Cambios RBAC sin versionar (no `rbac_audit`) | 🟠 alto | No | **Sí (para auditoría)** |
| — | `documental.export/admin` solo existen con `0010` aplicada | 🟡 medio | No | Condicional |

> Ni G3 ni G9 bloquean la **ejecución técnica** de GATE 2 (validar schema de `0010`/`0011`).
> Sí condicionan el **GO** para operar el ERP financiero con dinero real.

---

## 6. Checklist para habilitar RBAC auditado (diseño, NO ejecutar)

> Todo esto vive en migración `0012+` y trabajo de capa app posterior a GATE 2. Aquí solo se define el orden.

- [ ] **C1 — Crear `rbac_audit`** (append-only, FK `RESTRICT`, trigger `tg_rbac_audit()` `SECURITY DEFINER`, RLS append-only). Patrón = `documents_audit`.
- [ ] **C2 — Server actions auditadas:** `grantPermission / revokePermission / assignRole / setUserBaseRole`, cada una con `reason` obligatorio + gate `is_admin()`.
- [ ] **C3 — Poblar `user_roles`** para los usuarios reales (mapear cargo → rol granular).
- [ ] **C4 — Migrar RLS financieras a `has_permission()`** donde se requiera SoD (emisión vs autorización vs export).
- [ ] **C5 — Definir matriz SoD financiera** (emisor ≠ autorizador ≠ pagador) y mapearla a permisos.
- [ ] **C6 — Versionar el catálogo de permisos por migración** (cada alta/baja de permiso = migración trazable).
- [ ] **C7 — Backtest:** correr la batería RBAC (matriz de acceso por rol) en Staging antes de activar en prod.

**Criterio de cierre de readiness RBAC:** C1–C6 implementadas y validadas (C7) en Staging → recién entonces
el ERP financiero puede operar con SoD auditada.

---

## 7. ¿Acerca a reemplazar Neuralsoft?

| Acción | ¿Acerca? | Veredicto |
|--------|----------|-----------|
| Mantener SIMPLE para documentos | Neutro | OK como base |
| Cerrar G3 (activar granular + SoD) | **SÍ** | Necesario para ERP financiero auditable |
| Cerrar G9 (`rbac_audit`) | **SÍ** | Necesario para control interno / auditoría |

> **Recomendación:** GATE 2 puede ejecutarse sin cerrar G3/G9 (son de schema futuro `0012+`).
> Pero el **GO a producción del ERP financiero** debe quedar **condicionado** a cerrar G3+G9.
> Esto alimenta el GO/NO-GO (Entregable 6). **No se implementa nada en esta fase.**
