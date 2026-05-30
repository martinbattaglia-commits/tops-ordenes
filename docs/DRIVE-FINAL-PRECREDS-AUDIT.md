# DRIVE-FINAL-PRECREDS-AUDIT.md

**Fecha:** 2026-05-29
**Commit base:** `4d1dbff03f6f690b828f348fb9dec3e36f5e9610` (corto `4d1dbff`)
**Branch:** `feature/nexus-fullstack`
**Modo:** `NO ASUMIR · VERIFICAR` · sin deploy · sin merge · sin commit · sin credenciales
**Objetivo:** auditoría final pre-credenciales sobre los 14 puntos solicitados; buscar críticos/altos sobrevivientes.

---

## 🟢 ACTUALIZACIÓN POST-R22-CLOSURE (2026-05-29)

R22 está **CERRADO** vía Solución B aplicada en `src/lib/rbac/check.ts:122-176` (uso de `createAdminClient()` exclusivamente para el seed-check global, bypassando RLS solo en esa query). R21 cerrado en el mismo turno (warn log explícito).

Ver `docs/R22-CLOSURE-REPORT.md` para evidencia file:line y trace por caso.

**Estado actual de hallazgos:**

| ID | Estado |
|----|--------|
| R20 | abierto (Bajo) |
| R21 | ✅ cerrado |
| **R22** | ✅ **CERRADO** |
| R23 | abierto (Bajo) |
| R24 | abierto (Bajo) |
| R25 | abierto (Bajo) |
| R26 | abierto (Medio) |
| R27 | abierto (Medio) |

**Veredicto actualizado:** 🟢 **READY FOR CREDENTIALS** (revertido desde 🔴).

El resto del documento queda **como referencia histórica del estado anterior al cierre de R22**.

---

## 🔴 Veredicto original (histórico — superado)

> **🔴 NOT READY FOR CREDENTIALS** — bloqueante.

**Razón:** 1 hallazgo nuevo **CRÍTICO** (R22) detectado. Rompe semánticamente el cierre de R4 (RBAC) que el red team anterior había aprobado. El bug es invisible mientras `user_roles` esté vacía (FASE 1), pero **se activa automáticamente cuando se seedeen asignaciones** — es decir, en el primer momento real en que se espera enforcement.

**Regla aplicada:** "1 nuevo crítico → detener avance hacia deploy".

---

## Tabla de hallazgos nuevos

| ID | Hallazgo | Severidad | Estado |
|----|----------|-----------|--------|
| **R20** | `startsWith("/compras/validar")` permisivo — bypass futuro si se agregan rutas hijas | 🟢 Bajo | Abierto, no bloqueante |
| **R21** | `createClient() === null` → fail-open silencioso sin log warn | 🟢 Bajo | Abierto, no bloqueante |
| **R22** | **RLS de `user_roles` filtra el count global → fail-open completo cuando RBAC se seedea parcialmente** | 🚨 **Crítico** | **Bloqueante** |
| **R23** | `pageSize=NaN` no rechaza con 400, propaga a 502 | 🟢 Bajo | UX, no bloqueante |
| **R24** | Rate-limit reset en cold-starts (serverless) | 🟢 Bajo | Mitigado por window 60s |
| **R25** | Rate-limit por IP-shared en redes corporativas (1 usuario afecta 9 inocentes) | 🟢 Bajo | v2 multi-tier |
| **R26** | `isUnderRoot` no captura GaxiosError de Drive (404/403) → 502 en vez de 403 | 🟡 Medio | Info disclosure leve |
| **R27** | `maxDepth=6` puede generar falsos negativos en jerarquías profundas | 🟡 Medio | Correctness, no leak |

**0 nuevos altos.**
**1 nuevo crítico (R22).** ← **bloqueante**.

---

## 🚨 R22 — RBAC bypass por RLS (CRÍTICO)

### Resumen ejecutivo

El cierre de R4 confía en `SELECT COUNT(*) FROM user_roles` para distinguir:
- "RBAC dormido" (tabla vacía → fail-open documentado)
- "RBAC activo" (tabla con rows → enforce)

Pero la RLS de `user_roles` **filtra el count para el usuario que ejecuta la query**. Un usuario regular sin asignación ve `count = 0` aunque la tabla tenga 100 rows asignados a otros usuarios. Conclusión incorrecta → fail-open silencioso → **bypass completo de RBAC**.

### Evidencia objetiva

**Política RLS (`supabase/migrations/0009_rbac.sql:140-143`):**

```sql
drop policy if exists "user_roles read self or admin" on public.user_roles;
create policy "user_roles read self or admin"
  on public.user_roles for select
  using (user_id = auth.uid() or public.current_role() in ('admin','supervisor'));
```

Un usuario regular **solo puede leer SUS PROPIAS rows** de `user_roles`. Admin/supervisor ven todas.

