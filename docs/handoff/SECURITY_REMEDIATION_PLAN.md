# TOPS NEXUS — SECURITY REMEDIATION PLAN (Gate 5.5)

> Plan de remediación priorizado a partir de `SECURITY_HARDENING_AUDIT.md`. Solo seguridad/producción
> (sin features, sin tocar lógica WMS/Custody). Fecha: 2026-06-04.
> ⚠️ Varios fixes tocan **auth/RLS sobre la DB de PRODUCCIÓN compartida** → requieren OK explícito y, en el
> caso de RLS, una **migración aplicada a mano por Martín** (norma del proyecto).

---

## Clasificación

### P0 — Crítico (bloquea producción; resolver antes de exponer a usuarios reales)

**P0.1 — F-01-R · Cerrar exposición de PII de `profiles` a non-admin (RLS).**
- **Acción:** cambiar la policy SELECT de `profiles` de `id = auth.uid() OR is_staff()` a `id = auth.uid() OR is_admin()`.
- **Riesgo de regresión:** medio. Hay lecturas que asumen "staff ve a todos": el join de `/settings/roles` (`user_roles → profiles`), posibles displays de actor en audit/timeline. Mitigación: esos joins corren bajo páginas admin o vía RPC SECURITY DEFINER; auditar usos de `profiles` por non-admin antes de aplicar. Alternativa menos disruptiva: **vista `profiles_public`** (id, full_name) sin email para lecturas de staff, y restringir la tabla base a admin.
- **Entrega:** nueva migración `00xx_profiles_pii_lockdown.sql` (idempotente) — **propuesta, aplicada por Martín**.
- **Verificación:** como operaciones, `GET /rest/v1/profiles?select=email` debe devolver solo su fila.

**P0.2 — F-04 · Guard de rol en `/settings/roles`, `/settings/roles/new`, `/settings/roles/[slug]`.**
- **Acción:** agregar guard server-side `profiles.role === 'admin'` (mismo patrón que `/settings/users`) que devuelva "Acceso restringido" antes de listar/editar. Cubre el riesgo **antes** de que se aplique 0009.
- **Riesgo:** bajo (solo agrega denegación; no cambia lógica). Code-only.
- **Verificación:** non-admin → "Acceso restringido"; admin → ve la pantalla.

**P0.3 — F-03 · Separación DEV/PROD + PITR + backup de Storage.**
- **Acción (infra, no código):** (a) proyecto Supabase separado para DEV/preview, o feature-flag de DB; (b) habilitar **PITR** en prod; (c) definir backup/replicación de los 3 buckets custody (B3). 
- **Riesgo:** organizativo. **Bloqueante operativo** hasta resolverse.

### P1 — Alto

**P1.1 — F-06 · Etiqueta de rol del shell desde `profiles.role` (autoritativo).**
- **Acción:** en `layout.tsx`, leer `profiles.role` (o `current_role()`) en vez de `user_metadata.role`. Elimina la etiqueta engañosa que causó el falso F-01.
- **Riesgo:** bajo (display-only). Code-only.

**P1.2 — F-05 · Guard de rol en `/settings/centros-costo` (page + mutaciones).**
- **Acción:** agregar chequeo `admin` en la página y en `centros-costo/actions.ts` (patrón fiscal); confirmar/endurecer RLS de `cost_centers`.
- **Riesgo:** bajo. Code-only (+ verificar RLS).

**P1.3 — Decidir destino de RBAC granular (F-02).**
- **Opción A (recomendada corto plazo):** **deshabilitar/ocultar** `/settings/roles*` y dejar documentado que el control es por 4 roles (`profiles.role`) — evita la falsa sensación de RBAC y el riesgo de fail-open.
- **Opción B (mediano plazo):** aplicar `0009_rbac`, **seedear** `user_roles`, y cambiar `checkPermission` de **fail-open → fail-closed** una vez seedeado. No cablear más rutas a `checkPermission` hasta entonces.
- **Riesgo:** medio (B cambia enforcement). Requiere decisión de producto.

### P2 — Medio

**P2.1 — S-05 · Verificación HMAC en webhooks** (`clientify`/`whatsapp`) antes de persistir/automatizar.
**P2.2 — Revisión de paridad de guards:** checklist de que toda página/acción sensible use `profiles.role`/`current_role()` (no `user_metadata`). 
**P2.3 — Hardening headers:** CSP, `x-frame-options`, `referrer-policy` (verificar `next.config`/middleware).

---

## Orden de ejecución sugerido

1. **P0.2** (guard roles) + **P1.1** (label) + **P1.2** (centros-costo) — *code-only, bajo riesgo, sin migración* → aplicar y validar por E2E.
2. **P0.1** (RLS profiles) — *migración, prod* → revisar usos, escribir migración, **Martín aplica**, re-test.
3. **P1.3** (decisión RBAC) — producto.
4. **P0.3** (infra DEV/PROD/PITR/backup) — operaciones/infra.
5. **P2.*** — seguimiento.

> **Nota de alcance:** los ítems code-only (P0.2/P1.1/P1.2) no tocan lógica WMS/Custody ni agregan features —
> solo agregan denegación/guard y corrigen una etiqueta. Los ítems de RLS/infra **no se aplican sin OK**.
