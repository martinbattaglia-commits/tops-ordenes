# RBAC-PERMISSION-QA-REPORT — TOPS NEXUS

**Fecha:** 2026-06-08 · Plan de QA para el cambio RBAC (Gerencia Comercial + Finanzas/Administración).
**Estado:** plantilla a ejecutar **post-implementación** (cambio aún no aplicado — pendiente de decisión de gobernanza, ver AUDIT §0.bis).
**Nota:** el estado RBAC actual de PROD está auditado en `RBAC-QA-REPORT.md` (doc previo, no modificado): `user_roles`=0, fail-open global, 52 permisos, 11 roles legacy.

---

## Validación (ejecutar logueado con cada rol, tras seedear roles+user_roles)

### Gerencia Comercial · Finanzas y Administración (idéntico)
| Caso | Esperado | Resultado |
|---|---|---|
| Sidebar: sección **SISTEMA** | No visible | ☐ |
| Sidebar: **RRHH → Documentación** | No visible | ☐ |
| Sidebar: resto (Cockpit, Comercial, Compras, Operaciones, WMS, Pedidos, Compliance, Drive, Facturación, Tesorería, RRHH[Dashboard/Empleados/Solicitudes/Novedades/Mi Espacio]) | Visible | ☐ |
| URL directa `/settings`, `/settings/roles`, `/settings/users`, `/settings/centros-costo`, `/settings/tracking`, `/organigrama`, `/templates` | Bloqueado (AccesoRestringido/403) | ☐ |
| URL directa `/rrhh/documentos` | Bloqueado | ☐ |
| URL directa de módulo permitido (`/comercial/oportunidades`, `/tesoreria`, `/anmat`, `/drive`) | Accede | ☐ |
| API de Sistema/Settings | 403 | ☐ |
| API de RRHH-documentos | 403 | ☐ |
| API de módulo permitido | 200 | ☐ |

### Regresión (otros usuarios)
| Caso | Esperado | Resultado |
|---|---|---|
| super_admin / Presidencia | Ve **todo** (incl. Sistema y RRHH→Documentación) | ☐ |
| Usuario sin asignación (si Estrategia B / fallback por-usuario) | Comportamiento previo, no pierde acceso | ☐ |
| Smoke núcleo (CRM360, Digital Twin, Drive, Facturación, herramientas) | Sin regresión | ☐ |

## Dispositivos / UI
| Check | Resultado |
|---|---|
| Desktop — sidebar refleja permisos | ☐ |
| Mobile (bottom nav / sidebar) refleja permisos | ☐ |
| Dark mode / contraste de `AccesoRestringido` | ☐ |

## Verificación técnica (asistente, pre-deploy)
- [ ] `tsc --noEmit` PASS · `next lint` PASS · `next build` PASS
- [ ] Gating NO solo-UI: probar **URL directa + API** (no solo el sidebar)

## Criterio de cierre
- Ambos roles: Sistema + RRHH→Documentación **inaccesibles** por sidebar, URL y API; resto operable.
- Sin regresión para otros usuarios. Enforcement real (no hardcode, no solo ocultar UI).

## Rollback
- Código: revertir commit del changeset (Netlify republica el deploy previo).
- DB (aditiva): quitar filas `user_roles` de esos usuarios (vuelven a fallback) o `RBAC_ENFORCE=0`. Sin DROP.
