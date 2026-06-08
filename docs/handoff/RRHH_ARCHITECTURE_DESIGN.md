# TOPS NEXUS — RECURSOS HUMANOS (RRHH)
## Documento de Arquitectura y Diseño

> **Estado:** DISEÑO — congelado, pendiente de aprobación.
> **Implementación:** NO autorizada. Cero código, cero migraciones, cero cambios en producción hasta aprobación explícita.
> **Fuente de verdad única:** Supabase productivo `arsksytgdnzukbmfgkju`. Nunca staging, nunca sandbox, nunca estructuras paralelas.
> **Fecha:** 2026-06-07 · **Versión:** 1.0 (diseño inicial)
> **Empresa:** Logística TOPS — Verotin S.A. (CUIT 33-60489698-9)

---

## 0. Resumen ejecutivo

RRHH es el último gran dominio funcional de TOPS Nexus. Cierra el ciclo operativo
completo del sistema. Hoy la gestión es 100% manual (papel, Excel, PDFs sueltos,
control manual de vacaciones/permisos/licencias).

El objetivo **no** es digitalizar formularios: es **rediseñar el proceso** hacia un
modelo enterprise (SuccessFactors / Workday / BambooHR) adaptado a una operación
logística 3PL argentina, sobre la arquitectura real de Nexus.

**Pilares del diseño:**

1. **Legajo digital** como fuente única de verdad del empleado (distinto de `profiles`).
2. **Motor de ausencias** (vacaciones, permisos, licencias) con workflow de aprobación
   multinivel y reglas de Ley de Contrato de Trabajo (LCT 20.744) embebidas en la base.
3. **Núcleo de novedades** preparado para alimentar una futura liquidación (sin liquidar).
4. **Repositorio documental** (recibos, documentación de legajo) con consulta y trazabilidad.
5. **Portal del empleado** (self-service) y **dashboard ejecutivo** para Dirección.
6. **PII-first**: el dato sensible (DNI/CUIL, CBU, salud) es la preocupación central de
   arquitectura. Toda la seguridad se diseña alrededor de protegerlo (Ley 25.326).

**Lo que RRHH NO hace** (límites duros): no liquida sueldos, no reemplaza el sistema
contable, no calcula impuestos, no genera asientos. Es legajo + workflow + repositorio
+ reportería. La liquidación se sigue haciendo fuera; Nexus es la fuente de novedades y
el repositorio del resultado (el recibo PDF).

---

## 1. Arquitectura funcional completa

### 1.1 Mapa de submódulos

| # | Submódulo | Propósito | Consume de | Alimenta a |
|---|-----------|-----------|------------|-----------|
| 1 | **Dashboard RRHH** | Vista ejecutiva (Dirección) | Todos | — |
| 2 | **Empleados (Legajo)** | Fuente de verdad del empleado | `profiles`, RBAC | Todos |
| 3 | **Vacaciones** | Motor de saldos + solicitud + aprobación | Legajo (antigüedad) | Novedades, Calendario |
| 4 | **Permisos** | Inasistencias, llegadas tarde, retiros, etc. | Legajo | Novedades, Calendario |
| 5 | **Licencias** | Enfermedad, ART, maternidad, etc. + documentación | Legajo | Novedades, Calendario |
| 6 | **Novedades** | Registro centralizado del período (núcleo de liquidación futura) | Vac./Perm./Lic./Horas extra | Reportes, export |
| 7 | **Recibos** | Repositorio documental de recibos de sueldo | Carga administrativa | Portal empleado |
| 8 | **Calendario corporativo** | Vista transversal de cobertura operativa | Vac./Perm./Lic./Feriados | Dashboard |
| 9 | **Reportes** | Ausentismo, vacaciones, antigüedad, dotación, etc. | Todos | Export PDF/XLSX |

### 1.2 Flujo funcional macro

