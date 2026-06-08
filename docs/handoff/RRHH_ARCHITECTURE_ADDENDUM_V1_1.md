# TOPS NEXUS — RRHH · ADDENDUM DE ARQUITECTURA v1.1

> **Propósito:** corregir los 6 hallazgos mayores de `RRHH_AUDIT_REPORT.md` para habilitar
> el paso de `REQUIRES DESIGN CORRECTIONS` → `ARCHITECTURE READY`.
> **Naturaleza:** addendum documental. **No** modifica el diseño original (v1.0), no implementa,
> no crea migraciones, no toca producción, sin commit. Las correcciones se consolidarán en el
> diseño base recién tras una nueva auditoría de cierre.
> **Relación:** complementa `RRHH_ARCHITECTURE_DESIGN.md` (v1.0). Donde haya conflicto, **este
> addendum prevalece**.
> **Fuente de verdad:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07. **Versión:** 1.1.

---

## 1. Resumen ejecutivo

La auditoría confirmó un diseño base sólido y no invasivo, con **0 hallazgos críticos** y
**6 mayores** que bloqueaban la implementación. Este addendum los resuelve por completo, con
correcciones de alcance acotado y, sobre todo, **maximizando la reutilización de infraestructura
ya productiva** en lugar de crear estructuras paralelas.

Cambios de fondo respecto de v1.0:

1. **RRHH deja de crear su propio repositorio documental.** Reutiliza la tabla `documents`, el
   bucket privado `documents`, los helpers de storage (SHA-256, signed URLs) y la auditoría
   `documents_audit` ya existentes. RRHH solo aporta una **tabla de vínculo** legajo↔documento.
2. **Modelo de roles disambiguado.** Se reconoce el sistema dual (`user_role_t` legacy vs tabla
   RBAC `roles`); RRHH extiende **solo** el RBAC moderno. Se elimina el rol `supervisor` (colisión);
   la aprobación de nivel 1 pasa a resolverse por **jerarquía** (`supervisor_id`), no por un rol.
3. **Roadmap de migraciones estrictamente monotónico** (`0056`→`0061`), sin saltos imposibles.
4. **Horas extra** pasa a ser una entidad/flujo explícito (subtipo del motor de solicitudes).
5. **Ausentismo** obtiene un denominador concreto: jornada esperada por empleado (`rrhh_jornada`)
   menos feriados. KPI calculable y no ambiguo.
6. **Máquina de estados completa**, con `cancelada` (retiro pre-aprobación por el solicitante) y
   `anulada` (reversión post-aprobación por RRHH, con contrapartida).

Como subproducto, la reutilización del módulo documental **también resuelve menores** del audit
(m2 documentación vencida → `documents.expires_at` ya existe; auditoría de acceso a recibos →
`documents_audit` ya existe).

---

## 2. Tabla de hallazgos corregidos

| Hallazgo | Estado v1.0 | Corrección v1.1 | Resultado |
|----------|-------------|-----------------|-----------|
| **M1** Duplicación documental | `rrhh_documentos` + buckets nuevos | Reutiliza `documents` + bucket `documents` + helpers + `documents_audit`; vínculo vía `rrhh_empleado_documentos` | ✅ Resuelto |
| **M2** Roles duales / colisión `supervisor` | Rol `supervisor` "nuevo" | RBAC-tabla único; roles `rrhh_admin`/`rrhh_manager`/`rrhh_viewer`/`employee_self_service`; L1 por jerarquía | ✅ Resuelto |
| **M3** Roadmap no monotónico | R1=0056+0060, R2=0057 | Secuencia `0056`→`0061` estrictamente creciente | ✅ Resuelto |
| **M4** Horas extra sin entidad | Solo aparece en diagrama/novedades | Subtipo `hora_extra` del motor de solicitudes + detalle + vínculo a novedades | ✅ Resuelto |
| **M5** Ausentismo sin denominador | "% sobre días hábiles" incalculable | `rrhh_jornada` (patrón) → días esperados; KPI definido | ✅ Resuelto |
| **M6** Cancelación incompleta | Solo `anulada` desde `aprobada` | `cancelada` (pre-aprobación) + `anulada` (post, con contrapartida) | ✅ Resuelto |
| m1 `depot` | "enum (MAGALDI/LUJAN)" ambiguo | Reutiliza `public.depot_t` (0001) | ✅ |
| m2 doc. vencida | sin `vence_el` | `documents.expires_at` (ya existe) | ✅ |
| m5 compliance↔salud | "excepción" sin base | base legal + registro documentado (§3.2) | ✅ |
| m6 mecanismo roles | sin aclarar | filas en `roles` (INSERT como 0009), no enum | ✅ |

