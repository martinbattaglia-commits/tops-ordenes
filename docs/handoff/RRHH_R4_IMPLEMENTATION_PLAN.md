# TOPS NEXUS — RRHH · R4 IMPLEMENTATION PLAN
## R4 — WORKFLOW FOUNDATION · `0059_rrhh_workflows`

> **Estado:** PLAN — **pendiente de aprobación de Dirección**. **No** se implementa, **no** se migra,
> **no** se escribe SQL final, **no** se commitea, **no** se toca producción.
> **Regla del gate:** "Implementación solo después de aprobar el plan" (Dirección).
> **Modelo:** `RRHH_MASTER_ARCHITECTURE_v2_0.md` §6 (workflow) + `RRHH_R2_ARCHITECTURE_AMENDMENT.md`
> §3 (aprobaciones por permiso grueso + jerarquía).
> **Nota:** la autorización R4 llegó cortada en "cero" (criterio de éxito); se asume "cero críticos /
> cero mayores" como en R1–R3. Confirmar.
> **Producción:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07.

---

## 0. Auditoría inicial (verificado contra el repo)
| Ítem | Resultado |
|------|-----------|
| Tablas RRHH (0058) | ✅ `rrhh_empleados` (con `supervisor_id`), `rrhh_empleado_bancario`, `rrhh_empleado_historial` |
| Constraints | ✅ dni/cuil unique, no_self_supervisor, baja_chk |
| RLS | ✅ activa, `has_permission`+propiedad, fail-closed (FD-4/FD-5) |
| RBAC | ✅ `rrhh.view/create/edit/export/admin` + roles (0057) |
| Patrón workflow | ✅ CRM status-enums (`crm_quote_status_t`, default `'borrador'`) |
| Patrón transición | ✅ RPCs `confirm_*`/`anular_*`/`*_void_*` + guard `via_rpc` (treasury 0054) |
| Patrón trazabilidad | ✅ event-trail append-only (`po_events`: id/FK/ts/kind/actor/meta) |

**Próximo nº de migración libre:** `0059` (verificar al ejecutar).

---

## 1. Objetivo y alcance
Implementar la **capa de workflow** de RRHH: solicitudes (vacaciones/permisos/licencias/horas extra),
máquina de estados, aprobaciones (L1 jerárquica + L2 RRHH), trazabilidad y generación de novedades.
**Sin** UI, buckets, storage, recibos, integración salarial ni firma digital. **No** avanza a R5.

---

## 2. Modelo de datos (diseño; SQL en `0059` tras aprobación)

### 2.1 Enums
- `rrhh_solicitud_tipo_t` = `vacaciones` · `permiso` · `licencia` · `hora_extra`.
- `rrhh_solicitud_estado_t` = `borrador` · `pendiente_supervisor` · `pendiente_rrhh` · `aprobada` ·
  `rechazada` · `cancelada` · `anulada`.
- `rrhh_permiso_subtipo_t` = `inasistencia` · `llegada_tarde` · `retiro_anticipado` · `medico` ·
  `estudio` · `otro`.
- `rrhh_licencia_subtipo_t` = `enfermedad` · `maternidad` · `paternidad` · `art` · `especial`.
- `rrhh_recargo_t` = `al_50` · `al_100`.
- `rrhh_novedad_tipo_t` = `hora_extra` · `vacaciones` · `licencia` · `permiso` · `ausencia` · `llegada_tarde`.
- `rrhh_evento_accion_t` = `crear` · `enviar` · `aprobar_l1` · `aprobar_l2` · `rechazar` · `cancelar` · `anular`.

### 2.2 `rrhh_solicitudes` (madre del workflow)
`id` uuid PK · `public_id` (SOL-YYYY-NNNNNN) · `empleado_id` FK→rrhh_empleados · `tipo` · `subtipo`
(text/FK según tipo) · `fecha_desde` · `fecha_hasta` · `cantidad_dias` numeric · `motivo` ·
`estado rrhh_solicitud_estado_t default 'borrador'` · `requiere_doc` bool · `con_goce` bool ·
`computa_ausentismo` bool · audit cols (`created_*`/`updated_*`). UPDATE solo de `estado` vía RPC.

### 2.3 `rrhh_horas_extra_detalle` (1:1 con solicitud tipo `hora_extra`)
`solicitud_id` FK unique · `fecha` · `cantidad_horas` numeric(5,2) · `recargo rrhh_recargo_t` ·
`origen` (carga_supervisor/solicitud_empleado/fichaje). **Recargo = metadato; sin importe (no liquida).**

