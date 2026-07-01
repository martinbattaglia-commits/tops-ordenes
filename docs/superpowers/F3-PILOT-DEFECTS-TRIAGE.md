# F3 · Pilot Defects — Triage & Hotfix Plan

> Diagnóstico **read-only** de los 4 defects reportados por Dirección durante la validación piloto manual de Nexus Link F3. **NO se modificó producción. NO se implementó nada.** 2026-07-01.
> Referencias: `F3-PILOT-VALIDATION-LOG.md`, `F3-PILOT-MANUAL-VALIDATION-PACK.md`.

---

## 1. Resumen ejecutivo

Los 4 defects son **reales y reproducidos**, con causa raíz confirmada en código/DB:

| ID | Defecto | Severidad | ¿Bloquea F3? | Tipo de fix |
|---|---|---|---|---|
| **DEFECT-1** | Notificaciones rompe (error boundary) | **Alta/Crítica** | **SÍ** | Frontend (`realtime.ts`) |
| **DEFECT-2** | Miembro/dueño se muestra como UUID | **Alta** | **SÍ** (flujo principal) | Frontend/data-layer (`channel-data.ts`) |
| **DEFECT-3** | Agregar miembros exige UUID | **Media** | Parcial (workaround: canales públicos) | RPC nueva + frontend (por diseño "fase posterior") |
| **DEFECT-4** | Mensaje "Datos inválidos" poco claro | **Baja** | No solo | Frontend (mensaje) |

**Punto clave:** a diferencia del hotfix de búsqueda (`0156`/`0157`, solo DB vía `apply_migration`, sin deploy), **estos fixes son de FRONTEND y requieren un DEPLOY de Netlify** (DEFECT-1/2/4 sin migración; DEFECT-3 propio agrega 1 migración). El deploy conlleva el riesgo **DEPLOY-1** → usar el procedimiento validado (Node 22 + checkout NO-worktree + draft-first).

**Recomendación:** implementar **HOTFIX A+B+C** (frontend, 1 deploy controlado) para desbloquear F3; **DEFECT-3** → decisión de Dirección (aceptar como diferido con workaround de canales públicos, **o** implementar el selector — RPC `connect_search_profiles`).

---

## 2. Evidencia (Etapa 1 — reproducción)

- **DEFECT-1:** navegación a `/connect/notificaciones` (sesión `martin@`) → **error boundary "Algo no salió bien. Se produjo un error inesperado."** (screenshot `~/CODE/defect1-notificaciones.png`). Consola:
  ```
  Error: cannot add `postgres_changes` callbacks for realtime:realtime:notifications:all after `subscribe()`.
    at (app)/layout... · [TOPS Órdenes] uncaught
  ```
- **DEFECT-2:** panel de miembros del canal muestra el UUID (`1f39803f-…`) como identidad (visto en el smoke; confirmado en código: `m.name` llega `null`).
- **DEFECT-3/4:** input "profile_id (uuid)" en el panel de miembros; texto no-UUID → `"Datos inválidos"`.

---

## 3. Causa raíz (Etapa 2)

### DEFECT-1 — colisión de canal realtime
`src/lib/supabase/realtime.ts:31` nombra el canal de forma **determinística por tabla**: `realtime:${table}:${filter ?? "all"}`. Dos componentes suscriben a `notifications`:
- `src/components/shell/NotificationsBell.tsx:44` (campana del top-bar, montada SIEMPRE en `(app)/layout`).
- `src/app/(app)/connect/_components/NotificationCenter.tsx:34` (página `/connect/notificaciones`).

Ambos usan el canal `realtime:notifications:all`. Supabase reutiliza el canal por nombre y **prohíbe agregar `.on('postgres_changes')` después de `.subscribe()`** → excepción **uncaught** → error boundary. **Generalizable:** cualquier par de componentes sobre la misma tabla colisiona (p.ej. 2 `ThreadView` sobre `connect_messages`).

### DEFECT-2 — identidad no resuelta
`src/lib/connect/read/channel-data.ts:38-44` (`listParticipants`) lee `connect_participants(profile_id, member_role, participant_type)` y mapea **`name: null, avatar: null`** (sin join a perfiles). `ChannelView.tsx:179` cae a `{m.name ?? m.profileId ?? "—"}` → muestra el UUID. Existe la view **`profiles_public (id, full_name)`** que resuelve nombre pero **no se usa**.