---

## 3. Corrección propuesta por hallazgo

### M1 · Reutilización del módulo documental (sin duplicar)

**Infraestructura existente a reutilizar (verificada en código):**
- Tabla `public.documents` (`0010_documents.sql`): versionado (`document_group_id`/`version`/
  `is_current`), `document_type_t` (incluye `contrato`, `certificado`, `habilitacion`, `otro`),
  `depot depot_t`, `expires_at`, `file_hash` (SHA-256), soft-delete, índices FTS/GIN.
- Bucket **privado único** `documents` (CHECK `storage_bucket='documents'`).
- Helpers `src/lib/documental/storage.ts`: `fileHashSha256`, `buildDocPath`, `uploadDocument`,
  `getSignedUrl`, `removeDocument`.
- Auditoría `documents_audit` (append-only; acciones `create/view/download/update/delete/restore`).

**Lo que RRHH aporta (additivo, no invasivo):**

`rrhh_empleado_documentos` — **tabla de vínculo** (única estructura nueva de storage):
| Campo | Tipo | Nota |
|-------|------|------|
| `id` | uuid PK | |
| `empleado_id` | uuid FK → rrhh_empleados | |
| `document_id` | uuid FK → public.documents | el documento real vive en `documents` |
| `doc_class` | enum (`legajo`/`recibo_sueldo`/`adjunto_solicitud`) | clasificación RRHH |
| `solicitud_id` | uuid FK → rrhh_solicitudes | nullable (si es adjunto de solicitud) |
| `created_by` / `created_at` | audit | append-only |

**Decisiones clave:**
- **No** se crean buckets `rrhh-documentos`/`rrhh-recibos`. Todo va al bucket privado `documents`.
- **No** se crean `rrhh_documentos` ni `rrhh_recibo_accesos` (esta última la reemplaza
  `documents_audit`).
- Los recibos y documentación de legajo se cargan con los helpers existentes; en `documents`
  quedan con `type` apropiado (`certificado`/`contrato`/`otro`; opcionalmente se evalúa agregar
  un valor `recibo_sueldo` a `document_type_t` —additivo, migración de enum aislada— si la
  semántica lo amerita; por defecto se usa la clasificación en `doc_class` para **no** tocar el enum).
- **Control de acceso (clave para PII):** la RLS de `documents` es multi-tenant por `client_id`,
  **no** modela propiedad de empleado. Por eso el acceso a documentos RRHH (y especialmente
  recibos) se sirve **siempre vía RPC de RRHH** que verifica: `has_permission('rrhh:recibo.read.*')`
  **o** propiedad (`empleado.profile_id = auth.uid()`), y recién entonces emite el signed URL con
  `getSignedUrl`. La emisión queda registrada en `documents_audit` (acción `view`/`download`).

> **Resuelve además:** m2 (alerta "documentación vencida" → `documents.expires_at`) y la
> auditoría de acceso a recibos (→ `documents_audit`, no tabla nueva).

> **Nota de alcance:** agregar la FK `rrhh_empleado_documentos.document_id → documents(id)` y
> (opcional) un valor de enum a `document_type_t` son cambios **aditivos sobre infraestructura
> compartida**, no sobre los dominios protegidos (CRM/ERP-A/ERP-B/Operaciones/Compliance). No se
> modifican filas ni columnas existentes de `documents`.

---

### M2 · Modelo de roles disambiguado

**Realidad del sistema (verificada):** coexisten dos mecanismos de rol:
- `user_role_t` **enum legacy** (`0001_init.sql`): `('admin','operaciones','supervisor','cliente')`,
  en `profiles.role`.
- **RBAC moderno por tabla** `public.roles` (slug/name/description/color/is_system, `0009_rbac.sql`),
  sistema vivo con 7 roles (`director_ops, admin, comercial, operaciones, seguridad, compliance,
  cliente_b2b`) + `has_permission(slug)` / `current_role()` / `is_admin()`.

**Decisión:** RRHH extiende **exclusivamente el RBAC moderno por tabla**. **No** se agrega ningún
valor a `user_role_t` (enum legacy intacto). Se **elimina** el rol `supervisor` propuesto en v1.0
(colisiona con el valor `user_role_t.supervisor` y con la semántica existente).