**Código vulnerable (`src/lib/rbac/check.ts:89-114`):**

```ts
// 2. ¿RBAC poblado en toda la DB?
const { count: totalAssignments } = await supabase
  .from("user_roles")
  .select("*", { count: "exact", head: true });

// Caso fallback: tabla user_roles vacía a nivel global → RBAC dormido (FASE 1).
if (!totalAssignments || totalAssignments === 0) {
  console.warn(/* log warn */);
  return { ok: true, /* fail-open */ };
}
```

La query `select * count exact head` corre **bajo la sesión del caller** (no service_role). La RLS aplica. `totalAssignments` refleja solo lo que el caller puede leer.

### Escenario de explotación

**Estado A (hoy, FASE 1 con `user_roles` vacía global):**
- Cualquier user → `count = 0` real → fail-open → enforced=false
- Comportamiento esperado y documentado. ✓ NO hay vulnerabilidad.

**Estado B (post-seed parcial — escenario realista de "primer día con RBAC activo"):**
1. Admin seedea `scripts/seed-rbac-real-roles.sql` para 5 usuarios autorizados (Director, Compliance, etc.)
2. Atacante: cualquier user autenticado sin asignación en `user_roles` (operario nuevo, cuenta dormida, signup abierto, etc.)
3. Atacante hace `GET /api/drive/list`
4. Middleware: ✓ sesión válida
5. Rate-limit: ✓ pasa
6. `checkPermission(req, "compliance.view")`:
   - Sesión OK
   - `count("user_roles")` con RLS → el atacante no se ve a sí mismo en user_roles porque no tiene rows → **count retorna 0 aunque la tabla global tenga 5 rows de otros usuarios**
   - Branch fallback dispara → `enforced=false, ok=true` → **bypass total**
7. Atacante recibe listado completo de Drive corporativo

### Por qué el red team anterior no lo detectó

Mi audit previo (R4) verificó la lógica del helper `checkPermission`, pero **no verificó la interacción con la RLS de la tabla consultada**. Asumí (incorrectamente) que `count()` reflejaba el estado global de la tabla. La RLS de Supabase es transparente al código TypeScript — la query no falla, simplemente retorna data filtrada.

Es exactamente el tipo de bug que `NO ASUMIR · VERIFICAR` está diseñado para encontrar — y esta auditoría final cumplió su propósito.

### Severidad: Crítico

- **Confidencialidad:** sí, leak de toda la estructura del Drive corporativo
- **Integridad:** no, los scopes son lectura (drive.readonly + drive.file)
- **Disponibilidad:** sí (indirecto, vía rate-limit Drive API tras enumeración)
- **Trivialidad de explotación:** alta — atacante necesita cuenta autenticada + 1 fetch en DevTools
- **Pre-condiciones:** RBAC parcialmente seedeado (escenario probable de "primer día post-seed")
- **Visibilidad:** silencioso, log warn `fallback-allow` indistinguible de FASE 1 legítima

### Opciones de fix (no aplicado, esperando autorización)

#### Opción A — Migración nueva con función SECURITY DEFINER

```sql
-- supabase/migrations/0012_rbac_is_seeded.sql (propuesto)
create or replace function public.is_rbac_seeded()
returns boolean
language sql
security definer  -- ← clave: bypass RLS para esta función
stable
as $$
  select exists (select 1 from public.user_roles limit 1);
$$;

grant execute on function public.is_rbac_seeded() to authenticated;
```

Y en `check.ts`:

```ts
const { data: seeded } = await supabase.rpc("is_rbac_seeded");
if (!seeded) { /* fail-open con warn */ }
```

**Pros:** correcto semánticamente, function-scoped (no expone otros campos).
**Cons:** requiere aplicar migración → PARIDAD-3 con tracker. Bloqueado por FASE 0 governance.

#### Opción B — Usar SUPABASE_SERVICE_ROLE_KEY en check.ts

```ts
// Cliente con service_role bypass RLS
const adminSupabase = createServiceClient(); // nuevo helper
const { count } = await adminSupabase
  .from("user_roles")
  .select("*", { count: "exact", head: true });
```

**Pros:** sin migración nueva, funciona inmediato.
**Cons:** expone service_role en código server-side; aceptable si solo se usa en rutas autenticadas. Requiere helper nuevo `createServiceClient()`.

#### Opción C — Cambiar fallback a fail-closed

```ts
// Si user no tiene rows en user_roles → 403 (sin chequear count global)
const { data: myRoles } = await supabase
  .from("user_roles")
  .select("role_id")
  .eq("user_id", user.id);

if (!myRoles || myRoles.length === 0) {
  // Sin asignación: 403 estricto
  return { ok: false, status: 403, error: "Sin rol asignado" };
}
```