### DEFECT-3 — agregar miembro por UUID (por diseño)
`ChannelView.tsx:206-213`: input `placeholder="profile_id (uuid)"` + nota **"selector de usuarios: fase posterior"**. `connect_add_member(p_conversation_id uuid, p_profile_id uuid, p_role)` exige `profile_id`. **No existe RPC de búsqueda de perfiles**; `profiles_public` no tiene email → resolver por nombre/email requiere infraestructura nueva.

### DEFECT-4 — mensaje genérico
`channel-actions.ts:49-54` (`addMemberAction`): `profileId: z.string().uuid()`. Un nombre/email → `safeParse` falla → `"Datos inválidos."` (mensaje genérico compartido por todas las actions).

---

## 4. Severidad + ¿bloquea F3? (Etapa 3)

| ID | Severidad | ¿Bloquea F3? | Justificación |
|---|---|---|---|
| DEFECT-1 | **Alta/Crítica** | **SÍ** | La campana está en el layout (siempre montada); todo usuario que abra `/connect/notificaciones` (V7 del piloto) ve el error boundary. Reproducible 100%. |
| DEFECT-2 | **Alta** | **SÍ** | El panel de miembros es flujo principal de canales; mostrar un UUID como identidad no es aceptable para usuarios finales. |
| DEFECT-3 | **Media** | **Parcial** | Bloquea "agregar miembro a canal privado por selección". **Workaround:** canales **públicos** (auto-unión vía `joinChannelAction`) → el piloto puede armar canales sin add-by-UUID. Fue diseñado como "fase posterior". |
| DEFECT-4 | **Baja** | **No (solo)** | Mensaje poco claro; molesto pero no rompe. Corregir junto con DEFECT-3 si se toca la zona. |

*(Confirma la clasificación preliminar de Dirección.)*

---

## 5. Plan de hotfix (Etapa 4)

### HOTFIX-A — DEFECT-1 (canal realtime único) · **Frontend · Crítico**
- **Archivo:** `src/lib/supabase/realtime.ts`.
- **Cambio:** nombre de canal **único por instancia** del hook (evita colisión). Ej.: agregar un sufijo único con `useId()` de React o un `useRef` aleatorio → `realtime:${table}:${filter ?? "all"}:${uid}`. La suscripción por-instancia y su `removeChannel` en cleanup se mantienen. Fija DEFECT-1 y toda colisión análoga.
- **Migración:** ninguna. **DB:** ninguna. **Impacto:** solo realtime del cliente; comportamiento funcional idéntico (cada componente recibe sus eventos).

### HOTFIX-B — DEFECT-2 (identidad humana) · **Frontend/data-layer · Alto**
- **Archivo:** `src/lib/connect/read/channel-data.ts` (`listParticipants`).
- **Cambio:** resolver `profile_id → profiles_public.full_name` (2ª query a `profiles_public` con los ids, o embedding PostgREST si la relación lo permite) y poblar `name` (y avatar/iniciales). Fallback a UUID solo si no hay `full_name`.
- **Migración:** **ninguna** (`profiles_public` ya existe). **Impacto:** panel de miembros muestra nombre; sin cambio de permisos (profiles_public es read-safe).

### HOTFIX-C — DEFECT-4 (mensaje claro) · **Frontend · Bajo**
- **Archivos:** `ChannelView.tsx` (placeholder/ayuda) y/o `channel-actions.ts` (mensaje específico del add-member).
- **Cambio:** mensaje accionable, p.ej. *"Ingresá el ID de usuario (UUID). El buscador por nombre/email llega en la próxima versión."* En vez del genérico "Datos inválidos".
- **Migración:** ninguna.

### DEFECT-3 — decisión de Dirección (2 caminos)
- **Opción D (propia):** nueva migración `0158_connect_search_profiles.sql` — RPC `connect_search_profiles(query)` SECDEF que busca staff interno por `full_name` (y email si se decide exponer), gated por `connect.view`, devolviendo `id + full_name (+email)`; + frontend autocomplete en el panel de miembros. **Migración + frontend + deploy.** Más grande.
- **Opción aceptar-diferido:** documentar como limitación conocida del piloto; usar **canales públicos** (auto-unión) para el piloto; HOTFIX-C mejora el mensaje mientras tanto. Implementar el selector como fast-follow (F3.x o F4-prep).

**Recomendación DEFECT-3:** **aceptar-diferido para el piloto** (canales públicos + HOTFIX-C), y agendar la Opción D como fast-follow. Evita meter una RPC nueva + autocomplete en el hotfix crítico.