**Roles RRHH definitivos (filas nuevas en `public.roles`, sembradas como en 0009):**

| Slug | Nombre | Alcance |
|------|--------|---------|
| `rrhh_admin` | Administrador RRHH | Control total: legajo, PII sensible (bancario/salud), recibos, baja, aprobación L2, reportes |
| `rrhh_manager` | Responsable RRHH | Gestión operativa: legajo, solicitudes, aprobación L2, novedades, horas extra; **sin** CBU ni salud sensible salvo lo estrictamente necesario |
| `rrhh_viewer` | Visor RRHH | Solo lectura: dashboard + reportes agregados; **sin** PII individual ni escritura (para `director_ops`/Dirección) |
| `employee_self_service` | Portal del empleado | Solo lo propio (perfil, solicitudes, mis recibos) |

**Aprobación de nivel 1 (ex-"supervisor") sin rol homónimo:** se resuelve por **jerarquía**, no
por rol. La RPC de aprobación L1 autoriza si el llamante es el supervisor directo del solicitante:

```
puede_aprobar_l1(caller, solicitud) :=
    caller.empleado.id = solicitud.empleado.supervisor_id
    AND has_permission('rrhh:solicitud.approve_l1')   -- otorgado a manager/admin y, si se
                                                       -- desea, a jefes vía grant puntual
```

> **Aclaración (m6):** los roles RRHH se crean con `INSERT INTO public.roles ...` +
> `role_permissions` (patrón idéntico a `0009_rbac.sql`). **No** son valores de enum.

Matriz rol × permiso actualizada (reemplaza §5.4 de v1.0):

| Permiso | employee_self_service | jefe (supervisor_id) | rrhh_viewer | rrhh_manager | rrhh_admin | director_ops/admin | compliance |
|---|---|---|---|---|---|---|---|
| empleado.read propio | ✅ | — | — | — | — | — | — |
| empleado.read equipo/todos | — | equipo | agregado | ✅ | ✅ | agregado | — |
| empleado.write/baja | — | — | — | parcial/✅ | ✅ | — | — |
| bancario.* 🔒 | propio | — | — | — | ✅ | — | — |
| solicitud.create | ✅ propio | — | — | ✅ | ✅ | — | — |
| solicitud.approve_l1 | — | ✅ equipo | — | ✅ | ✅ | — | — |
| solicitud.approve_l2 | — | — | — | ✅ | ✅ | — | — |
| solicitud.cancel | ✅ propio (pre-aprob.) | — | — | ✅ | ✅ | — | — |
| solicitud.anular (post-aprob.) | — | — | — | ✅ | ✅ | — | — |
| licencia.salud.read 🔒 | propio | — | — | — | ✅ | — | excepción (§3.2) |
| recibo.read.self | ✅ | — | — | — | — | — | — |
| recibo.read.all 🔒 | — | — | — | — | ✅ | — | — |
| recibo.upload | — | — | — | ✅ | ✅ | — | — |
| dashboard.read | — | — | ✅ | ✅ | ✅ | ✅ | — |
| audit.read | — | — | — | — | — | — | ✅ |

#### 3.2 (m5) Acceso de `compliance` a datos de salud
El acceso de `compliance` a documentación de salud (licencias/ART) es **excepcional y reglado**:
solo bajo necesidad documentada (investigación/auditoría), requiere `has_permission('rrhh:licencia.salud.read')`
otorgado de forma **temporal y nominal**, y **toda** lectura queda en `documents_audit` +
`rrhh_audit_log`. Base legal: deber de control interno; minimización y finalidad (Ley 25.326).
Por defecto `compliance` **no** tiene el permiso de salud; se concede por excepción y se revoca.

---

### M3 · Roadmap de migraciones (estrictamente monotónico)

Próxima libre verificada: **`0056`**. Regla de enum: todo `ALTER TYPE ... ADD VALUE` va en
migración **aislada y committeada** antes de su uso (patrón 0021/0029/0052).