```
                         ┌───────────────────────────────┐
                         │        LEGAJO DIGITAL          │
                         │  (fuente de verdad empleado)   │
                         └───────────────┬───────────────┘
                                         │ antigüedad, categoría, supervisor
              ┌──────────────┬───────────┼───────────────┬──────────────┐
              ▼              ▼            ▼               ▼              ▼
        ┌──────────┐  ┌──────────┐ ┌──────────┐   ┌──────────┐   ┌──────────┐
        │VACACIONES│  │ PERMISOS │ │LICENCIAS │   │HORAS EXTRA│  │ RECIBOS  │
        └────┬─────┘  └────┬─────┘ └────┬─────┘   └────┬─────┘   └────┬─────┘
             │             │            │              │              │
             └─────────────┴────────────┴──────────────┘              │
                                  │                                    │
                                  ▼                                    │
                         ┌─────────────────┐                          │
                         │    NOVEDADES     │  (registro del período)  │
                         │ (núcleo liquid.) │                          │
                         └────────┬────────┘                           │
                                  │                                    │
              ┌───────────────────┼───────────────────┐               │
              ▼                   ▼                   ▼               ▼
       ┌────────────┐     ┌────────────┐      ┌────────────┐  ┌─────────────┐
       │ CALENDARIO │     │  REPORTES  │      │ DASHBOARD  │  │   PORTAL    │
       │CORPORATIVO │     │            │      │ EJECUTIVO  │  │  EMPLEADO   │
       └────────────┘     └────────────┘      └────────────┘  └─────────────┘
```

### 1.3 Detalle por submódulo

#### 1 · Dashboard RRHH (Dirección)
KPIs: dotación total · activos · ausentismo (mes/YTD) · vacaciones (en curso /
pendientes de aprobar / saldo global) · licencias activas (por tipo) · permisos del
mes · antigüedad promedio · alertas (vencimientos de documentación, licencias por
vencer, períodos vacacionales no gozados próximos a caducar art. 157 LCT).
Todos los números provienen de **vistas derivadas en la base** — no se calcula en TS.

#### 2 · Empleados — Legajo digital
Es el corazón del módulo. Contiene:
- **Datos personales** (PII alta): nombre y apellido, DNI, CUIL, fecha de nacimiento,
  domicilio, teléfono, email personal, estado civil, contacto de emergencia.
- **Datos laborales**: legajo (número), fecha de ingreso, fecha reconocida (antigüedad
  real), categoría, sección, calificación profesional, convenio (SECAC/comercio),
  modalidad de contratación, lugar de pago, depósito (MAGALDI/LUJAN), supervisor.
- **Datos bancarios** (PII alta): banco, CBU/cuenta de acreditación de haberes.
- **Obra social**.
- **Documentación**: DNI escaneado, CV, contrato, certificados, etc. (repositorio).
- **Historial completo**: cambios de categoría, de remuneración asignada, de supervisor,
  ausencias, licencias — todo append-only y auditable.

> El legajo se **vincula** opcionalmente a un `profiles.id` (usuario auth de Nexus)
> cuando el empleado tiene acceso al portal. No todo empleado tiene login; no todo
> usuario es empleado. La relación es 1:0..1.

#### 3 · Vacaciones — Motor completo
Reglas LCT Art. 150 (días corridos por antigüedad al 31/12):

| Antigüedad | Días corridos |
|------------|---------------|
| < 6 meses | 1 día cada 20 trabajados (proporcional) |
| 6 meses – 5 años | **14** |
| 5 – 10 años | **21** |
| 10 – 20 años | **28** |
| > 20 años | **35** |

Capacidades: cálculo automático del derecho del año · saldo disponible / utilizado /
pendiente · solicitud por período · aprobación · reflejo en calendario · control de
caducidad (art. 157). **El cálculo vive en la base** (función + vista), parametrizado
por tabla de reglas para que un cambio normativo no requiera deploy.

Workflow: `Empleado → Supervisor → RRHH → Aprobado/Rechazado` (ver §4).

#### 4 · Permisos
Tipos: inasistencia · llegada tarde · retiro anticipado · médico · estudio · familiar ·
trámite personal · otro. Cada tipo configurable (¿con/sin goce? ¿requiere documentación?
¿computa a ausentismo?). Workflow completo idéntico al de vacaciones.

#### 5 · Licencias
Tipos: enfermedad · ART (Ley 24.557) · maternidad · paternidad · especial (art. 158
LCT: matrimonio, nacimiento, fallecimiento, examen) · sin goce. **Documentación
obligatoria** según tipo (certificado médico, denuncia ART, partida, etc.). Trazabilidad
completa: alta, documentación, validación, alta médica/fin, prórrogas.

> **Dato sensible de salud** (certificados, diagnósticos, ART): trato reforzado bajo
> Ley 25.326. Ver §9 y §5 (roles).

