# TOPS NEXUS — RECURSOS HUMANOS (RRHH)
## Master Architecture · v2.0 (documento consolidado y definitivo)

> **Estado:** `ARCHITECTURE READY` · `ARCHITECTURE FROZEN` · `READY FOR IMPLEMENTATION`.
> **Implementación:** NO autorizada hasta aprobación explícita de Dirección. Cero código, cero
> migraciones, producción intacta.
> **Consolidación:** unifica v1.0 + v1.1 + v1.2 + v1.2.1. **Ante conflicto, prevalece la versión
> más alta.** Reemplaza a todos los addenda previos como **fuente única de diseño**. Los
> documentos históricos quedan como traza de auditoría.
> **Fuente de verdad:** Supabase productivo `arsksytgdnzukbmfgkju`. Nunca staging/sandbox.
> **Empresa:** Logística TOPS — Verotin S.A. (CUIT 33-60489698-9). **Fecha:** 2026-06-07.

---

## 1. Executive Summary

RRHH es el último gran dominio funcional de TOPS Nexus; cierra el ciclo operativo del sistema.
Reemplaza la gestión manual actual (papel, Excel, PDFs sueltos) por un modelo enterprise (estilo
SuccessFactors / Workday / BambooHR) adaptado a una operación logística 3PL argentina, construido
**100% sobre la arquitectura productiva real de Nexus**.

El dominio atravesó un ciclo completo de diseño → auditoría adversarial → remediación → validación,
que detectó y cerró dos defectos reales (exposición de PII por reutilizar `documents`; *fail-open*
en la autorización de signed URLs). La auditoría definitiva cerró con **0 críticos y 0 mayores** →
`ARCHITECTURE READY`.

**Pilares (definitivos):**
1. **Legajo digital** como fuente de verdad del empleado (distinto de `profiles`).
2. **Motor de ausencias** (vacaciones/permisos/licencias/horas extra) con workflow multinivel y
   reglas LCT 20.744 embebidas y parametrizadas en la base.
3. **Núcleo de novedades** como insumo de una liquidación externa (RRHH **no liquida**).
4. **Almacén documental RRHH dedicado** (recibos/legajo/salud), aislado, con acceso RPC auditado.
5. **Seguridad PII-first**: RBAC + propiedad, fail-closed, sin `current_role()`.
6. **Portal del empleado** y **dashboard ejecutivo**.

**Límites duros:** RRHH no liquida sueldos, no reemplaza el sistema contable, no calcula impuestos
ni genera asientos. Es legajo + workflow + repositorio + reportería.

---

## 2. Arquitectura funcional

| # | Submódulo | Propósito | Consume | Alimenta |
|---|-----------|-----------|---------|----------|
| 1 | **Dashboard** | Vista ejecutiva (Dirección) | Todos (vistas) | — |
| 2 | **Empleados (Legajo)** | Fuente de verdad del empleado | `profiles`, RBAC | Todos |
| 3 | **Vacaciones** | Saldos por antigüedad + solicitud + aprobación | Legajo (antigüedad) | Novedades, Calendario |
| 4 | **Permisos** | Inasistencia/llegada tarde/retiro/médico/estudio/familiar/trámite/otro | Legajo | Novedades, Calendario |
| 5 | **Licencias** | Enfermedad/ART/maternidad/paternidad/especial/sin goce + doc. | Legajo | Novedades, Calendario |
| 6 | **Novedades** | Registro del período (núcleo de liquidación futura) | 3,4,5,7 | Reportes, export |
| 7 | **Horas Extra** | Captura + aprobación de OT (subtipo de solicitud) | Legajo | Novedades |
| 8 | **Recibos** | Repositorio documental de recibos | Carga administrativa | Portal empleado |
| 9 | **Calendario** | Cobertura operativa transversal | 3,4,5 + feriados | Dashboard |
| 10 | **Reportes** | Ausentismo/vacaciones/antigüedad/dotación/OT/permisos/licencias | Todos | Export PDF/XLSX |

