# TOPS NEXUS — RRHH · ADDENDUM DE ARQUITECTURA v1.2.1

## Fail-Closed Security Hardening (cierre de FA-1)

> **Propósito:** cerrar definitivamente el único hallazgo mayor abierto de la auditoría final
> (`RRHH_FINAL_AUDIT_REPORT.md` → **FA-1**, F4): posible *fail-open* en la RPC que emite las signed
> URLs de recibos y documentos RRHH.
> **Naturaleza:** addendum de **endurecimiento de seguridad**, puramente documental. **No** modifica
> arquitectura funcional, modelo de datos ni storage. No implementa, no migra, no toca producción,
> sin commit, sin PR.
> **Supersesión:** complementa v1.2 (cuyo modelo de aislamiento de PII queda **vigente**). Donde
> v1.2 describe la capa de autorización RPC, **v1.2.1 prevalece**.
> **Fuente de verdad:** `arsksytgdnzukbmfgkju`. **Fecha:** 2026-06-07. **Versión:** 1.2.1.

---

## 0. Resumen ejecutivo

La auditoría final confirmó que RRHH está **arquitectónicamente sano**: PII aislada (F1), RBAC sin
colisiones (F2), storage dedicado (F3), workflow completo (F5), KPIs calculables (F6), roadmap
monotónico (F7) y dominios separados (F8). El único bloqueante es **FA-1**: la capa RPC de acceso a
documentos podía quedar *fail-open*.

Este addendum lo cierra con **tres reglas obligatorias**, todas heredadas de evidencia real de
Nexus:

1. **Guard fail-closed obligatorio:** toda RPC RRHH autoriza con `coalesce(has_permission(...),
   false)`. Nunca `has_permission(...)` sin `coalesce`. (Lección de `0055_treasury_security_fix.sql`.)
2. **Prohibición de `current_role()` como autorización:** la autorización RRHH es RBAC + propiedad.
   `current_role()`/`user_role_t` **no** se usan para decidir acceso. (Custody usa `current_role()`;
   RRHH **no** copia eso.)
3. **"Mirror custody" redefinido:** se reutiliza la **estructura** (RPC `security definer` →
   autoriza → audita lectura → devuelve *grant* para firmar la URL), **no** la expresión de
   autorización.

Con estas reglas, FA-1 queda cerrado y RRHH queda listo para una última auditoría documental.

---

## 1. El problema (FA-1), con evidencia

### 1.1 Caso Tesorería — el bug y su corrección
`has_permission(slug)` se define (`0009_rbac.sql:164-174`) como:
```sql
select exists ( … user_roles ⋈ role_permissions ⋈ permissions … where p.slug = p_slug )
       or public.current_role() = 'admin';
```
Si el usuario **no tiene** `profiles.role`, `current_role()` devuelve **NULL**, y
`exists(false) OR NULL = NULL`. Entonces un guard imperativo:
```sql
if not has_permission(...) then raise ... ;   -- not NULL = NULL  ⇒ el IF no dispara
```
queda **fail-open** (`0055_treasury_security_fix.sql:7-12`). Tesorería lo corrigió envolviendo el
guard:
```sql
if not coalesce(public.has_permission('tesoreria.create'), false) then   -- 0055:51
   raise exception 'FORBIDDEN: requiere permiso tesoreria.create' using errcode='42501';
end if;
```
`NULL ↓ FALSE ⇒ FAIL-CLOSED`.

### 1.2 Caso Custody — por qué NO se copia su autorización
`emit_custody_signed_url` (`0037_custody_storage.sql:141-167`) autoriza así:
```sql
v_role := public.current_role();
if v_role is null then raise 'sin perfil/rol: acceso denegado'; end if;
if v_bucket = 'custody-pii' then
   if v_role not in ('admin','supervisor') then raise '… restringido a admin/supervisor'; end if;
…
```
Es **fail-closed** (chequea `null` explícito), pero autoriza con **`current_role()`** — el sistema
legacy `user_role_t`. Para RRHH eso es inaceptable: reintroduciría la dependencia legacy que toda la
remediación v1.1/v1.2 eliminó, y daría acceso a `supervisor`/`operaciones`. **RRHH copia la
estructura de custody, no su autorización.**

---

## 2. Decisión arquitectónica — "mirror custody" redefinido

| Aspecto | ✅ Se reutiliza (estructura) | ❌ No se reutiliza (autorización) |
|---------|------------------------------|-----------------------------------|
| Forma de la RPC | `security definer` que valida → audita → devuelve *grant* `{bucket,path}`; la app firma la URL con el SDK | — |
| Auditoría de lectura | Insert append-only por cada `view`/`download` (en `rrhh_document_audit`) | el `audit_log` genérico de custody |
| **Autorización** | — | `current_role()` / `user_role_t` / `v_role not in (...)` |
| Decisión de acceso | `coalesce(has_permission('rrhh.*'), false)` **+** propiedad (`empleado.profile_id = auth.uid()`) | cualquier rol legacy |