#### 6 · Novedades
Registro centralizado e inmutable de todo lo que afecta un período: horas extra,
vacaciones gozadas, licencias, permisos, ausencias, llegadas tarde. **Diseñado como
núcleo futuro de liquidación**: una novedad confirmada es la materia prima que se
exportará a quien liquide. RRHH no liquida; produce el insumo limpio y trazable.

#### 7 · Recibos — Repositorio documental
> **Validado contra recibos reales 2026-05 (Verotin S.A.).** El recibo es el modelo
> SECAC estándar: 2 páginas por empleado (hoja 1/2 y 2/2), con encabezado (legajo,
> apellido y nombre, CUIL, remuneración asignada, modalidad, categoría, sección, obra
> social, fechas de ingreso/reconocida, antigüedad, lugar y período de pago), grilla de
> conceptos (código · concepto · cantidad · remunerativo · no remunerativo · descuentos
> · contribuciones), total neto, importe en letras, cuenta de depósito y firmas.

El recibo **contiene** CUIL + cuenta bancaria + remuneración + firma → es uno de los
documentos más sensibles del sistema. El repositorio:
- **Empleado** → "Mis recibos" (solo los propios).
- **Administración** → todos los recibos.
- Funciones: visualizar · descargar · buscar · filtrar (por empleado, período, tipo).
- **No genera** liquidaciones. Solo almacena, indexa, sirve y audita.

Carga: administrativa (subida del PDF generado por el sistema externo de liquidación),
con metadatos indexables (legajo, empleado, período `YYYY-MM`, tipo: mensual / SAC /
final / ajuste, nº recibo, fecha de pago). **El detalle financiero del PDF no se
parsea ni se almacena desnormalizado** — el PDF es el documento legal; solo se indexan
metadatos mínimos para búsqueda.

#### 8 · Calendario corporativo
Vista transversal que integra vacaciones + licencias + permisos + ausencias + feriados
(nacionales AR + propios de la empresa). Objetivo operativo: **visualizar cobertura**
por sección/depósito para no quedar sin gente clave. Filtrable por depósito (MAGALDI/
LUJAN), sección y tipo de evento.

#### 9 · Reportes
Ausentismo · vacaciones · antigüedad · dotación · horas extra · permisos · licencias.
Export a PDF/XLSX. Todos derivados de vistas; ningún reporte recalcula en el cliente.

---

## 2. Arquitectura técnica

### 2.1 Encaje en el stack de Nexus (sin inventar)

RRHH replica **exactamente** los patrones ya vivos en producción (verificados contra
`tesoreria` 0052–0055, `crm` 0041–0051, RBAC):

| Capa | Convención Nexus | Aplicación a RRHH |
|------|------------------|-------------------|
| **Base de datos** | Postgres/Supabase, migraciones numeradas en `supabase/migrations/` | `0056_…` en adelante (ver §2.2) |
| **Enum de módulo** | `permission_module_t` (valores: `comercial`, `operaciones`, `wms`, `pedidos`, `tesoreria`, …) | Agregar `'rrhh'` |
| **RBAC** | `roles` / `permissions` / `role_permissions` / `user_roles`; helpers `has_permission(slug)`, `current_role()`, `is_admin()` | Permisos `rrhh:*`; roles nuevos (ver §5) |
| **Seguridad escritura** | RLS ≤ RBAC; escritura directa solo `admin`; granularidad fina vía RPC `security definer` con `has_permission` + `set_config('<mod>.via_rpc','on')` + `FOR UPDATE` | Idéntico, prefijo `rrhh.via_rpc` |
| **Inmutabilidad** | Append-only: `tg_forbid_delete_*`, anulación lógica con `voided_at/by/reason` | `tg_forbid_delete_rrhh` sobre tablas de evento |
| **Numeración** | `public_id` secuencial por entidad | Solicitudes/legajos con `public_id` |
| **Auditoría** | Tablas de auditoría append-only | `rrhh_audit_log` |
| **Capa lib** | `src/lib/<mod>/{types,data,actions,validation,errors}.ts` | `src/lib/rrhh/…` |
| **Cálculo** | **Nunca en TS** — derivado en vistas DB | Saldos/antigüedad en vistas |
| **UI** | Next.js App Router, `src/app/(app)/<mod>/…` | `src/app/(app)/rrhh/…` |

### 2.2 Plan de migraciones (numeración real verificada)

> El árbol termina hoy en `0055_treasury_security_fix.sql`. **Próximo libre: `0056`.**

Patrón obligatorio (Postgres no permite usar un valor de enum nuevo en la misma
transacción que el `ALTER TYPE` — ver 0021/0029/0052):