### Bundle de hotfix recomendado
**A + B + C** (todo frontend, sin migración) → **1 deploy controlado**. DEFECT-3 fuera del hotfix (decisión).

### Orden de ejecución
1. Rama de trabajo (worktree aislado) → implementar A, B, C con TDD donde aplique.
2. `typecheck` + `lint` + `tests` locales verdes.
3. **Deploy controlado** (procedimiento validado F3.2B): Node 22 + checkout NO-worktree + **draft-first** → smoke draft → promover `--prod` → smoke prod → rollback a deploy sano ante fallo.

---

## 6. Riesgos

| Riesgo | Sev. | Mitigación |
|---|---|---|
| **DEPLOY-1** (outage por toolchain/worktree) | Alta | Node 22 + NO-worktree + draft-first (procedimiento ya validado en F3.2B) |
| HOTFIX-A cambia realtime global | Media | Cambio acotado al naming del canal; cada componente sigue recibiendo sus eventos; cubrir con smoke de notificaciones + mensajería |
| HOTFIX-B expone datos de perfil | Baja | Solo `profiles_public (id, full_name)`, ya read-safe; sin email salvo decisión explícita |
| DEFECT-3 Opción D: RPC nueva | Media | Si se elige, tratar como su propio hotfix (migración `0158` + smoke), separado del bundle A/B/C |
| Regresión en otras páginas realtime | Media | Smoke de `/connect` (mensajería, inbox, actividad) + dashboards con realtime |

---

## 7. Rollback

- **Frontend (A/B/C):** el deploy es reversible por Netlify (re-publish del deploy sano previo = `88add4b`). No hay datos que revertir.
- **DEFECT-3 Opción D (si se implementa):** la migración `0158` (nueva RPC) es reversible con `drop function connect_search_profiles` (o re-aplicar estado previo); reversible e idempotente.
- No se revierten datos.

---

## 8. Smoke tests post-hotfix (Etapa 5)

**Notificaciones (DEFECT-1):**
- Abrir campana (top-bar) → dropdown sin error.
- Abrir `/connect/notificaciones` → **NO error boundary**, render estable, 0 500/502, 0 error crítico de consola.
- Navegar entre `/connect` e Inicio varias veces → sin colisión realtime.

**Miembros (DEFECT-2):**
- Abrir canal → panel de miembros → dueño/miembros muestran **nombre** (no UUID). Avatar/iniciales coherentes.

**Agregar miembro (DEFECT-3, si se implementa D):**
- Buscar usuario por nombre (y email si aplica) → sugerencias → seleccionar → agregar a canal privado → aparece como miembro. No se agregan externos no autorizados.

**Error handling (DEFECT-4):**
- Ingresar texto inválido en add-member → **mensaje claro y accionable** (no "Datos inválidos" genérico).

**Regresión general:**
- Búsqueda sigue OK (0156/0157), mensajería/canales OK, `/api/version` == commit del deploy, 0 5xx.

---

## 9. Recomendación GO / NO GO para implementar

**🟢 GO** para implementar el **bundle A+B+C** (frontend, sin migración) + **1 deploy controlado** — desbloquea DEFECT-1 (crítico) y DEFECT-2 (alto), corrige DEFECT-4. **DEFECT-3 → decisión de Dirección** (recomendado: aceptar-diferido con canales públicos + fast-follow del selector). **Requiere autorización explícita** para: (a) cambios de código, (b) deploy a producción.

**NO GO** a implementar sin autorización (esta ventana fue solo diagnóstico read-only).

---

## 10. Estado / F4

- **Producción NO modificada** (`88add4b`; `0156`/`0157` intactas). Diagnóstico 100% read-only + lectura de código.
- **F3 NO se cierra** hasta resolver/aceptar estos defects.
- 🚫 **F4 sigue BLOQUEADA.**

---

# DEFECT-5 — Mensajes duplicados (diagnóstico read-only, 2026-07-01)

## Resumen
Durante la validación manual, los mensajes aparecen **duplicados en el hilo** (ej.: "hbola", "como va?", "/todo bien"). **Diagnóstico: duplicación VISUAL/FRONTEND TRANSITORIA (opción D), NO duplicación en DB, NO doble-submit.**

## 1. ¿DB o UI? → SOLO UI (evidencia SQL)
`connect_messages` (conversación `5f699e77-6807-40bd-902f-6f60bfb2b69f`):
| body | id | seq | client_msg_id | filas |
|---|---|---|---|---|
| hbola | 2561a768… | 5 | a6b2a9e8… | **1** |
| como va? | 3c90d175… | 6 | 29ec9e8c… | **1** |
| /todo bien | 32d7cf1b… | 7 | f7092ed6… | **1** |

