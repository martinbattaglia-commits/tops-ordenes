# COMMERCIAL-TOOLS-VALIDATION — TOPS NEXUS

**Fecha:** 2026-06-08 · Validación del fix `X-Frame-Options SAMEORIGIN` (herramientas comerciales).

---

## Despliegue
| Item | Valor |
|---|---|
| Commit del fix | (ver §git al pie) |
| Push a `main` | FF desde `3b12c26` |
| Redeploy Netlify | disparado por push a `main` |
| Estado Published | ⏳ confirmar en dashboard |

## Validación automática (asistente)
- [ ] Prod `/login` y rutas SSR → `X-Frame-Options: SAMEORIGIN` (era SAMEORIGIN ya por next.config; debe seguir).
- [ ] Header del estático `/tools/*` ya **no** debe ser `DENY`. *(Nota: sin sesión da 307; el header del 200 se confirma en el browser logueado — ver visual.)*
- [ ] Sitio prod alcanzable (no 5xx).

## Validación visual (usuario · sesión real en prod)
Marcar cada uno; capturar Console/Network si falla:
| Pantalla | Esperado | Resultado |
|---|---|---|
| `/comercial/herramientas/cotizador` | **Cotizador renderiza** dentro del iframe (no en blanco) | ☐ |
| `/comercial/herramientas/propuesta-anmat` | **Propuesta ANMAT renderiza** | ☐ |
| `/comercial/herramientas/propuesta-general` | **Propuesta Cargas Generales renderiza** | ☐ |
| Ficha 360° → pestaña **Contrato** | **Template contractual renderiza** (Contrato ANMAT / Aceptación y Condiciones según servicio) | ☐ |

### Confirmación técnica (DevTools, opcional)
- **Console:** ya **no** debe aparecer `Refused to display … X-Frame-Options: deny`.
- **Network:** request a `/tools/<slug>/index.html` → `200` + `X-Frame-Options: SAMEORIGIN`.

### Regresión de seguridad (sanity)
- [ ] Un origen **externo** NO puede enmarcar la app (SAMEORIGIN sigue bloqueando clickjacking de terceros).

## Criterio de cierre
- Las 4 pantallas renderizan + sin error de framing en Console → **fix validado**.
- Si alguna sigue en blanco → revisar en Network el header real del 200 del estático y reportar (no asumir).

## Rollback
Si algo sale mal: Netlify → republicar el deploy previo (`3b12c26`). Detalle en `ROLLBACK-PLAN.md`.

---

## git
- Cambio único: `netlify.toml` `X-Frame-Options DENY → SAMEORIGIN`.
- Sin tocar código de producto, CRM360, Compliance, RRHH, Drive, Digital Twin.