```
0056_rrhh_permission_module.sql   -- AISLADA, committeada antes de 0057.
                                  -- alter type permission_module_t add value 'rrhh';
                                  -- notify pgrst, 'reload schema';

0057_rrhh_core.sql                -- Enums rrhh_*, tabla empleados (legajo),
                                  -- documentos, reglas de vacaciones, RLS, triggers
                                  -- append-only. Solo modelo de datos.

0058_rrhh_absences.sql            -- vacaciones / permisos / licencias / novedades
                                  -- + RLS + triggers de inmutabilidad.

0059_rrhh_functions.sql           -- RPCs security-definer (solicitar/aprobar/rechazar),
                                  -- vistas derivadas (saldos, antigüedad, ausentismo),
                                  -- guards via_rpc.

0060_rrhh_rbac_seed.sql           -- permissions rrhh:* + role_permissions + roles nuevos.
                                  -- Idempotente.

0061_rrhh_recibos.sql             -- repositorio de recibos (metadatos) + bucket privado
                                  -- + RLS own-or-rrhh + auditoría de acceso.
```

> Numeración indicativa; cada gate puede subdividirse siguiendo el patrón ERP-A
> (A1 datos → A2 funciones → A3 backend → A4 UI → A5 seguridad).

### 2.3 Almacenamiento de documentos

- **Bucket privado de Supabase Storage** (`rrhh-documentos`, `rrhh-recibos`),
  **nunca público**.
- Acceso exclusivamente vía **signed URLs de corta expiración**, emitidas por una RPC/route
  que primero verifica `has_permission` + propiedad (empleado dueño o RRHH).
- **Toda emisión de URL y toda descarga se audita** (quién, qué documento, cuándo).
- Sin URLs persistentes en el cliente; sin exposición directa del path.

### 2.4 Capa de aplicación (`src/lib/rrhh/`)

```
src/lib/rrhh/
  types.ts        -- tipos espejo de las tablas/vistas (sin lógica)
  data.ts         -- lectura (RLS aplicada), llamadas a vistas derivadas
  actions.ts      -- server actions → invocan RPC (nunca SQL directo de escritura)
  validation.ts   -- zod schemas de entrada (DNI, CUIL, CBU, fechas, rangos)
  errors.ts       -- catálogo de errores tipados (espeja errcodes de la base)
```

Regla dura heredada de Tesorería: **ningún cálculo financiero/temporal en TS**. Saldos
de vacaciones, antigüedad, días de ausentismo → vistas SQL. TS solo orquesta y presenta.

---

## 3. Modelo de datos

> Diseño lógico. Prefijo `rrhh_`. Tipos finales (numeric/precision, nullability)
> se fijan en la migración. PII marcada con 🔒.

### 3.1 Núcleo — Empleado / Legajo

**`rrhh_empleados`**
| Campo | Tipo | Nota |
|-------|------|------|
| `id` | uuid PK | |
| `public_id` | int secuencial | número de legajo visible |
| `profile_id` | uuid FK → profiles | nullable, 1:0..1 (acceso portal) |
| `apellido_nombre` | text 🔒 | |
| `dni` | text 🔒 | único |
| `cuil` | text 🔒 | único, validado |
| `fecha_nacimiento` | date 🔒 | |
| `domicilio` / `telefono` / `email_personal` | text 🔒 | |
| `estado_civil` | enum | |
| `contacto_emergencia` | jsonb 🔒 | |
| `fecha_ingreso` | date | |
| `fecha_reconocida` | date | base de antigüedad |
| `categoria` / `seccion` / `calificacion` | text/FK | |
| `convenio` | text | p.ej. SECAC |
| `modalidad_contratacion` | enum | |
| `depot` | enum (MAGALDI/LUJAN) | espeja `user_roles.depot` |
| `supervisor_id` | uuid FK → rrhh_empleados | jerarquía |
| `obra_social` | text | |
| `estado` | enum (activo/licencia/baja) | |
| `fecha_baja` / `motivo_baja` | date/text | baja lógica |
| `created_*` / `updated_*` | audit cols | |

**`rrhh_empleado_bancario`** (separada por sensibilidad)
`empleado_id` · `banco` · `cbu` 🔒 · `cuenta` 🔒 · `vigente_desde`. Append-only
(historial de cuentas). RLS más estricta que el legajo general.