| Mig | Nombre | Contenido | Gate |
|-----|--------|-----------|------|
| `0056` | `rrhh_permission_module` | `alter type permission_module_t add value 'rrhh'` (aislada) | R1 |
| `0057` | `rrhh_core` | enums `rrhh_*`; `rrhh_empleados`, `rrhh_empleado_bancario`, `rrhh_empleado_historial`, `rrhh_jornada`, `rrhh_vacaciones_reglas`, `rrhh_feriados`; RLS; triggers append-only; **RBAC seed** (permisos `rrhh:*` + roles nuevos + `role_permissions`) | R1/R2 |
| `0058` | `rrhh_workflows` | `rrhh_solicitudes` (incl. subtipo `hora_extra`), `rrhh_horas_extra_detalle`, `rrhh_solicitud_eventos`, `rrhh_novedades`; `rrhh_empleado_documentos` (vínculo a `documents`); RLS; triggers de inmutabilidad | R5 |
| `0059` | `rrhh_views` | vistas derivadas (`rrhh_v_antiguedad`, `_vacaciones_saldo`, `_ausentismo`, `_dotacion`, `_calendario`, `_dashboard_kpis`) | R5/R9 |
| `0060` | `rrhh_functions` | RPCs `security definer` (solicitar/aprobar L1/L2/rechazar/**cancelar**/**anular**), guards `rrhh.via_rpc`, RPC de signed URLs RRHH | R6 |
| `0061` | `rrhh_storage_integration` | políticas de acceso a documentos/recibos vía `documents`/`documents_audit`; (opcional, en `0061a` aislada si se decide) `alter type document_type_t add value 'recibo_sueldo'` | R8 |

Monotónico, sin saltos. El RBAC seed se adelanta a `0057` (solo depende del enum `0056` y de la
tabla `roles` existente), eliminando la contradicción de v1.0 (que lo ponía en `0060` bajo R1).

> Si se decide extender `document_type_t`, esa única instrucción de enum va **aislada** en su
> propia migración (`0061a_rrhh_doctype_enum`) antes de `0061`, por la regla de enums. Por
> defecto se evita usando `doc_class` en la tabla de vínculo (no requiere tocar el enum).

---

### M4 · Horas extra — entidad y workflow explícitos

**Enfoque (máxima reutilización):** horas extra es un **subtipo del motor de solicitudes**, no un
módulo aparte. Se agrega `hora_extra` al enum `rrhh_solicitudes.tipo` y se añade un detalle:

`rrhh_horas_extra_detalle`
| Campo | Tipo | Nota |
|-------|------|------|
| `solicitud_id` | uuid FK → rrhh_solicitudes | 1:1 con la solicitud tipo `hora_extra` |
| `fecha` | date | día de la hora extra |
| `cantidad_horas` | numeric(5,2) | horas trabajadas extra |
| `recargo` | enum (`al_50`/`al_100`) | LCT art. 201 (50% días comunes / 100% sáb. tarde, dom., feriados) |
| `motivo` | text | |
| `origen` | enum (`carga_supervisor`/`solicitud_empleado`/`fichaje`) | trazabilidad del origen |

Campos comunes (empleado, supervisor por jerarquía, estado, aprobador, eventos) viven en
`rrhh_solicitudes` + `rrhh_solicitud_eventos` — **se reutiliza el mismo workflow, cancelación y
auditoría**.

**Workflow:** `Carga (supervisor o empleado) → aprobación → confirmación`. Al **aprobar** →
INSERT en `rrhh_novedades` (`tipo='hora_extra'`, `cantidad=cantidad_horas`,
`origen_solicitud_id`). Append-only; corrección por contrapartida.

**Límite duro:** RRHH **registra** la novedad de horas extra; **no liquida** ni calcula el monto.
El recargo (`al_50`/`al_100`) es metadato para la liquidación externa, no un cálculo de importe.

> Alternativa evaluada (tabla `rrhh_horas_extra` independiente con su propia máquina de estados):
> descartada por duplicar workflow/eventos/cancelación. El subtipo unificado es más consistente
> con Nexus ("no duplicar").

---

### M5 · Ausentismo — denominador definido

**Causa raíz:** v1.0 no tenía jornada/calendario laboral; el "% sobre días hábiles" era incalculable.

**Corrección — `rrhh_jornada`** (patrón de jornada por empleado, con vigencia):
| Campo | Tipo | Nota |
|-------|------|------|
| `empleado_id` | uuid FK | |
| `dias_semana` | int[] | días laborables (1=Lun … 7=Dom), p.ej. `{1,2,3,4,5}` o `{1..6}` |
| `horas_dia` | numeric(4,2) | jornada diaria esperada |
| `tipo_turno` | enum (`fijo`/`rotativo`) | flota/depósito puede ser rotativo |
| `vigente_desde` | date | append-only (historial de jornada) |

**Definición del KPI (reemplaza la de §6 v1.0):**

