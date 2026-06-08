# TOPS NEXUS — RRHH · R1 IMPLEMENTATION PLAN (R1 OPENING GATE)
## R1 — RRHH FOUNDATION · `0056_rrhh_permission_module`

> **Estado:** PLAN — pendiente de aprobación de Dirección. **No** se implementa, **no** se migra,
> **no** se escribe SQL/código, **no** se commitea, **no** se toca producción.
> **Fuente de verdad única:** `docs/handoff/RRHH_MASTER_ARCHITECTURE_v2_0.md`. Los documentos v1.0/
> v1.1/v1.2/v1.2.1 y las auditorías quedan solo como trazabilidad; ante conflicto **prevalece v2.0**.
> **Metodología:** idéntica a ERP-A (`0052` treasury permission_module → patrón de referencia).
> **Producción:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07.

---

## 0. Estado verificado del entorno (read-only)

- Árbol de migraciones termina en `0055_treasury_security_fix.sql`. **`0056` LIBRE** (re-verificar
  inmediatamente antes de crear el archivo — ver §6 Preflight).
- `HEAD = 798e158` (merge ERP-A Tesorería). Sin migraciones nuevas que afecten RRHH.
- RBAC intacto: `permission_module_t`, `roles`, `permissions`, `role_permissions`, `has_permission`.
- Validación de coherencia previa: `docs/handoff/RRHH_R0_PRE_IMPLEMENTATION_REVIEW.md` → `READY TO
  START R1` (0 conflictos).

---

## 1. Objetivo de R1

Dar de alta el dominio **RRHH** dentro del ecosistema RBAC de Nexus, agregando el valor `'rrhh'` al
enum `permission_module_t`. **Nada más.** R1 es el gate fundacional aislado que habilita —en gates
posteriores (R2+)— sembrar permisos `rrhh.*` y crear tablas/RLS/RPCs.

**Por qué aislado:** Postgres no permite **usar** un valor de enum nuevo en la misma transacción que
lo agrega (`ALTER TYPE ... ADD VALUE`). El alta del valor debe ir en su **propia migración,
committeada**, antes de cualquier migración que lo referencie (patrón verificado en `0021` wms,
`0029` pedidos, `0052` tesoreria).

---

## 2. Alcance de R1 (estricto)

**Incluye:** una única migración aditiva `0056_rrhh_permission_module` que agrega el valor `'rrhh'`
al enum `permission_module_t` (idempotente) + recarga de esquema de PostgREST.

**NO incluye (queda para R2+):**
- ❌ Seed de permisos `rrhh.*` y roles RRHH (R2 / `0057` seed).
- ❌ Tablas, RLS, triggers, vistas, RPCs (`0057`–`0061`).
- ❌ Buckets de storage, capa lib, UI.
- ❌ Cualquier dato, cualquier escritura en tablas existentes.

**Naturaleza:** puramente aditiva sobre un tipo enum. No crea tablas, no toca datos, no modifica
estructuras existentes, no afecta ningún dominio (CRM/ERP-A/ERP-B/Operaciones/Compliance/Custody/
Documental).

---

## 3. Validación de dependencias (verificado read-only)

| Dependencia | Estado | Nota |
|-------------|--------|------|
| `permission_module_t` | ✅ existe | Enum base + valores aditivos (`wms`, `pedidos`, `operaciones`, `tesoreria`, …). R1 agrega `'rrhh'`. |
| `roles` (tabla) | ✅ existe (`0009`) | No se toca en R1; se usará en R2 seed. |
| `permissions` (tabla) | ✅ existe (`0009`) | Su columna `module` usa `permission_module_t`; por eso `'rrhh'` debe existir **antes** de insertar permisos `rrhh.*` (R2). |
| `role_permissions` | ✅ existe (`0009`) | No se toca en R1. |
| `has_permission(slug)` | ✅ existe (`0009`) | No se toca en R1; consumido en RPCs de R6+. |
| `user_role_t` | ✅ intacto (`0001`) | **No se modifica** (FD-5). R1 no lo toca. |