**`rrhh_empleado_historial`** (append-only): cambios de categoría, remuneración
asignada, supervisor, sección — `empleado_id`, `campo`, `valor_anterior`, `valor_nuevo`,
`vigente_desde`, `changed_by`.

**`rrhh_documentos`**: `empleado_id` · `tipo` (dni/contrato/cv/cert/…) · `storage_path`
· `nombre` · `subido_por` · `created_at`. Archivos en bucket privado.

### 3.2 Reglas de vacaciones (parametrizado)

**`rrhh_vacaciones_reglas`**: `antiguedad_desde_meses` · `antiguedad_hasta_meses` ·
`dias_corridos` · `vigente_desde`. Sembrado con la tabla LCT Art. 150. Un cambio
normativo = un INSERT, no un deploy.

### 3.3 Motor de ausencias (genérico + especializaciones)

**`rrhh_solicitudes`** (tabla madre del workflow):
| Campo | Tipo | Nota |
|-------|------|------|
| `id` / `public_id` | uuid / int | |
| `empleado_id` | uuid FK | |
| `tipo` | enum (`vacaciones`/`permiso`/`licencia`) | |
| `subtipo` | text/FK | (p.ej. médico, enfermedad, ART) |
| `fecha_desde` / `fecha_hasta` | date | |
| `cantidad_dias` | numeric | derivable |
| `motivo` | text | |
| `estado` | enum (`borrador`/`pendiente_supervisor`/`pendiente_rrhh`/`aprobada`/`rechazada`/`anulada`) | |
| `requiere_doc` | bool | según subtipo |
| `con_goce` | bool | según subtipo |
| `computa_ausentismo` | bool | |
| audit cols | | append-only |

**`rrhh_solicitud_eventos`** (append-only, traza del workflow): `solicitud_id` ·
`accion` (crear/enviar/aprobar/rechazar/anular) · `actor_id` · `nivel` (supervisor/rrhh)
· `comentario` · `created_at`. Inmutable (`tg_forbid_delete_rrhh` + sin UPDATE).

**`rrhh_solicitud_documentos`**: documentación adjunta a una solicitud (certificado
médico 🔒, denuncia ART 🔒, etc.) en bucket privado, con acceso reforzado (salud).

### 3.4 Novedades

**`rrhh_novedades`** (append-only, núcleo de liquidación futura): `empleado_id` ·
`periodo` (YYYY-MM) · `tipo` (hora_extra/vacaciones/licencia/permiso/ausencia/llegada_tarde)
· `cantidad` · `origen_solicitud_id` (FK nullable) · `confirmada` · audit cols.
Una novedad confirmada es inmutable; se corrige por contrapartida, no por UPDATE.

### 3.5 Recibos (repositorio)

**`rrhh_recibos`**: `empleado_id` · `periodo` (YYYY-MM) · `tipo` (mensual/SAC/final/
ajuste) · `nro_recibo` · `fecha_pago` · `storage_path` 🔒 · `subido_por` · `created_at`.
**Sin** detalle de conceptos: el PDF es el documento legal; solo metadatos para búsqueda.

**`rrhh_recibo_accesos`** (append-only): `recibo_id` · `actor_id` · `accion`
(ver/descargar) · `created_at`. Auditoría de quién vio/bajó cada recibo.

### 3.6 Calendario / Feriados

**`rrhh_feriados`**: `fecha` · `nombre` · `tipo` (nacional/empresa) · `depot` (nullable).
El calendario corporativo es una **vista** que une solicitudes aprobadas + feriados.

### 3.7 Auditoría transversal

**`rrhh_audit_log`** (append-only): toda mutación sensible (alta/baja de legajo, cambio
bancario, acceso a documentación de salud, emisión de signed URL). `actor_id` · `accion`
· `entidad` · `entidad_id` · `metadata` jsonb · `created_at`.

### 3.8 Vistas derivadas (cálculo en la base)

- `rrhh_v_antiguedad` — años/meses desde `fecha_reconocida`.
- `rrhh_v_vacaciones_saldo` — derecho del año (regla por antigüedad) − gozado − aprobado pendiente.
- `rrhh_v_ausentismo` — días/% por empleado/sección/depósito/período.
- `rrhh_v_dotacion` — headcount activo por depósito/sección/categoría.
- `rrhh_v_calendario` — eventos unificados (ausencias aprobadas + feriados).
- `rrhh_v_dashboard_kpis` — KPIs agregados para Dirección.

---

## 4. Workflow de aprobaciones