**Detalle:**
- **Dashboard:** dotación, activos, ausentismo (mes/YTD), vacaciones (en curso/pendientes/saldo/por
  caducar art.157), licencias activas por tipo, permisos del mes, antigüedad promedio, alertas
  (doc. vencida, licencias por vencer, solicitudes estancadas). Todo desde vistas derivadas.
- **Empleados (Legajo):** datos personales (PII), laborales, bancarios (PII), obra social,
  documentación, historial append-only. Vínculo opcional 1:0..1 a `profiles` para portal.
- **Vacaciones:** derecho por antigüedad (LCT Art.150: 14/21/28/35 días; <6 meses proporcional),
  saldo disponible/usado/pendiente, caducidad (art.157). Cálculo en base, reglas parametrizadas.
- **Permisos / Licencias:** tipos configurables (con/sin goce, requiere doc., computa ausentismo);
  documentación obligatoria según subtipo; licencias de salud con trato reforzado (Ley 25.326).
- **Novedades:** registro inmutable del período (horas extra, vacaciones, licencias, permisos,
  ausencias, llegadas tarde). Insumo de liquidación externa.
- **Horas Extra:** captura (supervisor/empleado/fichaje), recargo al_50/al_100 (LCT art.201, **como
  metadato**, sin calcular importe), aprobación, → novedad.
- **Recibos:** repositorio (visualizar/descargar/buscar/filtrar). Empleado → los propios;
  Administración → todos. No liquida; solo almacena/indexa/sirve/audita.
- **Calendario:** vacaciones + licencias + permisos + ausencias + feriados (nacionales + empresa),
  filtrable por depósito (MAGALDI/LUJAN) y sección, para visualizar cobertura.
- **Reportes:** derivados de vistas; export PDF/XLSX; sin recálculo en cliente.

---

## 3. Arquitectura técnica

RRHH replica los patrones vivos en producción (verificados contra `tesoreria` 0052–0055, `crm`
0041–0051, `custody` 0036–0039, RBAC 0009):

| Patrón Nexus | Aplicación RRHH |
|--------------|-----------------|
| **RPC-First** | Toda mutación por RPC `security definer` con guard `coalesce(has_permission, false)` + `set_config('rrhh.via_rpc','on')` + `FOR UPDATE`. Nunca SQL de escritura directo. |
| **RBAC** | Roles en tabla `roles`; permisos `rrhh.*` (notación con punto); helper `has_permission(slug)`. |
| **RLS ≤ RBAC** | Lectura por RLS (propiedad o `has_permission`); escritura fina solo por RPC. |
| **Append-Only** | `tg_forbid_delete_rrhh` en tablas de evento/PII; anulación lógica con `voided_at/by/reason`; corrección por contrapartida. |
| **Auditoría** | `rrhh_audit_log` (transversal) + `rrhh_document_audit` (acceso a PII documental), append-only. |
| **Vistas derivadas** | Saldos, antigüedad, ausentismo, dotación, calendario, KPIs → **vistas SQL**. Ningún cálculo en TS. |
| **Capa lib** | `src/lib/rrhh/{types,data,actions,validation,errors}.ts`. `actions` invoca RPC; nunca SQL de escritura. |
| **UI** | Next.js App Router, `src/app/(app)/rrhh/…`. |
| **Storage PII** | Patrón Custody (GATE 5): buckets privados dedicados + RPC de acceso auditada. |

---

## 4. Modelo de datos (consolidado, sin referencias obsoletas)

> Prefijo `rrhh_`. PII marcada 🔒. Tipos finales (precision/nullability) se fijan en migración.

### 4.1 Legajo
- **`rrhh_empleados`**: `id` · `public_id` (legajo) · `profile_id` FK→profiles (nullable, 1:0..1) ·
  `apellido_nombre`🔒 · `dni`🔒 (único) · `cuil`🔒 (único) · `fecha_nacimiento`🔒 ·
  `domicilio/telefono/email_personal`🔒 · `estado_civil` · `contacto_emergencia`🔒 jsonb ·
  `fecha_ingreso` · `fecha_reconocida` (antigüedad) · `categoria/seccion/calificacion` · `convenio` ·
  `modalidad_contratacion` · `depot public.depot_t` (**reutiliza enum de 0001**) · `supervisor_id`
  FK→rrhh_empleados · `obra_social` · `estado` (activo/licencia/baja) · `fecha_baja/motivo_baja` ·
  audit cols.