> Regla de oro: la **forma** se hereda de custody; la **decisión de acceso** es 100% RBAC +
> propiedad, fail-closed.

---

## 3. Reglas obligatorias

### R1 — Guard fail-closed
Toda RPC RRHH que proteja recursos usa:
```sql
coalesce(public.has_permission('<slug>'), false)
```
**Prohibido:** `has_permission(...)` sin `coalesce`.

### R2 — Sin `current_role()` como autorización primaria
La autorización RRHH **no** depende de `current_role()` ni de valores de `user_role_t`. (El bypass
de admin ya vive **dentro** de `has_permission` —`… OR current_role()='admin'`, `0009:174`— y es
aceptable como superusuario; no se agrega `current_role()` adicional en los guards RRHH.)

### R3 — Propiedad explícita para el empleado
El acceso del empleado a lo propio se expresa por pertenencia, no por rol:
```sql
exists (select 1 from public.rrhh_empleados e
        where e.id = <tabla>.empleado_id and e.profile_id = auth.uid())
```

### R4 — Toda signed URL vía RPC auditada
Ningún bucket `rrhh-*` tiene policy de lectura para `authenticated`. El binario se obtiene **solo**
por la RPC, que **audita** la lectura antes de devolver el *grant*.

---

## 4. Guard canónico RRHH (patrón oficial)

> Decisión heredada del incidente corregido por `0055_treasury_security_fix.sql`.

### 4.1 Guard de permiso (acceso por rol RBAC)
```sql
-- FAIL-CLOSED: NULL ↓ FALSE. Nunca `if not has_permission(...)` sin coalesce.
if not coalesce(public.has_permission('rrhh.recibos.read'), false) then
   raise exception 'ACCESS_DENIED: requiere permiso rrhh.recibos.read'
     using errcode = '42501';
end if;
```

### 4.2 Guard combinado permiso-o-propiedad (caso típico: empleado ve lo suyo)
```sql
-- Acceso si: tiene el permiso RBAC (fail-closed)  O  es el dueño del documento.
if not (
     coalesce(public.has_permission('rrhh.recibos.read_all'), false)
  or exists (select 1 from public.rrhh_empleados e
             where e.id = v_empleado_id and e.profile_id = auth.uid())
) then
   raise exception 'ACCESS_DENIED' using errcode = '42501';
end if;
```

### 4.3 Esqueleto de la RPC de signed URL (estructura custody + autorización RRHH)
```sql
create or replace function public.emit_rrhh_signed_url(p_target text, p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_empleado_id uuid; v_bucket text; v_path text; v_redacted boolean; v_slug text;
begin
  -- 1) localizar el recurso + dueño
  -- (select … into v_empleado_id, v_bucket, v_path, v_redacted from rrhh_documents/rrhh_receipts where id = p_id)
  if not found then raise exception 'NOT_FOUND' using errcode='no_data_found'; end if;
  if v_redacted then raise exception 'REDACTED: PII eliminada — sin acceso'; end if;

  -- 2) AUTORIZACIÓN fail-closed: permiso RBAC  O  propiedad. (R1+R2+R3)
  v_slug := case p_target when 'receipt' then 'rrhh.recibos.read_all'
                          when 'health'  then 'rrhh.salud.read'
                          else 'rrhh.legajo.read_all' end;
  if not (
       coalesce(public.has_permission(v_slug), false)
    or exists (select 1 from public.rrhh_empleados e
               where e.id = v_empleado_id and e.profile_id = auth.uid())
  ) then
     raise exception 'ACCESS_DENIED' using errcode='42501';
  end if;

  -- 3) AUDITORÍA de lectura (append-only) ANTES de devolver el grant. (R4)
  insert into public.rrhh_document_audit (target, target_id, actor_id, action, detail)
  values (p_target, p_id, auth.uid(), 'download', jsonb_build_object('reason', p_reason));

  -- 4) GRANT (la app firma la URL con el SDK; la firma no es SQL).
  return jsonb_build_object('bucket', v_bucket, 'path', v_path, 'issued_by', auth.uid(), 'issued_at', now());
end; $$;
```

### 4.4 Nota sobre slugs de permisos (alineación con el RBAC real)
El RBAC productivo usa **notación con punto** (`tesoreria.create`, `cockpit.view`, `documental.view`
— `0009`/`0055`). Por consistencia, los permisos RRHH adoptan el mismo formato (`rrhh.recibos.read`,
`rrhh.recibos.read_all`, `rrhh.legajo.read`, `rrhh.legajo.read_all`, `rrhh.salud.read`,
`rrhh.recibos.upload`, `rrhh.solicitud.create`, `rrhh.solicitud.approve_l1/_l2`, `rrhh.audit.read`,
…). La notación `rrhh:*` usada ilustrativamente en addenda previas queda **normalizada a punto**.