**Pros:** cero migración, semántica fail-closed estricta.
**Cons:** durante FASE 1 (user_roles totalmente vacío) NADIE puede usar Drive — incluido el director.

**Mitigación práctica para C:** env var `RBAC_ALLOW_UNASSIGNED=1` durante FASE 1, con log warn loud. Cuando se sediean roles, se baja el flag.

#### Opción D — Combinada: chequear self + global protegido

```ts
// 1. Si tengo rows propias → enforce normal (caso post-seed)
const { data: myRows } = await supabase
  .from("user_roles").select("role_id").eq("user_id", user.id);

if (myRows && myRows.length > 0) {
  // RBAC activo para mí → enforce
}

// 2. Si no tengo rows propias → verificar globalmente con RPC SECURITY DEFINER
const { data: seeded } = await supabase.rpc("is_rbac_seeded");

if (!seeded) {
  // RBAC dormido → fail-open documentado
} else {
  // RBAC seedeado pero yo no tengo asignación → 403
  return { ok: false, status: 403, error: "Sin rol asignado" };
}
```

**Pros:** semántica correcta en todos los escenarios.
**Cons:** requiere migración (opción A) + cambios en check.ts.

### Mi recomendación

**Opción B (corto plazo) + Opción A (largo plazo).**

- Hoy: crear `createServiceClient()` helper, usar service_role para el count global. Cero migración. Cierra el crítico.
- Próximo mes: migración 0012 con `is_rbac_seeded()` SECURITY DEFINER + RPC. Limpio, sin service_role para esto.

**Tiempo estimado:**
- Opción B: 30 min (helper + cambio en check.ts + typecheck + build + re-test)
- Migración futura: incluida en próximo gate DB

---

## Detalle de los otros hallazgos

### R20 — `startsWith("/compras/validar")` permisivo (🟢 Bajo)

**Evidencia (`src/lib/supabase/middleware.ts:62`):**

```ts
pathname.startsWith("/compras/validar") ||
```

**Por qué es permisivo:** matchea `/compras/validar`, `/compras/validar/<publicId>`, **pero también** `/compras/validar/admin/api/drive/list` si alguien la creara mañana.

**Mitigación:** sin rutas Drive bajo `/compras/validar` hoy. Deuda futura.

**Fix:** cambiar a regex `^\/compras\/validar\/[A-Z0-9\-]{1,40}$` o usar matcher exacto. NO bloqueante.

### R21 — `createClient() === null` fail-open silencioso (🟢 Bajo)

**Evidencia (`src/lib/rbac/check.ts:69-78`):**

```ts
const supabase = createClient();
if (!supabase) {
  return {
    ok: true,
    userId: "no-client",
    userEmail: null,
    enforced: false,
    permission,
  };
}
```

**Problema:** si Supabase está configurado pero `createClient()` retorna null por motivo no esperado (init failure), pasamos a fail-open sin log warn. Indistinguible de éxito real.

**Fix:** `console.error(JSON.stringify({...}))` antes del fail-open. Trivial.

### R23 — `pageSize=NaN` cae a 502 (🟢 Bajo)

**Evidencia (`src/app/api/drive/list/route.ts:94-95`):**

```ts
const pageSizeRaw = url.searchParams.get("pageSize");
const pageSize = pageSizeRaw ? Number(pageSizeRaw) : undefined;
```

Si `pageSizeRaw === "abc"`, `Number("abc") === NaN`. `pageSize = NaN`. `listChildren` aplica `Math.min(Math.max(NaN ?? DEFAULT, 1), MAX)`. `NaN ?? DEFAULT` evalúa a NaN (`??` solo aplica null/undefined). Math.max y Math.min con NaN → NaN. googleapis recibe `pageSize: NaN` → 400 Bad Request → DriveError → 502 en respuesta.

**Mejor UX:** validar `if (Number.isNaN(pageSize)) return 400` antes de llamar Drive.

### R24 — Rate-limit reset en cold-starts (🟢 Bajo)

**Evidencia:** `src/lib/rate-limit.ts:15` — `const store = new Map<string, Bucket>();` — module-level en proceso.

**Vector:** atacante triggerea cold starts (delay 30+ min entre bursts). Reset del Map → contador a 0. Bypass rate-limit en bursts espaciados.

**Mitigación natural:** Drive API tiene su propio rate-limit (1k/100seg/user) — backstop. Para defensa real distribuida: Upstash Redis. v2.

### R25 — Rate-limit IP-shared (🟢 Bajo)

**Vector:** 10 usuarios en oficina misma IP pública (NAT). Bucket compartido. 1 abusivo (script para tareas legítimas) bloquea a los otros 9 con 429.

**Fix v2:** rate-limit 2-tier (60/min IP pre-auth + 200/min user post-auth).

### R26 — `isUnderRoot` no maneja errores de Drive (🟡 Medio)