- **`rrhh_empleado_bancario`**: `empleado_id` · `banco` · `cbu`🔒 · `cuenta`🔒 · `vigente_desde`.
  Append-only; RLS más estricta.
- **`rrhh_empleado_historial`** (append-only): cambios de **atributos de legajo** (categoría,
  remuneración asignada, supervisor, sección) — `campo`, `valor_anterior/nuevo`, `vigente_desde`,
  `changed_by`. (No duplica ausencias/licencias, que viven en solicitudes/novedades.)
- **`rrhh_jornada`**: `empleado_id` · `dias_semana int[]` · `horas_dia` · `tipo_turno`
  (fijo/rotativo) · `vigente_desde`. Base del denominador de ausentismo.

### 4.2 Reglas
- **`rrhh_vacaciones_reglas`**: `antiguedad_desde_meses` · `antiguedad_hasta_meses` ·
  `dias_corridos` · `vigente_desde`. Sembrado con LCT Art.150. Cambio normativo = INSERT.
- **`rrhh_feriados`**: `fecha` · `nombre` · `tipo` (nacional/empresa) · `depot` (nullable).

### 4.3 Motor de ausencias
- **`rrhh_solicitudes`**: `id` · `public_id` · `empleado_id` · `tipo`
  (`vacaciones`/`permiso`/`licencia`/`hora_extra`) · `subtipo` · `fecha_desde/hasta` ·
  `cantidad_dias` · `motivo` · `estado` (ver §6) · `requiere_doc` · `con_goce` ·
  `computa_ausentismo` · audit cols.
- **`rrhh_horas_extra_detalle`** (1:1 con solicitud tipo `hora_extra`): `solicitud_id` · `fecha` ·
  `cantidad_horas` · `recargo` (al_50/al_100) · `origen` (carga_supervisor/solicitud_empleado/
  fichaje).
- **`rrhh_solicitud_eventos`** (append-only): `solicitud_id` · `accion` · `actor_id` · `nivel` ·
  `comentario` · `created_at`. Inmutable.
- **`rrhh_solicitud_documentos`**: adjuntos de solicitud (certificado médico🔒, ART🔒) → bucket
  `rrhh-health`/`rrhh-legajo`, vía almacén documental RRHH (§5).
- **`rrhh_novedades`** (append-only): `empleado_id` · `periodo` (YYYY-MM) · `tipo`
  (hora_extra/vacaciones/licencia/permiso/ausencia/llegada_tarde) · `cantidad` ·
  `origen_solicitud_id` · `confirmada` · audit cols.

### 4.4 Almacén documental RRHH dedicado
- **`rrhh_documents`** (legajo): `id`/`document_group_id`/`version`/`is_current` · `empleado_id` ·
  `doc_class` (dni/contrato/cv/certificado/bancario/otro) · `storage_bucket` (check ∈
  `rrhh-legajo`,`rrhh-health`) · `storage_path` · `sha256` (obligatorio) · `mime_type`/`file_size` ·
  `expires_at` · `retention_class/until` · `redacted` (supresión) · audit/soft-delete.
- **`rrhh_receipts`**: `id` · `empleado_id`🔒 · `periodo` · `tipo` (mensual/SAC/final/ajuste) ·
  `nro_recibo` · `fecha_pago` · `storage_bucket` (check = `rrhh-receipts`) · `storage_path` ·
  `sha256` · `retention_until` · `uploaded_by/at` · soft-delete. **Sin** detalle de conceptos.
- **`rrhh_document_audit`** (append-only): `target` (document/receipt) · `target_id` · `actor_id` ·
  `action` (view/download/create/delete) · `ts` · `ip/user_agent/detail`. Read gated por RBAC.