```
días_esperados(empleado, período) =
    Σ días del período que caen en jornada.dias_semana
    − feriados aplicables (rrhh_feriados, nacional o del depot)

días_ausencia(empleado, período) =
    Σ días de solicitudes APROBADAS con computa_ausentismo = true
      que intersectan el período

Ausentismo% = días_ausencia / NULLIF(días_esperados, 0) × 100
```

La vista `rrhh_v_ausentismo` se redefine sobre `rrhh_jornada` + `rrhh_feriados` +
`rrhh_solicitudes`. El flag `computa_ausentismo` (ya en el modelo) decide qué ausencias entran al
numerador (p.ej. vacaciones NO computa; inasistencia injustificada SÍ). KPI **calculable y no
ambiguo**, con fuente explícita para cada término.

> Si un empleado no tiene `rrhh_jornada` cargada, la vista lo excluye del % y lo lista como
> "jornada no definida" (no produce un número engañoso).

---

### M6 · Máquina de estados completa (cancelación)

**Estados:** `borrador`, `pendiente_supervisor`, `pendiente_rrhh`, `aprobada`, `rechazada`,
`cancelada`, `anulada`.

```
  [borrador] ──(solicitante cancela)──────────────► [cancelada]
      │ empleado envía
      ▼
  [pendiente_supervisor] ──(supervisor rechaza)───► [rechazada]
      │   │ supervisor aprueba                └─(solicitante cancela)─► [cancelada]
      │   ▼
      │ [pendiente_rrhh] ──(RRHH rechaza)──────────► [rechazada]
      │       │ RRHH aprueba         └─(solicitante cancela)─► [cancelada]
      │       ▼
      │   [aprobada] ──(RRHH anula, con motivo + contrapartida)──► [anulada]
      │
      └ (licencia enfermedad/ART: entrada directa a [pendiente_rrhh] — arista alternativa, m7)
```

**Reglas de cancelación/anulación por estado:**

| Desde | Acción | Actor | Permiso | Efectos |
|-------|--------|-------|---------|---------|
| `borrador` | cancelar | solicitante | `rrhh:solicitud.cancel` | → `cancelada`. Sin efectos downstream. |
| `pendiente_supervisor` / `pendiente_rrhh` | cancelar (retiro pre-aprobación) | solicitante | `rrhh:solicitud.cancel` | → `cancelada` + evento + notifica al aprobador pendiente. Sin novedades (aún no había). |
| `aprobada` | **anular** (reversión post-aprobación) | `rrhh_manager`/`rrhh_admin` | `rrhh:solicitud.anular` | → `anulada` con `motivo`; **contrapartida append-only** en `rrhh_novedades`; **restituye saldo** de vacaciones; **quita** del calendario. |

- `cancelada` ≠ `anulada`: la primera es retiro del solicitante **antes** de aprobar (sin huella
  en novedades); la segunda es reversión **después** de aprobar (con contrapartida y restitución).
- Todas las transiciones por **RPC** `security definer` (guard `rrhh.via_rpc`, `FOR UPDATE`,
  evento en `rrhh_solicitud_eventos`). Nunca UPDATE directo.
- Estados terminales: `rechazada`, `cancelada`, `anulada` (no admiten más transiciones).

> Resuelve también m7: la arista de entrada alternativa de licencias enfermedad/ART queda
> explícita en el diagrama.

---

## 4. Impacto sobre el diseño original (v1.0)

| Sección v1.0 | Impacto | Detalle |
|--------------|---------|---------|
| §1.2 flujo | Menor | Horas extra ahora es subtipo de solicitudes (no caja suelta) |
| §2.2 roadmap | **Reemplazada** | Por §3·M3 de este addendum |
| §2.3 storage | **Reemplazada** | No crea buckets; reutiliza `documents` (§3·M1) |
| §3.1 `rrhh_documentos` | **Eliminada** | Sustituida por `rrhh_empleado_documentos` (vínculo) |
| §3.1 `depot` | Aclarada | Reutiliza `public.depot_t` |
| §3.3 solicitudes | Ampliada | `tipo` incluye `hora_extra`; nuevo `rrhh_horas_extra_detalle` |
| §3.1 (nuevo) `rrhh_jornada` | **Agregada** | Denominador de ausentismo (§3·M5) |
| §3.5 `rrhh_recibos`/`rrhh_recibo_accesos` | **Reemplazadas** | Recibos viven en `documents`; auditoría en `documents_audit` |
| §3.8 `rrhh_v_ausentismo` | Redefinida | Usa `rrhh_jornada` (§3·M5) |
| §4.1 máquina de estados | **Reemplazada** | Por §3·M6 (cancelada/anulada) |
| §5.2 roles | **Reemplazada** | Sin `supervisor`; 4 roles RBAC nuevos (§3·M2) |
| §5.4 matriz | **Reemplazada** | Por matriz de §3·M2 |
| §6 KPI ausentismo | Corregida | Definición calculable (§3·M5) |