### 2.4 `rrhh_solicitud_eventos` (append-only — trazabilidad; patrón `po_events`)
`id` bigserial · `solicitud_id` FK · `ts` · `accion rrhh_evento_accion_t` · `actor_id` ·
`nivel` (supervisor/rrhh/empleado) · `comentario` · `meta` jsonb. **Inmutable** (forbid delete/update).

### 2.5 `rrhh_novedades` (append-only — núcleo de liquidación futura)
`id` · `empleado_id` · `periodo` (YYYY-MM) · `tipo rrhh_novedad_tipo_t` · `cantidad` numeric ·
`origen_solicitud_id` FK · `confirmada` bool · audit. **Inmutable**; corrección por contrapartida.

> Fuera de R4: `rrhh_jornada`/`rrhh_vacaciones_reglas`/`rrhh_feriados` (van con cálculo de saldos en
> gate de vistas/KPIs); documentos/recibos/buckets (R-storage); UI (R5+).

---

## 3. Máquina de estados y transiciones válidas

```
[borrador] ──(empleado: cancelar)──────────────────────────► [cancelada]
   │ empleado: enviar
   ▼
[pendiente_supervisor] ─(supervisor: rechazar)─► [rechazada]
   │   │ supervisor: aprobar_l1            └─(empleado: cancelar)─► [cancelada]
   │   ▼
   │ [pendiente_rrhh] ─(rrhh: rechazar)─► [rechazada]
   │      │ rrhh: aprobar_l2        └─(empleado: cancelar)─► [cancelada]
   │      ▼
   │   [aprobada] ─(rrhh: anular + contrapartida + restitución)─► [anulada]
   │
   ├─ licencia enfermedad/ART/maternidad/paternidad → entrada directa a [pendiente_rrhh]
   └─ hora_extra (origen carga_supervisor) → entra en [pendiente_rrhh] (L1 implícito por el jefe)
```

### 3.1 Tabla de transiciones (validadas en RPC)
| Desde | Acción | Actor | Autorización | Efectos |
|-------|--------|-------|--------------|---------|
| (nuevo) | crear | empleado / rrhh | propiedad **o** `rrhh.create` | inserta en `borrador` + evento `crear` |
| borrador | enviar | empleado (dueño) | propiedad | → `pendiente_supervisor` (o `pendiente_rrhh` si licencia/OT-supervisor) + evento |
| borrador / pendiente_* | cancelar | empleado (dueño) | propiedad | → `cancelada` + evento; sin novedades |
| pendiente_supervisor | aprobar_l1 | supervisor | `caller.empleado.id = solicitud.empleado.supervisor_id` | → `pendiente_rrhh` + evento |
| pendiente_supervisor | rechazar | supervisor | jerarquía | → `rechazada` + evento |
| pendiente_rrhh | aprobar_l2 | RRHH | `coalesce(has_permission('rrhh.edit'),false)` | → `aprobada` + evento + **genera novedad** |
| pendiente_rrhh | rechazar | RRHH | `rrhh.edit` | → `rechazada` + evento |
| aprobada | anular | RRHH | `rrhh.edit` | → `anulada` + evento + **contrapartida** en novedades + restitución de saldo |

- **Reglas de negocio en RPC:** validar solapamiento de fechas; exigir `requiere_doc` antes de
  `aprobada` (la doc se adjunta en gate de storage — aquí solo el flag); validar saldo de vacaciones
  (cuando exista el cálculo; en R4 se valida estructura, el saldo llega con vistas).
- **Estados terminales:** `rechazada`, `cancelada`, `anulada`.
- **Horas extra:** `registrar` → (validar_supervisor) → `validar_rrhh` → al validar genera novedad
  `tipo='hora_extra'` (`cantidad=cantidad_horas`). Sin liquidación.

---

## 4. Ownership, supervisor_id y trazabilidad
- **Ownership:** `rrhh_empleados.profile_id = auth.uid()` — el empleado opera solo sus solicitudes.
- **L1 (supervisor):** por jerarquía `supervisor_id` (no por rol); el RPC verifica
  `caller_empleado.id = solicitud.empleado.supervisor_id`.
- **L2 (RRHH):** `coalesce(has_permission('rrhh.edit'), false)`.
- **Trazabilidad:** cada transición escribe en `rrhh_solicitud_eventos` (append-only) → historial 100%
  reconstruible. Novedades append-only; anulación por contrapartida.

---