**1 sola fila por mensaje**, `seq` y `client_msg_id` distintos. **NO hay duplicación en DB** (descarta A). Composer con guard `sending` + botón disabled + `preventDefault` en Enter → **no doble-submit** (descarta C).

## 2. ¿Persiste tras reload? → NO (transitorio)
En carga **fresca** de la conversación, los mensajes aparecen **UNA vez** (screenshot `~/CODE/defect5-fresh-load.png`). La duplicación ocurre **solo en vivo durante el envío**; **desaparece al recargar**. (Los 2 errores de consola en esa página = React #425/#422 = hydration shell, deuda A pre-existente, NO de DEFECT-5.)

## 3. Causa raíz (frontend — `src/app/(app)/connect/_components/ThreadView.tsx`)
El handler realtime **no reconcilia el eco con el mensaje optimista por `client_msg_id`**:
- `send()` (L89-108) agrega un optimista: `id="tmp-<clientMsgId>"`, `seq=MAX_SAFE_INTEGER`, `status="sending"`, `clientMsgId`.
- La RPC inserta → **realtime INSERT** (id real, seq real). El dedup (L79): `m.id === incoming.id || (m.seq === incoming.seq && m.status === undefined)`. El optimista tiene `id=tmp` (≠ real) y `status="sending"` (≠ undefined) → **no matchea** → **agrega el eco como mensaje nuevo**.
- Luego la reconciliación (L113-121) le pone al optimista el `id` real → **2 mensajes con el mismo `id` real** → 2 burbujas (+ key duplicada de React). Al recargar, el fetch inicial trae 1 fila → 1 burbuja.
- El payload realtime **no incluye `client_msg_id`** en el objeto `incoming` (L63-77), y el dedup **no lo usa** → no puede matchear optimista↔eco.

## 4. Severidad + ¿bloquea F3?
**Medio** — VISUAL, **transitorio** (resuelve al recargar; DB limpia, sin pérdida de datos). **Afecta el flujo central de mensajería** durante el chat en vivo (los usuarios del piloto lo ven al conversar). Recomendación: **corregir** (fix chico y de bajo riesgo, solo `ThreadView.tsx`) — Dirección decide si lo considera bloqueante de cierre. NO es corrupción de datos.

## 5. Plan de hotfix (frontend, sin migración)
**Archivo:** `src/app/(app)/connect/_components/ThreadView.tsx` (handler realtime).
- Incluir `clientMsgId: row.client_msg_id` en el `incoming`.
- Dedup/reconciliar por `client_msg_id`:
  ```
  setMessages((prev) => {
    const cmid = (row.client_msg_id as string | null) ?? null;
    if (prev.some((m) => m.id === incoming.id)) return prev;               // ya tenemos el mensaje real
    if (cmid && prev.some((m) => m.clientMsgId === cmid))                  // eco de un optimista propio → reconciliar en su lugar
      return prev.map((m) => (m.clientMsgId === cmid ? { ...m, id: incoming.id, seq: incoming.seq, status: undefined } : m));
    return [...prev, incoming];                                           // mensaje de otro usuario → append
  });
  ```
Ambas reconciliaciones (ACK de `send()` + realtime) convergen a 1 mensaje sin importar el orden (idempotente por `client_msg_id`). **Sin migración; requiere DEPLOY** (frontend). Defensa en profundidad opcional (no requerido): constraint único `(conversation_id, client_msg_id)` en `connect_messages` — verificar si ya existe antes de proponerlo.

## 6. Smoke plan post-hotfix
Enviar con Enter · con botón · doble-Enter rápido · doble-click → **1 sola burbuja por mensaje**, **1 sola fila en DB**; recargar → sigue 1; realtime entre 2 sesiones sin duplicar; 0 500/502; consola sin errores nuevos (los #425/#422 son deuda A aparte).

## 7. Riesgos / Rollback
Riesgo bajo (cambio acotado a `ThreadView`). DEPLOY-1 (mitigado con Node 22 + NO-worktree + draft-first). Rollback = re-publish del deploy previo (`6131248`). Sin datos que revertir.

## 8. Recomendación GO/NO-GO
🟢 **GO** a implementar el fix de `ThreadView` (frontend, sin migración) + deploy controlado, **con autorización explícita**. Esta ventana fue **solo diagnóstico read-only**; **NO implementado, prod intacta `6131248`, F4 bloqueada.**