### 4.5 Auditoría transversal
- **`rrhh_audit_log`** (append-only): mutaciones sensibles (alta/baja legajo, cambio bancario,
  acceso a salud, emisión de signed URL) — `actor_id` · `accion` · `entidad` · `entidad_id` ·
  `metadata` jsonb · `ts`.

### 4.6 Vistas derivadas
`rrhh_v_antiguedad` · `rrhh_v_vacaciones_saldo` · `rrhh_v_ausentismo` · `rrhh_v_dotacion` ·
`rrhh_v_calendario` · `rrhh_v_dashboard_kpis`.

---

## 5. Seguridad (versión definitiva)

### 5.1 Principio
Toda autorización RRHH se expresa con **`has_permission()` (RBAC) + propiedad**
(`empleado.profile_id = auth.uid()`), **fail-closed**. **Prohibido** `current_role()` /
`user_role_t` como mecanismo de autorización (el bypass de admin ya vive dentro de
`has_permission`, aceptable como superusuario).

### 5.2 PII (CUIL, CBU, recibos, salud)
- Separación por sensibilidad: `rrhh_empleado_bancario` (CBU🔒) aislado del legajo general; salud en
  bucket/permiso propios.
- RLS por **propiedad o permiso**, nunca por rol legacy.
- DNI/CUIL/CBU y documentos: la regla anti-`current_role()` y el guard fail-closed aplican también a
  las **tablas de PII estructurada** (`rrhh_empleados`, `rrhh_empleado_bancario`).

### 5.3 Storage (buckets RRHH dedicados)
- Buckets privados **dedicados**: `rrhh-receipts`, `rrhh-legajo`, `rrhh-health` (salud aislada con
  gating más estricto). `public = false`.
- **No** se reutiliza el bucket/tabla/policies `documents` ni el Centro Documental.
- Buckets `rrhh-*` **sin** policy de lectura para `authenticated`: el binario solo se obtiene por RPC.

### 5.4 RPC y signed URLs
- Acceso a cualquier documento/recibo **solo** vía `emit_rrhh_signed_url(target, id, reason)`
  `security definer`, que: (1) verifica permiso/propiedad fail-closed; (2) registra la lectura en
  `rrhh_document_audit` **antes** de devolver; (3) devuelve un *grant* `{bucket,path}` y la app
  firma la URL con el SDK (grant temporal, expiración corta). Acceso directo a tabla/bucket
  imposible. (Estructura heredada de `emit_custody_signed_url` `0037`; **autorización NO** —
  custody usa `current_role()`, RRHH usa RBAC.)

### 5.5 Guard canónico (patrón oficial)
> Decisión heredada del incidente corregido por `0055_treasury_security_fix.sql`.
```sql
-- FAIL-CLOSED: NULL ↓ FALSE. Nunca `if not has_permission(...)` sin coalesce.
if not coalesce(public.has_permission('rrhh.recibos.read_all'), false) then
   raise exception 'ACCESS_DENIED' using errcode = '42501';
end if;

-- Permiso O propiedad (empleado ve lo suyo):
if not (
     coalesce(public.has_permission('rrhh.recibos.read_all'), false)
  or exists (select 1 from public.rrhh_empleados e
             where e.id = v_empleado_id and e.profile_id = auth.uid())
) then
   raise exception 'ACCESS_DENIED' using errcode = '42501';
end if;
```

### 5.6 Resultado de acceso
| Actor | Legajo | Recibos | Salud |
|-------|--------|---------|-------|
| Empleado (`employee_self_service`) | propio | propios | propia |
| `rrhh_admin` | total | total | total |
| `rrhh_manager` | total | upload + lectura operativa | — (salvo grant) |
| Dirección (`director_ops`/`rrhh_viewer`) | agregados | no individual | no |
| **Operaciones** | **sin acceso** | **sin acceso** | **sin acceso** |
| **Supervisor (jerárquico)** | datos laborales del equipo (no PII) | no | no |
| Compliance | — | — | excepción reglada + auditada |