**Dependencia crítica documentada:** `permissions.module` (enum `permission_module_t`). El seed de
R2 que inserte permisos `rrhh.*` **requiere** que `0056` esté aplicado y committeado. Orden duro:
`0056` → (commit) → `0057`.

---

## 4. Diseño de la migración `0056` (sin SQL — solo diseño)

> El SQL real se redacta al ejecutar, copiando el patrón exacto de `0052_treasury_permission_module.sql`.

- **Operación:** una sola sentencia aditiva sobre `permission_module_t` que agrega el valor `'rrhh'`,
  en forma **idempotente** (no falla si ya existe), seguida de la recarga de esquema de PostgREST.
- **Idempotencia:** re-ejecutable sin efectos secundarios; si `'rrhh'` ya existe, es no-op.
- **Transaccionalidad:** migración **aislada**; ninguna otra sentencia que **use** `'rrhh'` puede ir
  en este archivo ni en su misma transacción. Debe **committearse** antes de `0057`.
- **Cabecera/documentación:** comentario que explique la restricción de enums de Postgres y el orden
  obligatorio respecto de `0057` (mismo estilo que `0052`).

### 4.1 Objetivo
Habilitar `'rrhh'` como módulo RBAC reconocido por `permissions.module`.

### 4.2 Alcance
Solo el alta del valor de enum + reload PostgREST. Aditivo, sin datos, sin estructuras.

### 4.3 Riesgos (de la migración)
- **Uso prematuro del valor:** si por error el archivo incluye o se acompaña de inserciones que usan
  `'rrhh'` en la misma transacción → error Postgres "unsafe use of new value of enum type".
  **Mitigación:** R1 contiene exclusivamente el `ADD VALUE` + reload; el seed va en `0057`.
- **Número de migración tomado:** otra rama podría usar `0056`. **Mitigación:** re-verificar libre en
  preflight; si está ocupado, usar el siguiente libre y ajustar el roadmap (sin alterar el orden
  relativo).
- **Recarga de esquema:** omitir el reload deja PostgREST sin ver el cambio. **Mitigación:** incluir
  la notificación de reload (patrón `0052`).

### 4.4 Rollback
- **Antes de commit:** descartar el archivo (sin efecto en prod).
- **Tras aplicar en prod:** los valores de enum en Postgres **no se eliminan** trivialmente
  (`ALTER TYPE ... DROP VALUE` no existe). Por eso el "rollback" de un `ADD VALUE` es **dejarlo
  inerte**: al ser aditivo y no usado aún (R1 no siembra nada), un valor `'rrhh'` huérfano es
  **inocuo** (no hay permisos ni filas que lo referencien). No requiere reversión activa.
- Estrategia de reversión real (si se aborta el dominio entero): no recrear el enum en producción;
  se documenta el valor como reservado/no usado. (Mismo criterio que ERP-A para sus `ADD VALUE`.)

### 4.5 Criterios de aceptación
- `'rrhh'` aparece en los valores de `permission_module_t` en `arsksytgdnzukbmfgkju`.
- La migración es idempotente (segunda ejecución = no-op, sin error).
- PostgREST recarga esquema sin error.
- **Ningún** otro objeto creado/modificado; diff de estructura limitado al enum.
- `0056` committeado **antes** de cualquier intento de `0057`.

---

## 5. Procedimiento (referencia ERP-A, para ejecución futura)

> No se ejecuta ahora. Se documenta el orden, calcado de `ERP_A1_EXECUTION_PLAN.md`.

1. Rama de trabajo dedicada (p.ej. `erp-rrhh/r1-foundation`).
2. Crear `supabase/migrations/0056_rrhh_permission_module.sql` (patrón `0052`).
3. **Commit aislado** de `0056` (nada más en ese commit).
4. Aplicar en producción de forma **manual y controlada** (mismo procedimiento que `0052` en
   `ERP_A1_EXECUTION_PLAN.md §3`), con un solo operador y bajo aprobación.
5. Verificar (§6 Verificación).
6. Recién entonces habilitar la preparación de R2 (`0057`).

---

## 6. Checklist de implementación (estándar ERP-A)