---

## 5. Alcance

La regla fail-closed (R1–R4) aplica a **toda operación protegida** de RRHH:

| Recurso / operación | Slug (ejemplo) | Acceso |
|---------------------|----------------|--------|
| Recibos — ver/descargar | `rrhh.recibos.read_all` / propiedad | empleado (propio) · RRHH |
| Documentos laborales (legajo) | `rrhh.legajo.read_all` / propiedad | empleado (propio) · RRHH |
| Documentación médica / ART | `rrhh.salud.read` / propiedad | RRHH (gating estricto) · compliance (excepción) |
| Legajo (datos estructurados: dni/cuil) | `rrhh.empleado.read_all` / propiedad | RRHH · empleado (propio) |
| Datos bancarios (CBU) | `rrhh.bancario.read` / propiedad | RRHH · empleado (propio) |
| Signed URLs / descargas / visualización | vía `emit_rrhh_signed_url` | siempre auditado |
| Carga de recibos/documentos | `rrhh.recibos.upload` / `rrhh.legajo.write` | RRHH |

> **m-F1 cerrado:** la prohibición de `current_role()` y el guard fail-closed aplican también a las
> **tablas de PII estructurada** (`rrhh_empleados`, `rrhh_empleado_bancario`), no solo a documentos.

---

## 6. Checklist de seguridad (obligatorio para PASS de F4)

```
☐ No existe autorización mediante current_role()
☐ No existe `if not has_permission(...)` sin coalesce
☐ Todas las autorizaciones usan coalesce(has_permission(...), false)
☐ Todas las signed URLs se emiten vía RPC (emit_rrhh_signed_url)
☐ Toda lectura de PII queda auditada (rrhh_document_audit, append-only)
☐ Operaciones NO puede acceder (sin permisos rrhh.*; ausente de toda RLS RRHH)
☐ Supervisor NO puede acceder a documentos PII (jerarquía ≠ acceso a PII)
☐ Empleado accede SOLO a sus propios documentos (propiedad profile_id = auth.uid())
☐ RRHH accede según permisos RBAC (has_permission, fail-closed)
☐ Datos de salud con gating estricto y aislados (rrhh-health + rrhh.salud.read)
```

---

## 7. Impacto sobre la línea de versiones

```
v1.0  diseño funcional + modelo de datos + PII-first
  ↓
v1.1  M1–M6 (documental reuse [reemplazado], roles, roadmap, horas extra, ausentismo, workflow)
  ↓
v1.2  remediación PII: almacén RRHH dedicado + RLS RBAC/propiedad + RPC de acceso
  ↓
v1.2.1  endurecimiento fail-closed de la capa RPC (este addendum)
```

**v1.2.1 NO modifica:**
- ❌ arquitectura funcional (submódulos, dashboard, portal, calendario, reportes)
- ❌ modelo de datos (tablas, relaciones, enums)
- ❌ storage (buckets `rrhh-*`, separación de dominios)
- ❌ workflow, KPIs, roadmap

**v1.2.1 SÍ:**
- ✅ fija el guard canónico fail-closed (`coalesce(..., false)`)
- ✅ prohíbe `current_role()` como autorización en RRHH
- ✅ redefine "mirror custody" (estructura, no autorización)
- ✅ normaliza los slugs de permisos a notación con punto
- ✅ cierra el menor m-F1 (regla extendida a PII estructurada)

> Menores **no de seguridad** que permanecen abiertos (no bloqueantes, a cerrar en implementación):
> estado de entrada de OT por supervisor (m-F5a), semántica `cantidad_dias` en `hora_extra` (m-F5b),
> turnos rotativos en `rrhh_jornada` (m-F6), etiqueta de dependencia R3→`0058` (m-F7), vector de
> grant de `rrhh.solicitud.approve_l1` a jefes de línea.

---

## 8. Veredicto del addendum

> ## FA-1 — `CLOSED` · RRHH `READY FOR FINAL DOCUMENTARY AUDIT`

El hallazgo mayor FA-1 queda cerrado a nivel de diseño: la capa de autorización RPC tiene un patrón
canónico fail-closed, sin `current_role()`, auditado, con propiedad explícita y permisos RBAC en
notación real. No quedan hallazgos **críticos** ni **mayores** abiertos; los menores remanentes son
no bloqueantes y de implementación.

Este addendum **no** se auto-otorga `ARCHITECTURE READY`: corresponde a la última auditoría
documental verificar el checklist del §6 contra el diseño consolidado (v1.0 + v1.1 + v1.2 + v1.2.1)
y, de pasar F4, declarar:

```
ARCHITECTURE READY
```

---

*Fin del addendum v1.2.1. Documental — no se implementó, no se migró, no se tocó producción, sin commit.*
*Próximo paso sugerido: auditoría documental final (verificación del checklist §6 y cierre del dominio).*