---

## 6. Workflow (versión final)

### 6.1 Máquina de estados (vacaciones/permisos/licencias/horas extra)
```
  [borrador] ──(solicitante cancela)──────────────────────► [cancelada]
      │ enviar
      ▼
  [pendiente_supervisor] ──(rechaza)──► [rechazada] ; ──(cancela)──► [cancelada]
      │ aprueba L1 (por supervisor_id)
      ▼
  [pendiente_rrhh] ──(rechaza)──► [rechazada] ; ──(cancela)──► [cancelada]
      │ aprueba L2 (RRHH)
      ▼
  [aprobada] ──(RRHH anula: motivo + contrapartida + restitución)──► [anulada]

  Aristas alternativas de entrada:
   · Licencia enfermedad/ART → entrada directa a [pendiente_rrhh].
   · Hora extra cargada por supervisor → entrada según política (puede saltar L1).
```
- **Transiciones solo por RPC** (`security definer`, guard fail-closed, `via_rpc`, `FOR UPDATE`,
  evento en `rrhh_solicitud_eventos`).
- **Reglas:** validar saldo de vacaciones antes de `pendiente_rrhh`; exigir doc. si `requiere_doc`
  antes de `aprobada`; bloquear solapamiento de fechas.
- **`cancelada`** (retiro del solicitante pre-aprobación, sin efectos) ≠ **`anulada`** (reversión
  RRHH post-aprobación, con contrapartida en novedades + restitución de saldo + baja en calendario).
- Estados terminales: `rechazada`, `cancelada`, `anulada`.
- **Horas extra:** al aprobar → INSERT en `rrhh_novedades` (`tipo='hora_extra'`); recargo como
  metadato, sin liquidar.

### 6.2 Notificaciones
Reutiliza `src/lib/email` (y `whatsapp` si aplica) para avisar al siguiente aprobador y al empleado.

---

## 7. Roles (versión final · RBAC únicamente)

> Filas en la tabla `roles` (INSERT como `0009`). **No** se extiende `user_role_t`. **Sin** rol
> `supervisor` (colisión con el enum legacy): la aprobación L1 se resuelve por jerarquía
> (`rrhh_empleados.supervisor_id`).

| Slug | Nombre | Alcance |
|------|--------|---------|
| `rrhh_admin` | Administrador RRHH | Total: legajo, PII sensible (bancario/salud), recibos, baja, aprobación L2, reportes |
| `rrhh_manager` | Responsable RRHH | Gestión operativa: legajo, solicitudes, aprobación L2, novedades, horas extra; sin CBU/salud salvo necesidad |
| `rrhh_viewer` | Visor RRHH | Solo lectura: dashboard + reportes agregados; sin PII individual ni escritura |
| `employee_self_service` | Portal del empleado | Solo lo propio |

**Aprobación L1 (ex-"supervisor"):**
`puede_aprobar_l1 := (caller.empleado.id = solicitud.empleado.supervisor_id) AND
coalesce(has_permission('rrhh.solicitud.approve_l1'), false)`.

**Permisos `rrhh.*` (notación con punto, alineada al RBAC real):**
```
rrhh.empleado.read         rrhh.empleado.read_all      rrhh.empleado.write       rrhh.empleado.baja
rrhh.bancario.read         rrhh.bancario.write
rrhh.legajo.read           rrhh.legajo.read_all        rrhh.legajo.write
rrhh.solicitud.read        rrhh.solicitud.create       rrhh.solicitud.approve_l1
rrhh.solicitud.approve_l2  rrhh.solicitud.reject       rrhh.solicitud.cancel      rrhh.solicitud.anular
rrhh.salud.read            rrhh.novedad.read           rrhh.novedad.write
rrhh.recibos.read          rrhh.recibos.read_all       rrhh.recibos.upload
rrhh.reporte.read          rrhh.dashboard.read         rrhh.audit.read
```

---