> Estos cambios **no** se aplican aún al documento v1.0 (instrucción explícita). Se consolidarán
> en una v1.1 del diseño base **después** de la auditoría de cierre.

---

## 5. Roadmap actualizado

| Gate | Alcance | Migraciones | Depende de |
|------|---------|-------------|------------|
| **R0** | Aprobación diseño + addendum v1.1 | — | — |
| **R1** | Enum módulo + RBAC seed (roles/permisos `rrhh:*`) | `0056`, parte de `0057` | R0 |
| **R2** | Legajo digital + jornada + reglas + feriados | `0057` | R1 |
| **R3** | Backend legajo (`src/lib/rrhh/*`) + integración storage `documents` | — (usa `0057`/`0061`) | R2 |
| **R4** | UI legajo + portal mínimo ("mi perfil") | — | R3 |
| **R5** | Motor de ausencias + horas extra (datos) | `0058` | R2 |
| **R6** | Workflow (RPCs: solicitar/aprobar/rechazar/cancelar/anular) + UI ausencias | `0060` | R5 |
| **R7** | Calendario corporativo | (vistas `0059`) | R5 |
| **R8** | Recibos sobre `documents` + "mis recibos" + carga admin | `0061` (+`0061a` opcional) | R3 |
| **R9** | Dashboard + reportes (vistas KPI, ausentismo con jornada) | `0059` | R5–R8 |
| **R10** | Hardening PII + auditoría + prueba de acceso | — | todos |

Orden crítico sin cambios: **R1 → R2 → R3** primero; ausencias (R5–R7) y recibos (R8) en
paralelo tras R3; dashboard (R9) al final.

---

## 6. Veredicto final

> ## `READY FOR CLOSURE RE-AUDIT`

Los **6 hallazgos mayores están resueltos** con correcciones acotadas y orientadas a reutilizar
infraestructura existente (no a crear más). Se resolvieron además los menores conectados
(m1, m2, m5, m6) y se explicitó m7. El diseño queda **listo para una nueva auditoría de cierre**.

Este addendum **no** otorga por sí mismo el sello `ARCHITECTURE READY`: ese veredicto lo emite la
auditoría de cierre (§7), no el autor de la corrección.

---

## 7. Criterio para pasar a `ARCHITECTURE READY`

La re-auditoría de cierre debe verificar, y solo entonces declarar `ARCHITECTURE READY`, que:

1. **M1** — el diseño no define buckets ni tablas de documentos propias; usa `documents` +
   `documents_audit` + helpers; el vínculo es `rrhh_empleado_documentos`; el acceso a recibos
   se sirve por RPC RRHH con verificación de propiedad/permiso. ✅ esperado.
2. **M2** — no se agrega valor a `user_role_t`; los roles RRHH son filas en `roles`; no existe rol
   `supervisor`; L1 se autoriza por `supervisor_id`. ✅ esperado.
3. **M3** — la secuencia `0056`→`0061` es estrictamente monotónica; cada `ALTER TYPE` está aislado
   y committeado antes de su uso. ✅ esperado.
4. **M4** — horas extra tiene entidad (`subtipo` + `rrhh_horas_extra_detalle`), workflow,
   aprobación y vínculo a novedades; sin liquidar. ✅ esperado.
5. **M5** — el KPI de ausentismo tiene denominador derivable (`rrhh_jornada` − feriados) y numerador
   definido por `computa_ausentismo`; sin ambigüedad. ✅ esperado.
6. **M6** — la máquina de estados contempla `cancelada` (pre-aprobación) y `anulada` (post, con
   contrapartida y restitución); sin estados imposibles; transiciones solo por RPC. ✅ esperado.
7. **No regresión** — se mantienen los principios v1.0 conformes (RPC-First, RBAC, RLS≤RBAC,
   append-only, auditoría, vistas, no invasión de dominios, PII-first).

Cumplidos los 7 → **`ARCHITECTURE READY`** y habilitación de la Fase R1 (siempre con aprobación
explícita; este addendum no autoriza implementación).

---

*Fin del addendum v1.1. Documental — no se implementó, no se migró, no se tocó producción, sin commit.*
