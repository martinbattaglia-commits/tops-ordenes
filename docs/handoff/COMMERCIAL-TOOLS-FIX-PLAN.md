# COMMERCIAL-TOOLS-FIX-PLAN — TOPS NEXUS

**Fecha:** 2026-06-08 · Plan de fix (NO aplicado). Herramientas comerciales en blanco en prod.
**Tipo:** config-only en `netlify.toml`. **No toca** código de producto, CRM360, Compliance, RRHH, Drive.

---

## Fix mínimo (recomendado)
Alinear `netlify.toml` con la intención de `next.config`: cambiar el `X-Frame-Options` global de `DENY` a `SAMEORIGIN`.

`netlify.toml`, bloque `[[headers]] for = "/*"`:
```diff
-    X-Frame-Options = "DENY"
+    X-Frame-Options = "SAMEORIGIN"
```
- **Por qué SAMEORIGIN:** permite embeber recursos **del mismo origen** (las herramientas en `/tools/*` dentro de `/comercial/herramientas`), y **sigue bloqueando** que cualquier sitio externo enmarque la app (anti-clickjacking). Es exactamente lo que ya hace `next.config`.
- Elimina el conflicto DENY↔SAMEORIGIN: ambas fuentes quedan en `SAMEORIGIN`.

### Alternativas (no recomendadas / opcionales)
- **B — Excluir solo `/tools` del DENY:** agregar un `[[headers]] for = "/tools/*"` con `X-Frame-Options = "SAMEORIGIN"` y dejar el resto en DENY. Más quirúrgico, pero deja dos políticas distintas y no resuelve la pestaña Contrato si usa otra ruta. Menos consistente que A.
- **C — Quitar el header de `netlify.toml` y confiar en `next.config`:** funciona si el plugin propaga next.config a estáticos, pero es menos explícito. A es más seguro.

## Verificación post-fix (tras redeploy)
1. `/comercial/herramientas/cotizador` (sesión real) → el iframe **renderiza** el cotizador (no en blanco).
2. Idem `propuesta-anmat` y `propuesta-general`.
3. DevTools → Network → `/tools/cotizador/index.html` → `200` + `X-Frame-Options: SAMEORIGIN` (sin error de framing en Console).
4. Regresión de seguridad: confirmar que un sitio **externo** NO puede enmarcar la app (SAMEORIGIN lo sigue impidiendo).
5. Bonus: pestaña **Contrato** de la Ficha 360° también renderiza (mismo root cause).

## Despliegue del fix (cuando lo autorices)
- Cambio en `netlify.toml` → requiere **commit + push a `main` + build** (los headers se aplican en deploy).
- Pasos exactos: ver `FINAL-DEPLOY-RUNBOOK.md` (push refspec explícito a `main`, FF desde `3b12c26`).
- Rollback: `ROLLBACK-PLAN.md` (republicar deploy previo si algo sale mal).

## Notas
- **No requiere tocar** los HTML de las herramientas ni `ToolEmbed.tsx` (todo correcto).
- **Riesgo:** mínimo. SAMEORIGIN es estándar y ya es la política declarada en `next.config`; solo se alinea Netlify.
- **Pendiente de tu OK:** no se aplicó el cambio, no se commiteó, no se redeployó (según tu instrucción "auditar primero").