### 4.1 Máquina de estados (vacaciones/permisos/licencias)

```
  [borrador]
      │ empleado envía
      ▼
  [pendiente_supervisor] ──(supervisor rechaza)──► [rechazada]
      │ supervisor aprueba
      ▼
  [pendiente_rrhh] ──(RRHH rechaza)──► [rechazada]
      │ RRHH aprueba
      ▼
  [aprobada] ──(anulación con motivo, append-only)──► [anulada]
```

- **Transiciones solo vía RPC** `security definer` con `has_permission` + `FOR UPDATE`
  sobre la solicitud + guard `rrhh.via_rpc='on'`. Nunca UPDATE directo de estado.
- Cada transición escribe en `rrhh_solicitud_eventos` (append-only). El historial es
  reconstruible al 100%.
- **Reglas de negocio en la RPC**: validar saldo de vacaciones disponible antes de
  `pendiente_rrhh`; exigir documentación si `requiere_doc` antes de `aprobada`;
  bloquear solapamiento de fechas del mismo empleado.
- Al aprobar → se generan/actualizan filas en `rrhh_novedades` y el evento aparece en
  el calendario.

### 4.2 Variantes por tipo

- **Licencia por enfermedad/ART**: puede entrar directo a `pendiente_rrhh` (no requiere
  visto del supervisor para urgencias) y la documentación puede cargarse después con
  plazo. Configurable por subtipo.
- **Permiso de llegada tarde / retiro**: workflow de un solo nivel (supervisor) según
  política configurable.

### 4.3 Notificaciones

Reutilizar la infraestructura existente (`src/lib/email`, `whatsapp` si aplica) para
avisar al siguiente aprobador y al empleado en cada transición. No se inventa canal nuevo.

---

## 5. Roles y permisos

### 5.1 Roles vivos hoy (RBAC producción)
`director_ops`, `admin`, `comercial`, `operaciones`, `seguridad`, `compliance`,
`cliente_b2b`. Helpers: `has_permission(slug)`, `current_role()`, `is_admin()`.

### 5.2 Roles nuevos propuestos para RRHH

| Rol | Descripción | Alcance |
|-----|-------------|---------|
| `rrhh_admin` | Responsable de RRHH | CRUD legajo, aprobar nivel RRHH, ver salud, gestionar recibos, reportes |
| `rrhh_analista` | Analista de RRHH | Carga/edición de novedades y solicitudes, sin acceso a datos bancarios ni salud sensible |
| `supervisor` | Jefe de sección/depósito | Aprueba nivel 1 de su equipo; ve datos laborales de su gente, **no** PII personal/bancaria |
| `empleado` | Self-service (portal) | Ve y gestiona **solo lo propio** (perfil, solicitudes, mis recibos) |

> `director_ops` y `admin`: lectura ejecutiva del dashboard y reportes. `compliance`:
> acceso de auditoría (lectura de logs), **no** de datos personales salvo necesidad
> documentada. `supervisor` es un atributo derivable de `rrhh_empleados.supervisor_id`
> y/o un rol RBAC — se decide en gate de implementación.

### 5.3 Catálogo de permisos `rrhh:*` (propuesto)

```
rrhh:empleado.read           rrhh:empleado.write          rrhh:empleado.baja
rrhh:bancario.read    🔒      rrhh:bancario.write   🔒
rrhh:solicitud.read          rrhh:solicitud.create        rrhh:solicitud.approve_l1
rrhh:solicitud.approve_l2    rrhh:solicitud.reject        rrhh:solicitud.cancel
rrhh:licencia.salud.read 🔒  (acceso a documentación médica/ART — sensible Ley 25.326)
rrhh:novedad.read            rrhh:novedad.write
rrhh:recibo.read.self        rrhh:recibo.read.all  🔒      rrhh:recibo.upload
rrhh:reporte.read            rrhh:dashboard.read
rrhh:audit.read              (compliance)
```

### 5.4 Matriz rol × permiso (resumen)