## 8. Roadmap (versión final · 0056 → 0061)

> Próxima migración libre verificada: `0056`. Regla de enum: todo `ALTER TYPE ... ADD VALUE` va
> aislado y committeado antes de su uso (patrón 0021/0029/0052).

| Mig | Nombre | Contenido |
|-----|--------|-----------|
| `0056` | `rrhh_permission_module` | `alter type permission_module_t add value 'rrhh'` (aislada) |
| `0057` | `rrhh_core` | `rrhh_empleados`/`_bancario`/`_historial`/`_jornada`/`_vacaciones_reglas`/`_feriados`; RLS; triggers append-only; **RBAC seed** (permisos `rrhh.*` + roles + role_permissions) |
| `0058` | `rrhh_workflows` | `rrhh_solicitudes`/`_eventos`/`_documentos`/`_horas_extra_detalle`/`_novedades`; RLS; triggers |
| `0059` | `rrhh_views` | vistas derivadas (antigüedad, saldo, ausentismo, dotación, calendario, KPIs) |
| `0060` | `rrhh_functions` | RPCs (solicitar/aprobar L1/L2/rechazar/cancelar/anular) + guards fail-closed + `via_rpc` |
| `0061` | `rrhh_storage` | buckets `rrhh-receipts`/`rrhh-legajo`/`rrhh-health`; `rrhh_documents`/`rrhh_receipts`/`rrhh_document_audit`; RLS RBAC+propiedad; `emit_rrhh_signed_url`; retención |

**Gates (estilo ERP-A: diseño → migración → review → cierre):**
| Gate | Alcance | Migración | Depende de |
|------|---------|-----------|------------|
| R0 | Aprobación del diseño congelado (este documento) | — | — |
| R1 | Enum + RBAC seed | `0056`+`0057`(seed) | R0 |
| R2 | Legajo + jornada + reglas + feriados | `0057` | R1 |
| R3 | Backend legajo (`src/lib/rrhh/*`, RPCs alta/baja) | — | R2 |
| R4 | UI legajo + portal "mi perfil" | — | R3 |
| R5 | Motor de ausencias + horas extra (datos) | `0058` | R2 |
| R6 | Workflow (RPCs) + UI ausencias | `0060` | R5 |
| R7 | Calendario corporativo | `0059` | R5 |
| R8 | Almacén documental RRHH + recibos + "mis recibos" | `0061` | R3 |
| R9 | Dashboard + reportes | `0059` | R5–R8 |
| R10 | Hardening PII + auditoría de implementación (checklist §9.2) | — | todos |

Orden crítico: **R1 → R2 → R3** primero; ausencias (R5–R7) y documental (R8) en paralelo tras R3;
dashboard (R9) al final.

---

## 9. Riesgos (solo vigentes)

> Se eliminan los riesgos ya corregidos: fuga por reuse de `documents` (resuelta, almacén dedicado);
> fail-open de RPC (resuelto, guard `coalesce`); colisión de roles (resuelta, RBAC + jerarquía);
> migración de enum (mitigada, aislada).

| # | Riesgo vigente | Naturaleza | Mitigación |
|---|----------------|-----------|-----------|
| 1 | PII masiva (DNI/CUIL/CBU/salud) — inherente al dominio | Legal (Ley 25.326) | Separación por sensibilidad, RLS propiedad+RBAC, buckets dedicados, RPC auditada, retención |
| 2 | Datos de salud (categoría especial) | Legal | Bucket `rrhh-health` aislado + `rrhh.salud.read` + auditoría + excepción reglada para compliance |
| 3 | Los mandatos fail-closed/RPC-only son de **diseño**; su SQL se prueba al implementar | Implementación | Auditoría de implementación por gate (checklist §9.2) |
| 4 | Fail-open de la verificación de ruta TS (`src/lib/rbac/check.ts`, RBAC dormido) | Infra preexistente | RRHH protege PII por RPC/RLS fail-closed (DB), no por el check de ruta |
| 5 | Turnos rotativos sin denominador de ausentismo | Funcional menor | Modelar patrón rotativo en `rrhh_jornada` o excluir explícitamente |
| 6 | Carga inicial del legajo (~17+ empleados, PII) | Operativo | Importación controlada y validada; PII no versionada en el repo |
| 7 | Tentación de liquidar sueldos | Alcance | Límite duro: RRHH no liquida; solo novedades + repositorio |

