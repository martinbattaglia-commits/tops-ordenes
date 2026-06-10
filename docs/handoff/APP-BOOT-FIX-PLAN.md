# APP-BOOT-FIX-PLAN — TOPS NEXUS

**Fecha:** 2026-06-09 · Plan de corrección del splash eterno. **NO APLICADO** (pendiente de tu OK).
**Causa raíz:** awaits del `(app)/layout.tsx` duplicados por `0f51acc` (4→8 RTs, sin timeout) + streaming + límite de función Netlify + latencia del dominio nexus. Ver APP-BOOT-ROOT-CAUSE.md.

---

## F0 · MITIGACIÓN INMEDIATA (sin código — restaura el ingreso YA)
**Netlify → Deploys → republicar el deploy previo (`00dfb41`).**
- Restaura el boot al instante (rollback de runtime, sin rebuild).
- **No se pierde nada:** `0f51acc` estaba dormido (no restringía a nadie); volver atrás no cambia comportamiento funcional.
- Mientras tanto se corrige el código (F1+F2) y se redeploya.

## F1 · FIX ESTRUCTURAL — una sola pasada RBAC en el layout (8 RTs → 2-3)
Nuevo helper `getBootPermissions()` (con `cache()` de React por-request) que resuelve **los 3 flags juntos**:
1. `auth.getUser()` — **1 sola vez** (hoy se llama 4 veces).
2. `user_roles` count del usuario — **1 sola vez** (hoy 3 veces).
3. Si count = 0 (no asignado, Estrategia B): devolver `{ exec: true, sistema: true, rrhhDocs: true }` **sin más llamadas** (semántica bootstrap actual).
4. Si count > 0: **una sola** query anidada (`user_roles → roles → role_permissions → permissions.slug`) y derivar los 3 flags del set (`cockpit.view`, `sistema.view`, `rrhh.documentacion.view`).
→ `layout.tsx` reemplaza las 3 llamadas (`canViewExecutiveFinancialBlocks` + `Promise.all(canAccess×2)`) por `await getBootPermissions()`.
→ Los **page guards** (`canAccess` en /settings/*, /rrhh/documentos, etc.) **quedan como están** (corren solo en su página, no en el boot).

## F2 · GARANTÍA ANTI-CUELGUE — presupuesto duro en el layout
Envolver `getBootPermissions()` en `Promise.race` con timeout (p. ej. **3s**):
- Si no resuelve a tiempo → **default permisivo** (igual al bootstrap: `{true,true,true}`) + `console.warn` con timing.
- Resultado: **el layout no puede colgar el boot nunca más**, pase lo que pase con la red/Supabase. La seguridad real no depende de esto (los page guards de URL directa siguen enforced en cada página).

## F3 · (Opcional) Mitigaciones de plataforma
- Evaluar subir el timeout de la función SSR en Netlify (plan/dashboard) — mitiga, no corrige.
- (Backlog) Revisar la latencia del dominio custom (~3-4× vs netlify.app): DNS/proxy del registrador vs apuntar a Netlify DNS/ALIAS directo.

## Qué NO se toca
- Lógica RBAC/Estrategia B (semántica idéntica: no asignado → permitir; asignado → enforce).
- Page guards, migración 0070, mapas, CRM360, módulos.
- Ningún rollout/activación (sigue sin `RBAC_ENFORCE`, sin asignaciones).

## Secuencia propuesta
1. **F0** ahora (vos, 1 minuto) → ingreso restaurado.
2. **F1 + F2** (yo, con tu OK) → `tsc` + `build` PASS → commit → push a `main` → redeploy.
3. **QA boot:** login en `nexus.logisticatops.com` → entra al Cockpit sin splash colgado; repetir en `tops-ordenes.netlify.app`; sidebar correcto; navegación entre módulos fluida.
4. **Verificación de fondo:** logs de la función SSR sin `Task timed out`; Duration del layout ≪ límite.
5. Recién después, retomar el plan RBAC (0070 + asignaciones + QA por perfil) — los flags ya resueltos en una pasada lo soportan igual.

## Validación post-fix (checklist)
- [ ] `nexus.logisticatops.com` → login → **Cockpit carga** (sin splash eterno).
- [ ] `tops-ordenes.netlify.app` → ídem.
- [ ] Navegación entre 5+ módulos sin regresión.
- [ ] Function logs sin timeouts.
- [ ] (Cuando se asignen roles) usuario asignado: sidebar sin Sistema/Documentación; URL directa bloqueada — confirmando que F1 no cambió la semántica.

## Rollback del fix
El de siempre: republicar el deploy previo en Netlify. (F1/F2 no tocan datos.)