| Permiso | empleado | supervisor | rrhh_analista | rrhh_admin | director_ops/admin | compliance |
|---|---|---|---|---|---|---|
| empleado.read (propio) | ✅ | — | — | — | — | — |
| empleado.read (todos) | — | equipo | ✅ | ✅ | ✅ | — |
| empleado.write/baja | — | — | parcial | ✅ | — | — |
| bancario.* 🔒 | propio | — | — | ✅ | — | — |
| solicitud.create | ✅ propio | — | ✅ | ✅ | — | — |
| approve_l1 (supervisor) | — | ✅ equipo | — | ✅ | — | — |
| approve_l2 (RRHH) | — | — | — | ✅ | — | — |
| licencia.salud.read 🔒 | propio | — | — | ✅ | — | excepción |
| recibo.read.self | ✅ | — | — | — | — | — |
| recibo.read.all 🔒 | — | — | — | ✅ | — | — |
| recibo.upload | — | — | ✅ | ✅ | — | — |
| dashboard.read | — | — | — | ✅ | ✅ | — |
| audit.read | — | — | — | — | — | ✅ |

> **Principio**: RLS define el "puede ver su subset"; RBAC (`has_permission` en RPC)
> define el "puede hacer". Igual que Tesorería: RLS ≤ RBAC, escritura fina solo por RPC.

---

## 6. Dashboard ejecutivo

Audiencia: Dirección (`director_ops`, `admin`, `rrhh_admin`).

**Tarjetas KPI** (todas desde `rrhh_v_dashboard_kpis`):
- Dotación total y activos (por depósito MAGALDI/LUJAN, por sección).
- Ausentismo del mes y YTD (% sobre días hábiles).
- Vacaciones: en curso · pendientes de aprobar · saldo global no gozado · próximas a caducar.
- Licencias activas por tipo (enfermedad/ART/maternidad/…).
- Permisos del mes por tipo.
- Antigüedad promedio.

**Alertas accionables**: documentación de legajo vencida/faltante · licencias por vencer ·
períodos vacacionales próximos a caducar (art. 157 LCT) · solicitudes estancadas en el
workflow > N días.

**Drill-down**: cada KPI enlaza al listado filtrado correspondiente. Sin recálculo en
cliente; el dashboard solo pinta lo que la vista devuelve.

---

## 7. Portal del empleado (self-service)

Audiencia: rol `empleado` (legajo con `profile_id` vinculado).

- **Mi perfil**: ver datos de legajo; solicitar corrección (no edita directo PII crítica
  — genera una solicitud de cambio que RRHH valida).
- **Mis vacaciones**: saldo disponible/usado/pendiente, solicitar período, ver estado.
- **Mis permisos / licencias**: solicitar, adjuntar documentación, seguir el workflow.
- **Mis recibos**: listar/buscar por período, visualizar y descargar (signed URL,
  auditado en `rrhh_recibo_accesos`).
- **Mi calendario**: mis ausencias aprobadas + feriados.

Seguridad: **todo filtrado por RLS a lo propio**. Un empleado nunca consulta datos de
otro, ni siquiera por ID directo (la RLS y las RPC verifican propiedad).

---

## 8. Roadmap de implementación

> Gates al estilo ERP-A (cada uno: diseño → migración → review → cierre). **Nada se
> implementa sin aprobación explícita del diseño congelado.**

| Gate | Alcance | Entregable | Depende de |
|------|---------|-----------|------------|
| **R0** | Aprobación de este diseño | Diseño congelado firmado | — |
| **R1** | Enum módulo + RBAC seed | `0056` + `0060` (permisos/roles `rrhh:*`) | R0 |
| **R2** | Legajo digital (datos) | `0057` empleados/bancario/historial/documentos + RLS + triggers | R1 |
| **R3** | Backend legajo | `src/lib/rrhh/*`, RPCs alta/baja/edición, signed URLs documentos | R2 |
| **R4** | UI legajo + portal mínimo | `src/app/(app)/rrhh/empleados`, "mi perfil" | R3 |
| **R5** | Motor de ausencias (datos+fns) | `0058`+`0059` solicitudes/eventos/novedades, reglas vacaciones, vistas saldo | R2 |
| **R6** | Workflow + UI ausencias | RPCs aprobación, pantallas solicitud/aprobación, portal vacaciones/permisos/licencias | R5 |
| **R7** | Calendario corporativo | vista + UI calendario, feriados | R5 |
| **R8** | Repositorio de recibos | `0061` recibos + bucket + RLS + auditoría + "mis recibos" + carga admin | R3 |
| **R9** | Dashboard ejecutivo + reportes | vistas KPI, dashboard, export PDF/XLSX | R5–R8 |
| **R10** | Hardening PII + seguridad | review de RLS/RBAC, prueba de acceso, auditoría, pen-test interno | todos |