**Evidencia (`src/lib/drive/client.ts:585-603`):**

```ts
export async function isUnderRoot(fileId: string, maxDepth = 6): Promise<boolean> {
  const drive = requireDrive();
  // …
  for (let i = 0; i < maxDepth && current; i += 1) {
    const got = await drive.files.get({
      fileId: current,
      // …
    });
    // …
  }
}
```

**Vector:** atacante envía `folderId=<id-inexistente-o-sin-acceso>` a `/api/drive/list`. `isUnderRoot` llama `drive.files.get()` → 404 GaxiosError → propaga → handler captura en rama "Error genérico" → 502 con `error: <mensaje técnico>`.

**Info disclosure leve:**
- 403 = "este folder existe pero no está en tu scope"
- 502 = "este folder no existe O la SA no tiene acceso"

El atacante puede **enumerar IDs válidos vs inválidos** binariamente. Útil para reconocimiento previo a un ataque más serio.

**Fix:** try/catch en `isUnderRoot`, retornar `false` si la query Drive falla con 404/403. Trivial.

### R27 — `maxDepth=6` falsos negativos (🟡 Medio)

Si el árbol real es: `Root / Año / Mes / Cliente / Categoría / Subcat / Quarter / Documento`, son 7 niveles. `isUnderRoot` con maxDepth=6 retorna false en el último nivel → 403 en archivos legítimos.

**Fix:** subir a 10 o caminar sin límite duro (con cache + timeout).

---

## Verificación de los 14 puntos solicitados

| # | Punto | Estado | Hallazgos nuevos |
|---|-------|--------|-------------------|
| 1 | Middleware | ✅ PASS con deuda | R20 (Bajo) |
| 2 | RBAC | 🚨 **FAIL** | **R22 (Crítico)** + R21 (Bajo) |
| 3 | Rate limiting | ✅ PASS con deuda | R23, R24, R25 (todos Bajo) |
| 4 | isUnderRoot() | ✅ PASS con deuda | R26 (Medio), R27 (Medio) |
| 5 | Breadcrumbs | ✅ PASS | herencia de R26 |
| 6 | Drive Browser | ✅ PASS | sin nuevos |
| 7 | AbortController | ✅ PASS | sin nuevos |
| 8 | Logging estructurado | ✅ PASS | sin nuevos |
| 9 | Request IDs | ✅ PASS | sin nuevos |
| 10 | Manejo de errores | ⚠️ deuda | R26 (heredado) |
| 11 | Bounded search | ✅ PASS | sin nuevos |
| 12 | Cache | ✅ PASS | R5 abierto previo, sin nuevos |
| 13 | Build | ✅ PASS | `next build` exit 0, 35 pages |
| 14 | Typecheck | ✅ PASS | `tsc --noEmit` exit 0 |

---

## Tabla de severidad final

| Severidad | Cuenta nueva | Total acumulado abierto |
|-----------|--------------|-------------------------|
| 🚨 Crítico | **1** (R22) | 1 |
| 🔴 Alto | 0 | 0 |
| 🟡 Medio | 2 (R26, R27) | 6 (con R5, R7, R8 previos) |
| 🟢 Bajo | 4 (R20, R21, R23, R24, R25) | varios |
| ⓘ Informativo | 0 | 2 (R12, R13 previos) |

---

## Cierre de auditoría

- **Auditoría completada en 14/14 puntos.**
- **1 hallazgo nuevo bloqueante** (R22) detectado pre-credenciales — el sistema funcionó.
- **0 falsos positivos** — cada hallazgo respaldado con evidencia (file:line + SQL de migración).
- **0 cambios aplicados** — modo strict pre-credentials respetado.

### Veredicto

> **🔴 NOT READY FOR CREDENTIALS** (revertido desde 🟢 previo)

**Próximo gate:** decidir opción de fix para R22 (recomiendo B + A futura), aplicar localmente, re-verificar, re-emitir 🟢.

### Estado oficial actualizado

- 🔴 **NOT READY FOR CREDENTIALS** ← cambio desde 🟢
- 🟡 NOT AUTHORIZED FOR DEPLOY
- 🟡 NOT AUTHORIZED FOR COMMIT
- 🟡 NOT AUTHORIZED FOR PUSH
- 🟡 NOT AUTHORIZED FOR MERGE
- 🟡 NOT AUTHORIZED FOR PRODUCCIÓN

---

## Restricciones honradas

- 🛑 NO DEPLOY · NO MERGE · NO PUSH · NO COMMIT · NO PRODUCCIÓN · NO CARGAR CREDENCIALES
- 🛑 NO ASUMIR — la auditoría descubrió R22 precisamente porque verificó RLS real en migración, no asumió comportamiento del helper
- 🛑 NO INVENTAR — cada hallazgo referencia file:line + SQL verificable
