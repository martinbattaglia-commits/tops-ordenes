# CAPITAL-HUMANO-WORKFLOWS

**Fecha:** 2026-06-08 · Complementa ARCHITECTURE/DATA-MODEL. Procesos digitalizados (no copia de PDFs).

---

## 1. Solicitudes (workflow base — EXISTE, se extiende con firma/PDF)

```
Empleado (Mi Espacio)
  └─ completa formulario (tipo + subtipo + fechas + motivo)        rrhh_solicitud_crear → estado=borrador
  └─ Envía                                                          rrhh_solicitud_enviar → pendiente_supervisor
Supervisor (RLS equipo)
  └─ Aprueba L1 / Rechaza                          rrhh_solicitud_aprobar_l1 / _rechazar → pendiente_rrhh | rechazada
Director de Operaciones / RRHH (rrhh.edit)
  └─ Aprueba L2 / Rechaza                          rrhh_solicitud_aprobar_l2 / _rechazar → aprobada | rechazada
Al aprobar L2:
  └─ rrhh_sign_solicitud  → integrity_hash (sha256 canónico) + sellos de firma (empleado/supervisor/director)
  └─ genera PDF institucional → rrhh_documents (pdf_document_id) → queda en Legajo digital
  └─ genera rrhh_novedades (computa_ausentismo, periodo, cantidad) → alimenta saldos/dashboard
Estados terminales: aprobada · rechazada · cancelada (por empleado, pre-aprobación) · anulada (rrhh.admin, post).
Auditoría: cada paso → rrhh_solicitud_eventos (actor, nivel, ts, comentario).
```

**Tipos / subtipos** (enums existentes, mapeados a los formularios reales):
| Tipo | Subtipo | Form fuente |
|---|---|---|
| `vacaciones` | — | Planilla + "Período de Descanso Anual" |
| `permiso` | `retiro` | **Permiso de Retiro** (día + hora de salida + motivo) |
| `permiso` | `inasistencia` | **Permiso de Inasistencia** (día + motivo) |
| `permiso` | `llegada_tarde` | (variante de retiro/llegada) |
| `licencia` | `licencia_subtipo_t` (enfermedad/familiar/estudio/…) | Certificados adjuntos |
| `horas_extra` | recargo `al_50/al_100` | `rrhh_horas_extra_detalle` |
| `especial` | libre | Solicitud especial |

---

## 2. Vacaciones (NUEVO motor sobre `rrhh_novedades`)

```
Entitlement = escala por antigüedad (rrhh_vacaciones_escala) a la fecha de corte del período.
  antigüedad = age(corte, fecha_reconocida) → 14/21/28/35 días.
Saldo (vista rrhh_vacaciones_saldo):
  disponibles = correspondientes − tomados(confirmados) ; planificados = no confirmados.
Planificación (rrhh_vacaciones_periodo):
  RRHH/empleado carga períodos (fraccionamiento X+Y; admite 3.5 = medio día visto en planilla).
  RPC rrhh_vacaciones_planificar valida:
    · saldo suficiente
    · ventana legal 1-oct→30-abr (warning configurable)
    · superposición por depot/sector (control de choques)
Notificación legal (rrhh_vacaciones_notificar):
  genera "Período de Descanso Anual" (PDF legal) → estado período = notificado
  → flujo de acuse: empleado confirma recepción → certificación de goce (al reintegro).
Visualización:
  · Calendario corporativo (por mes/depot) · Dashboard (pendientes/planificados) · Control de superposición.
```

### Formulario legal "Período de Descanso Anual" (multi-sección, del adjunto)
1. **Notificación** (empleador): período de N días, desde–hasta inclusive + firma empleador.
2. **Acuse** (empleado): "me notifico…" + firma empleado.
3. **Certificación de goce** (empleado, al reintegro) + firma.
→ Modelado como 3 estados/sellos sobre `rrhh_vacaciones_periodo` + PDF con las 3 secciones.

---

## 3. Permisos (Retiro / Inasistencia) → PDF institucional

```
Empleado completa (Mi Espacio) → workflow §1 (permiso/retiro | permiso/inasistencia)
Al aprobar:
  → integrity_hash + firmas (empleado + "Por VEROTIN S.A." = firma empleador/director)
  → PDF con membrete TOP'S (Agustín Magaldi 1765 · logisticatops.com), layout institucional
  → rrhh_documents (asociado al legajo)
```
- **Permiso de Retiro:** campos día + **hora de salida** + motivo.
- **Permiso de Inasistencia:** día + motivo; firma empleado + "Por VEROTIN S.A.".

---

## 4. Firma digital (espejo exacto OC/OS)

| Aspecto | OC/OS (existente) | RRHH (CH 1.0) |
|---|---|---|
| Integridad | `integrity_hash` = sha256 de JSON canónico (`compras/totals.ts`) | idéntico, sobre el contenido de la solicitud |
| Firma | `signature_hash` al firmar | `firma_{empleado,supervisor,director}` jsonb `{actor_id, ts, hash}` |
| PDF | `@react-pdf` (`compras/pdf/PoPdfDocument.tsx` + `build.ts`) | `rrhh/pdf/*` (mismos componentes/estilo) |
| Storage | bucket + signed URL | `rrhh_documents` + `emit_rrhh_signed_url` (existe) |
| Auditoría | trail | `rrhh_solicitud_eventos` (existe) |

**Firmantes según corresponda:**
- Solicitud del empleado: firma **empleado** (al enviar) → **supervisor** (L1) → **director** (L2).
- Vacaciones (notificación): firma **empleador** (notifica) → **empleado** (acuse) → **empleado** (certificación goce).

---

## 5. PDF — generación
- Reusar el pipeline `@react-pdf` de Compras (`lib/compras/pdf/`). Crear `lib/rrhh/pdf/`:
  - `PermisoRetiroPdf.tsx`, `PermisoInasistenciaPdf.tsx`, `PeriodoDescansoAnualPdf.tsx`, `SolicitudGenericaPdf.tsx`.
  - Header institucional compartido (logo TOP'S, domicilio VEROTIN). Footer con `integrity_hash` + QR (como OC) opcional.
- El PDF se genera **al aprobar/firmar** (server action → build → upload a `rrhh_documents`).

---

## 6. Dashboard RRHH (indicadores)
Derivados en la base (vistas/counts), nunca en cliente:
- Dotación total / Activos / En licencia (de `rrhh_empleados.estado`).
- Vacaciones pendientes (vista saldo) · Solicitudes pendientes (`rrhh_solicitudes` por estado).
- **Ausentismo** (de `rrhh_novedades.computa_ausentismo` por período).
- **Rotación** (altas/bajas por período de `rrhh_empleado_historial`).
- **Próximos vencimientos** (documentos: ART/seguro/exámenes con fecha_vencimiento).

---

## 7. Mi Espacio (autoservicio, `mi_espacio.view`)
- Mi legajo (solo lectura de lo propio) · Mis solicitudes (crear/enviar/cancelar) · Mis vacaciones (saldo + planificación propia + acuse de notificación) · Mis documentos (descarga signed URL).
- RLS garantiza: nunca datos de terceros.