Orden crítico: **R1 → R2 → R3** primero (legajo es base de todo). Ausencias (R5–R7) y
recibos (R8) pueden paralelizarse tras R3. Dashboard (R9) cierra al final.

---

## 9. Riesgos

| # | Riesgo | Impacto | Mitigación |
|---|--------|---------|-----------|
| **1** | **PII masiva** (DNI/CUIL/CBU/salud) — riesgo central | Legal (Ley 25.326), reputacional | Separación de tablas por sensibilidad; RLS estricta own-or-RRHH; buckets privados + signed URLs efímeras; auditoría de todo acceso; permisos `🔒` segregados |
| **2** | **Dato sensible de salud** (licencias/ART) | Categoría especial Ley 25.326 | Permiso dedicado `rrhh:licencia.salud.read`; acceso solo `rrhh_admin`; auditoría reforzada; almacenamiento aislado |
| **3** | Recibo PDF = CUIL+CBU+salario+firma en un solo archivo | Fuga de alto impacto | Bucket privado, nunca URL pública; descarga auditada; sin parseo del contenido financiero |
| **4** | Confusión legajo ↔ `profiles` | Datos duplicados/inconsistentes | `profiles` ≠ legajo; relación 1:0..1 explícita; legajo es la fuente de verdad del empleado |
| **5** | Cambios normativos (días de vacaciones, licencias) | Cálculo desactualizado | Reglas en tabla parametrizada con vigencia; cambio = INSERT, no deploy |
| **6** | Tentación de liquidar sueldos | Fuera de alcance, riesgo contable | Límite duro: RRHH no liquida; solo novedades + repositorio |
| **7** | Escritura directa salteando workflow | Estados inconsistentes, fraude | RPC-first + guards `via_rpc` + RLS escritura solo admin + append-only |
| **8** | Borrado de evidencia (solicitudes/novedades) | Pérdida de trazabilidad legal | Append-only (`tg_forbid_delete_rrhh`), anulación lógica con motivo |
| **9** | Migración de enum mal aplicada | Deploy roto (mismo error que evitan 0021/0029/0052) | `0056` aislada y committeada antes de usar `'rrhh'` |
| **10** | Supervisor ve PII de su equipo | Sobre-exposición | Supervisor ve datos **laborales** del equipo, no PII personal/bancaria |
| **11** | Onboarding masivo del legajo inicial (~17+ empleados) | Carga manual, errores | Plan de carga inicial validado (importación controlada, no se versiona PII en el repo) |

---

## 10. Recomendaciones

1. **Aprobar el diseño antes de tocar la base.** Congelar §3–§5 (modelo, workflow,
   roles) como hizo ERP-A con `ERP_A_TREASURY_DESIGN.md`. La implementación arranca
   recién en R1.
2. **PII-first, no feature-first.** El primer trabajo técnico real (R2/R3) debe nacer ya
   con RLS, separación de sensibilidad y auditoría — no agregarlas después.
3. **Reglas de vacaciones parametrizadas desde el día uno.** Evita deploys por cambios
   de convenio/ley.
4. **No parsear los recibos.** El PDF es el documento legal; indexar solo metadatos.
   Validado contra el formato real SECAC 2026-05.
5. **Reutilizar, no reinventar.** RBAC, email/notificaciones, Storage, patrón lib y patrón
   migración ya existen y están probados en producción. RRHH los espeja.
6. **Cálculo en la base, siempre.** Saldos, antigüedad, ausentismo → vistas. TS orquesta.
7. **Carga inicial del legajo como mini-proyecto aparte**, con validación de DNI/CUIL/CBU
   y sin versionar PII en el repositorio de código.
8. **Compliance en el loop** para el tratamiento de datos de salud y la política de
   retención/acceso (Ley 25.326) antes de R8/R10.

---

### Anexo — Nota sobre los recibos 2026-05

El archivo de recibos de mayo 2026 (Verotin S.A.) fue usado **únicamente** para validar
el formato del documento y dimensionar el repositorio (modelo SECAC, 2 páginas/empleado,
encabezado + grilla de conceptos + total neto + cuenta + firmas). **No se copió ningún
dato real de empleados a este documento ni al repositorio de código.** El PDF permanece
fuera del control de versiones; en producción, recibos de este tipo se almacenan en el
bucket privado `rrhh-recibos` con acceso auditado (§3.5, §2.3).

---

*Fin del documento. Diseño congelado pendiente de aprobación. No implementar sin autorización explícita.*