## 5. Seguridad (RLS/RBAC/fail-closed/append-only — sin excepciones)
- **RLS `rrhh_solicitudes` (read):** `coalesce(has_permission('rrhh.view'),false)` **o** dueño
  (`empleado.profile_id=auth.uid()`) **o** supervisor (`caller_empleado.id = empleado.supervisor_id`).
- **RLS escritura:** **solo vía RPC** (`security definer`, guard `set_config('rrhh.via_rpc','on')`,
  `FOR UPDATE`, fail-closed `coalesce(...)`); RLS directa restringe a `rrhh.admin`/service_role.
- **`rrhh_solicitud_eventos` / `rrhh_novedades`:** read `has_permission('rrhh.view')`; **append-only**
  (`tg_forbid_delete_rrhh` + `tg_forbid_update_rrhh`); escritura solo por los RPC.
- **Sin `current_role()`** (FD-5). **Fail-closed** (FD-4). **Append-only** (FD-10). **RPC-First** (D-Nexus).
- **Operaciones / otros sin `rrhh.*`:** acceso nulo.

> **Decisión a confirmar:** R4 incluye los **RPCs de transición** (necesarios para "aprobaciones").
> Recomendado: sí, en `0059` (RPC-First). Alternativa: `0059` tablas/estados + `0059b` RPCs. Elegir.

---

## 6. Migración propuesta `0059_rrhh_workflows`
Enums + 4 tablas + secuencia public_id + índices + RLS + triggers append-only + **RPCs de transición**
(crear/enviar/aprobar_l1/aprobar_l2/rechazar/cancelar/anular + horas extra). **Sin** UI/storage/recibos.
Idempotente. Patrón: CRM (estados) + treasury (`via_rpc`, RPCs) + `po_events` (trazabilidad).

---

## 7. Riesgos
| Tipo | Riesgo | Sev. | Mitigación |
|------|--------|------|-----------|
| Seguridad | Transición saltando workflow (UPDATE directo de estado) | Alta | Escritura solo por RPC + guard `via_rpc` + RLS admin-only |
| Seguridad | Aprobación por quien no es supervisor | Alta | RPC valida `supervisor_id`; L2 `coalesce(has_permission)` |
| Integridad | Doble novedad / novedad sin aprobación | Media | Novedad solo en `aprobar_l2`/`validar_rrhh`; append-only + `origen_solicitud_id` |
| Integridad | Estados imposibles | Media | Transiciones validadas en RPC + enum acotado |
| Negocio | Tentación de liquidar | Alta | Recargo = metadato; sin importes (FD-8) |
| Técnico | Solapamiento de fechas | Media | Validación en RPC |
| Producción | Aplicar sin backup | Alta (si se omite) | Preflight: backup + orden 0056→…→0059 + ventana + operador |

## 8. Rollback
- **Antes de aplicar:** descartar el archivo (sin efecto en prod).
- **Tras aplicar:** las tablas/enums/RPCs son **nuevos** y sin datos → "rollback" = `drop` de objetos
  RRHH de workflow (en orden inverso de FK), sin impacto en otros dominios. Append-only impide pérdida
  silenciosa de evidencia ya cargada. (Detalle de `drop` se incluye en el paquete de despliegue.)

## 9. Criterios de aceptación
- Enums + 4 tablas + RPCs creados; RLS activa; append-only en eventos/novedades.
- Toda transición pasa por RPC fail-closed; `current_role()` ausente.
- Máquina de estados sin estados huérfanos ni transiciones imposibles.
- L1 por `supervisor_id`; L2 por `rrhh.edit`; cancelación por propiedad; anulación con contrapartida.
- Novedad generada solo al aprobar/validar; sin liquidación.
- 0 objetos fuera de alcance (sin UI/buckets/storage/recibos).
- Auditoría R4 PASS (0 críticos / 0 mayores).

## 10. Entregables del gate
`RRHH_R4_IMPLEMENTATION_PLAN.md` (este) → aprobación → `0059_rrhh_workflows.sql` →
`RRHH_R4_IMPLEMENTATION_REPORT.md` · `RRHH_R4_AUDIT_REPORT.md` · `RRHH_R4_CLOSURE_REPORT.md`.

---

## 11. GO / NO-GO
**NO-GO** hasta: (a) **aprobación de este plan** por Dirección; (b) confirmar si los RPCs van en
`0059` (recomendado) o se separan; (c) confirmar el criterio de éxito truncado ("cero…"). Luego:
Implementación → Auditoría → Verificación prod → Cierre.

---
```text
RRHH R4

PLAN COMPLETE
AWAITING PLAN APPROVAL
(no SQL, no migración, no producción)
```