### Preflight (antes de tocar nada)
```
☐ Aprobación explícita de Dirección registrada
☐ Re-verificar que 0056 sigue libre (ls supabase/migrations/0056*)
☐ HEAD y rama correctos; árbol limpio
☐ RBAC intacto (permission_module_t / roles / permissions / has_permission)
☐ Backup/restore de producción disponible y verificado (política de backups vigente)
☐ Ventana de cambio acordada; un único operador
```

### Ejecución
```
☐ Crear rama dedicada
☐ Redactar 0056 copiando el patrón EXACTO de 0052 (solo ADD VALUE idempotente + reload)
☐ Revisar que el archivo NO contiene ninguna sentencia que USE 'rrhh'
☐ Commit aislado de 0056 (sin otros cambios)
☐ Aplicar 0056 en arsksytgdnzukbmfgkju (manual, controlado)
```

### Verificación (en prod, read-only)
```
☐ 'rrhh' presente en permission_module_t
☐ Re-ejecución idempotente: segundo intento = no-op sin error
☐ PostgREST recargó esquema (sin error)
☐ Diff estructural limitado al enum; ninguna tabla/dato modificado
☐ Dominios existentes intactos (smoke check CRM/ERP-A/Operaciones)
```

### Auditoría
```
☐ Registrar quién/cuándo aplicó la migración
☐ Evidencia read-only del valor de enum (captura del catálogo)
☐ Confirmar que NO se sembraron permisos ni roles (eso es R2)
```

### Cierre
```
☐ Generar RRHH_R1_CLOSURE_REPORT.md (estilo ERP-A)
☐ Veredicto R1: GO/NO-GO para abrir R2
☐ Actualizar el estado del dominio (R1 cerrado → R2 listo para planificar)
```

---

## 7. Riesgos

| Tipo | Riesgo | Severidad | Mitigación |
|------|--------|-----------|------------|
| Técnico | Uso del valor de enum en la misma tx que el ADD VALUE | Media | R1 solo ADD VALUE + reload; seed en `0057` |
| Técnico | Número `0056` tomado por otra rama | Baja | Re-verificar en preflight; usar siguiente libre |
| Técnico | Falta de reload PostgREST | Baja | Incluir notificación de reload (patrón `0052`) |
| Funcional | Expectativa de "ver RRHH funcionando" tras R1 | Baja | Comunicar: R1 es solo alta de módulo RBAC; sin UI/datos |
| Seguridad | Ninguno introducido por R1 (no hay datos, RLS ni RPC) | — | El endurecimiento (FD-1…FD-10) aplica desde R2+ |
| Producción | Aplicación manual sobre prod sin backup | Alta (si se omite) | Preflight exige backup verificado + ventana + operador único |

> R1 es de **riesgo intrínseco bajo**: una operación aditiva e idempotente sobre un enum, sin datos
> ni estructuras. El riesgo dominante es **operacional** (aplicar sobre prod), cubierto por el
> checklist preflight.

---

## 8. GO / NO-GO

**GO si:** Dirección aprueba · `0056` libre · backup verificado · checklist preflight completo.
**NO-GO si:** falta aprobación · `0056` ocupado · sin backup · cualquier desviación del diseño v2.0.

> Regla heredada: ante cualquier conflicto con `RRHH_MASTER_ARCHITECTURE_v2_0.md` durante la
> ejecución, **detener** y documentar la corrección antes de continuar.

---

## Anexo — Trazabilidad

- Diseño congelado: `RRHH_MASTER_ARCHITECTURE_v2_0.md` (§7 roles, §8 roadmap, §9.2 checklist seguridad).
- Validación R0: `RRHH_R0_PRE_IMPLEMENTATION_REVIEW.md` (READY TO START R1).
- Patrón de referencia: `0052_treasury_permission_module.sql`; `ERP_A1_EXECUTION_PLAN.md`.

---

```text
RRHH R1

PLANNING COMPLETE
AWAITING EXECUTIVE APPROVAL
```

*Plan R1 — no se implementó, no se migró, no se escribió SQL/código, sin commit, producción intacta.*
*Detenido a la espera de autorización explícita de Dirección para intervenir `arsksytgdnzukbmfgkju`.*