### 9.1 Menores de implementación (no bloqueantes)
Estado de entrada de OT por supervisor; semántica `cantidad_dias` en subtipo `hora_extra`; vector de
grant de `rrhh.solicitud.approve_l1` a jefes de línea.

### 9.2 Checklist de seguridad (obligatorio en la auditoría de implementación)
```
☐ No existe autorización mediante current_role()
☐ No existe `if not has_permission(...)` sin coalesce
☐ Todas las autorizaciones usan coalesce(has_permission(...), false)
☐ Todas las signed URLs se emiten vía RPC (emit_rrhh_signed_url)
☐ Toda lectura de PII queda auditada (rrhh_document_audit, append-only)
☐ Operaciones NO puede acceder (sin permisos rrhh.*; ausente de toda RLS RRHH)
☐ Supervisor NO accede a documentos PII (jerarquía ≠ acceso a PII)
☐ Empleado accede SOLO a lo propio (profile_id = auth.uid())
☐ RRHH accede según RBAC fail-closed
☐ Datos de salud aislados (rrhh-health + rrhh.salud.read)
```

---

## 10. FROZEN DECISIONS

Decisiones de arquitectura **congeladas**. Cambiarlas requiere reapertura formal del diseño.

| # | Decisión congelada | Fundamento |
|---|--------------------|-----------|
| FD-1 | **PII aislada** por sensibilidad (legajo / bancario / salud en estructuras y buckets separados) | Ley 25.326; auditoría de cierre |
| FD-2 | **Buckets RRHH dedicados** (`rrhh-receipts`/`rrhh-legajo`/`rrhh-health`); **no** reutilizar `documents` ni Centro Documental | Patrón Custody (`0037`); evita fuga a roles operativos |
| FD-3 | **Signed URLs RPC-only y auditadas** (`emit_rrhh_signed_url`); buckets sin lectura `authenticated` | Cierre de bypass; trazabilidad de acceso a PII |
| FD-4 | **Guards fail-closed** `coalesce(has_permission(...), false)`; prohibido `if not has_permission(...)` | Incidente `0055` (Tesorería) |
| FD-5 | **RBAC moderno** (tabla `roles`, permisos `rrhh.*` con punto); **prohibido** `current_role()`/`user_role_t` como autorización | Disambiguación de roles; auditoría final |
| FD-6 | **Propiedad explícita** del empleado (`profile_id = auth.uid()`) para acceso a lo propio | Self-service seguro |
| FD-7 | **Reutilización parcial de patrones Custody**: estructura de RPC/auditoría/grant — **no** su autorización por `current_role()` | Reuso útil sin heredar inseguridad |
| FD-8 | **RRHH no liquida** sueldos; solo novedades + repositorio | Alcance del dominio |
| FD-9 | **Cálculo en la base** (vistas); nada en TS | Patrón Nexus |
| FD-10 | **Append-only + anulación lógica** en eventos/PII/novedades | Trazabilidad legal |

---

## Cierre

```text
RRHH DOMAIN

DESIGN PHASE CLOSED
ARCHITECTURE FROZEN
READY FOR IMPLEMENTATION
```

Se declara **concluida la fase de diseño** del dominio Recursos Humanos dentro de TOPS Nexus.
Este documento (v2.0) es la **fuente única de diseño**; los addenda y auditorías previas quedan como
traza histórica. La implementación (gates R1+) requiere **aprobación explícita de Dirección** y se
realizará sobre `arsksytgdnzukbmfgkju`, con auditoría de implementación por gate contra el checklist
§9.2.

*Documento consolidado v2.0 — no se implementó, no se migró, no se tocó producción, sin commit.*
