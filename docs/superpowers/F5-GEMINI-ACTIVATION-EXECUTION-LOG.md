# F5 — GEMINI ACTIVATION · EXECUTION LOG (mini-ventana)

> Ejecutado 2026-07-03 (UTC) bajo autorización explícita de Dirección
> ("Autorización mini-ventana de activación Gemini"). Alcance: publicar rama F5
> con Gemini y encender el Copilot gradual (mock → gemini) solo para pilotos.
> Reglas cumplidas: main intacta, sin push/merge, deploy manual, lock re-activado.

## Etapa 1 — Pre-flight (≈06:22Z) — 10/10 PASS
- `/api/version` = `8aa97a4` · `/login` 200 · 0 5xx.
- Netlify `published_deploy` = `6a474ed1…`, `locked = true`.
- Rama F5 `45f59b7`, working tree limpio, package files intactos.
- Vars Gemini presentes (contexto production, solo nombres): `AI_GEMINI_API_KEY`, `GEMINI_API_KEY`.
- `ai_pilot_users` = **5/5**: Cynthia, joseluis, martin.battaglia, martinrinas, ruth.
- Migs 0173–0175 presentes en `schema_migrations`.
- F5+Gemini NO estaba en prod (prod era `8aa97a4`, solo mock+anthropic inertes).

## Etapa 2 — Deploy DRAFT (45f59b7) ✅
- Checkout limpio NO-worktree `~/CODE/tops-ordenes-f5-deploy` actualizado a `45f59b7`.
- Build Node 22 (`/opt/homebrew/opt/node@22`, `v22.23.1`) + heap 4 GB via
  `netlify deploy --build --context production`.
- Draft: **`6a47554979637481ced6a031`** · URL `https://6a47554979637481ced6a031--tops-ordenes.netlify.app`.
- **Smoke DRAFT PASS**: `/api/version = 45f59b7` · `/login` 200 · `/copilot`,`/connect`,
  `/connect/tareas`,`/connect/incidentes`,`/dashboard` → 307 (protegido) · webhook 401 · 0 5xx.

## Etapa 3 — Deploy PROD (45f59b7) ✅
- Secuencia de lock: `unlockDeploy(6a474ed1…)` → `netlify deploy --prod --context production`
  → `lockDeploy` del nuevo.
- **Deploy PROD: `6a4755cccde7a2841876ffdb`** (unique URL
  `https://6a4755cccde7a2841876ffdb--tops-ordenes.netlify.app`), commit `45f59b7` (builtAt 06:25Z).
- **Rollback point registrado: `8aa97a4` / deploy `6a474ed1afe8a06286068508`** (republish instantáneo).
- Lock verificado: `published = 6a4755cccde7…`, `locked = true`.
- **Smoke PROD PASS**: version `45f59b7` · login 200 · rutas 307 · webhook 401 · 0 5xx.
  (En este punto el Copilot seguía **fail-closed**: `AI_ENABLED` aún ausente.)

## Etapa 4 — Activación MOCK ✅ (infra) · ⏳ (validación autenticada = piloto)
- Env seteadas en Netlify (contexto production): **`AI_ENABLED=1`** (⚠️ el kill-switch del
  código chequea `=== "1"`, NO la cadena `"true"` — se usó `1` para cumplir la intención de
  Dirección de encender el Copilot) y **`AI_PROVIDER=mock`**. Confirmadas por nombre + presencia.
- Env-only redeploy con **`--skip-functions-cache`** (gotcha del proyecto): unlock →
  `netlify deploy --prod --skip-functions-cache` → lock.
- **Deploy MOCK-ON en prod: `6a4756db5ddf138b8a855179`** (commit `45f59b7`, builtAt 06:29Z),
  `published` + `locked=true` verificado.
- **Smoke infra PASS**: version `45f59b7`, `/copilot` 307 (protegido), login 200, webhook 401, 0 5xx.
- **✅ Validación funcional AUTENTICADA PARCIAL (evidencia en vivo, no fixture):** el navegador
  del usuario tenía una sesión de Nexus activa como **`martin@logisticatops.com`** (rol admin).
  Al abrir `/copilot` la app respondió **"Copilot en piloto cerrado"** (no "desactivado"). Esto
  prueba, contra prod real:
  - **`AI_ENABLED=1` tomó efecto** — si el kill-switch estuviera OFF el mensaje sería
    "El Copilot está desactivado (AI_ENABLED)"; se obtuvo el mensaje de gate, no el de kill-switch.
  - **El gate `ai_pilot_users` funciona en vivo** — sesión válida + rol admin, pero NO en la
    lista de pilotos → **denegado** ("El Copilot está en piloto cerrado. Pedile acceso a
    Dirección si lo necesitás."). Confirma que estar autenticado/ser admin NO alcanza; el gate
    es la allowlist explícita. (Complementa C2/C3 de la ventana anterior: gate, RLS, append-only.)
- **⚠️ HALLAZGO — discrepancia de cuentas "Martín":** la sesión activa del navegador es
  `martin@logisticatops.com` (admin), que **NO** es la cuenta piloto seedeada
  (`martin.battaglia@logisticatops.com`). Son dos cuentas distintas. **Decisión de Dirección**
  requerida: ¿el "Martín" piloto es `martin.battaglia@` (ya seedeado) y `martin@` no debe tener
  acceso, o hay que agregar `martin@` a `ai_pilot_users`? El asistente NO tocó el seed.
## Etapa 4b — `martin@` agregado al piloto + VALIDACIÓN MOCK COMPLETA ✅ (2026-07-03 ~06:42Z)

Decisión de Dirección: agregar `martin@logisticatops.com` (cuenta diaria, admin) al piloto,
manteniendo `martin.battaglia@`.

- **Pre-flight:** `martin@logisticatops.com` existe en `profiles` (id `1f39803f-…`, role admin) y
  `auth.users` (confirmado); NO estaba en `ai_pilot_users`; los 5 previos intactos.
- **Insert idempotente** en `ai_pilot_users` (única tabla autorizada; `on conflict do nothing`;
  ni roles ni RBAC ni otras tablas tocadas). **Pilotos: 5 → 6.** Lista: Cynthia, joseluis,
  martin.battaglia, **martin**, martinrinas, ruth. (El gate lee la tabla en runtime → sin redeploy.)
- **Smoke autenticado REAL** (sesión existente del navegador como `martin@`, sin ingresar
  credenciales): `/copilot` **ya NO** dice "piloto cerrado" → carga el chat.
  - Consulta 1 "¿Qué incidentes críticos están abiertos?" → **"No tengo evidencia suficiente en
    Nexus para afirmarlo."** (correcto: `ai_incidents_overview(critica)` devolvió 0 reales; el
    MockProvider planificó el tool y la **RPC real** corrió con la RLS del usuario) + disclaimer.
  - Consulta 2 "¿Qué documentos de compliance están pendientes?" → **respuesta con 8 fuentes
    reales** (docs compliance) + citas **[S1]…[S8]** + chips + feedback 👍/👎 + disclaimer.
- **Auditoría verificada en DB:** 1 sesión, 4 mensajes (seq2 `no_evidence`/`incidents_overview`;
  seq4 `answered`/`compliance_pending`), ambos `provider=mock`/`model=mock-deterministic-v1`,
  **8 filas en `ai_sources`**, `cost_estimate=null`, `ai_monthly_spend()=0`.
- **Confirmado:** provider `mock` · costo IA **$0** · **cero llamadas a Gemini** · 0 500/502 ·
  gate de piloto funcionando (denegado antes de agregar, permitido después).

**Etapa 4 (activación mock) = CERRADA con evidencia real.** El pipeline read-only (gate → tools
read-only RLS → citas validadas / frase de no-evidencia → auditoría append-only) funciona
end-to-end en producción.

Observación de datos (no bloqueante): la consulta de compliance devolvió 8 filas del mismo
documento ("VTO MAYO 2023.pdf", categoría "Incendio", campo estado vacío) — refleja los datos de
`compliance_documents`, no un defecto del Copilot; se anota para higiene de datos.

## Etapa 5b — MICRO-ACTIVACIÓN GEMINI REAL + HALLAZGO + ROLLBACK (2026-07-03 ~06:50–06:57Z)

Autorizada por Dirección ("micro-activación Gemini para una consulta controlada").

### Activación
- Pre-flight 10/10 PASS (prod `45f59b7`, locked, `AI_ENABLED=1`, `AI_PROVIDER=mock`, keys Gemini
  presentes, `ai_monthly_spend()=0`, `martin@` piloto 6/6).
- `AI_PROVIDER=gemini` (mantenido `AI_ENABLED=1`; `AI_MODEL` sin setear → default `gemini-2.5-pro`).
- Env-redeploy `--skip-functions-cache` (unlock→deploy→lock). Deploy Gemili: `6a475bc7aace219b03bb5033`.
- Smoke básico PASS: version `45f59b7`, `/copilot` 307, webhook 401, 0 5xx.

### Consulta real controlada (sesión piloto `martin@`)
Pregunta: "¿Qué documentos de compliance están pendientes?". **Gemini respondió** con síntesis de
alta calidad (distinguió caso activo MAGALDI "CAA Nación R. Peligrosos" de documentos vencidos —
Certificado Ambiental Anual, incendio 2023 — y sugirió NAVEGAR al módulo, sin acción de escritura).

**Auditoría real (evidencia en DB):** `provider=gemini` · `model=gemini-2.5-pro` ·
`outcome=answered` · **tokens_in=7577 / tokens_out=234** · **cost_estimate=$0.011811** ·
latency 19.9s · tools=[compliance_pending×2] · error=null · `ai_monthly_spend()=0.011811`.

### 🔴 HALLAZGO (para esto sirve una consulta controlada): parser de citas incompatible con Gemini
- **`ai_sources = 0`** pese a que la respuesta citaba fuentes. Causa raíz: Gemini agrupa citas
  (`[S16, S32]`, `[S1-S12, S14, S17-S28, S30]`); el validador usaba `CITATION_RE = /\[S(\d+)\]/g`,
  que solo reconoce `[S16]` simple → 0 citas parseadas → `ai_sources` vacío y la respuesta pasó
  como `answered` **sin fuentes registradas**.
- **No inseguro** (la respuesta estaba grounded en datos reales, read-only, auditada con costo/
  tokens), pero **debilita la garantía anti-alucinación** con Gemini (una cita inventada agrupada
  no se detectaría) y cae en la condición de rollback de Dirección ("respuesta sin fuentes cuando
  debería haber fuentes"). El mock (citas `[S1]` simples) no lo exponía; Gemini con su formato
  natural sí. **Exactamente el defecto que una consulta controlada debe descubrir antes del piloto.**

### Rollback ✅ (nivel 1: `AI_PROVIDER=mock`)
- `AI_PROVIDER=mock` + env-redeploy `--skip-functions-cache`. Deploy mock: `6a475cd78292bf4c48f6633b`.
- ⚠️ Gotcha operativo cometido y corregido: al re-lockear tras el deploy se lockeó por error el
  deploy Gemili anterior (`6a475bc7`), lo que lo dejó publicado; se corrigió con
  `restoreSiteDeploy(6a475cd7)` + `lockDeploy(6a475cd7)`. **Lección: verificar el deploy id del
  redeploy en el output antes de lockear (no confiar en un grep del primer `6a…`).**
- **Rollback funcional confirmado en vivo:** la misma consulta volvió a la respuesta MOCK (viñetas
  `[S1]..[S8]` + chips, instantánea). Prod: published `6a475cd78292bf4c48f6633b`, `locked=true`,
  `AI_PROVIDER=mock`, version `45f59b7`, 0 5xx.

### Fix entregado LOCAL (NO deployado — rama F5, sin push)
- `guardrails.ts`: nuevo `extractCitedIds()` que parsea citas simples, grupos con comas y rangos
  (`S1-S12`), con tope anti-basura (rango ≤200). `validateCitations` y `requiresCitation` lo usan.
- `engine.ts`: guard anti-alucinación reforzado — una respuesta con evidencia recuperada pero
  **sin ninguna cita válida** (`chunks>0 && used=0`) reintenta una vez y, si persiste, degrada a
  la frase exacta de no-evidencia (antes pasaba como `answered` sin fuentes).
- `prompts/system.v1.ts`: instrucción explícita de citar con corchetes individuales (`[S3] [S7]`),
  nunca agrupar ni rangos (defensa en profundidad, no la defensa principal).
- Tests: `extractCitedIds` con los formatos reales de Gemili (grupos/rangos/mezcla) + validación.
  Gates: typecheck 0, lint 0, tests **612/612**, build verde.
- **Requiere re-validación Gemini en una próxima micro-ventana** (deploy del fix + repetir la
  consulta controlada → confirmar `ai_sources > 0` con provider gemini).

## Etapa 5 (histórica) — por qué no se activó en la ventana anterior
- **Decisión: NO se activó `AI_PROVIDER=gemini`.** Motivo (contrato de trabajo: evidencia antes
  de cerrar): la "única consulta controlada" que Dirección pide como verificación **requiere una
  sesión de piloto autenticado** (no hay endpoint público; el engine corre bajo la sesión del
  usuario). Sin poder ejecutar y observar esa consulta, activar gemini dejaría prod sirviendo
  Gemini-live **sin una sola respuesta verificada** — peor que el mock verificado. Riesgo de
  activar a ciegas: bajo (5 pilotos, read-only, budget-capped, error→"no disponible",
  reversible con 1 env var), pero **no verificable por el asistente**, así que se frena.
- **Estado: GEMINI LISTO A 1 ENV VAR.** Provider implementado y deployado (en `45f59b7`); keys
  cargadas; catálogo de function calling sanitizado; pricing/budget/auditoría cableados.
  Falta solo: `AI_PROVIDER=gemini` (+ redeploy `--skip-functions-cache`) y **una consulta de un
  piloto**.

## Nota — por qué la validación autenticada la hace un piloto
El asistente no posee credenciales de piloto y no debe ingresarlas (regla de seguridad). El
navegador MCP no tiene sesión de Nexus. Todo smoke funcional autenticado de F4.1–F4.4 se hizo
"PASS por Dirección" — este sigue el mismo patrón. NO es un fallo del deploy: es una frontera de
identidad. El asistente SÍ puede, **después** de que un piloto ejecute una consulta, verificar el
resultado leyendo `ai_messages` (tokens/costo/outcome) — read-only.

## Handoff — smoke autenticado del piloto (pasos exactos)
### A) Validar MOCK (costo cero) — estado actual de prod
1. Piloto (p.ej. Martín) entra a `https://nexus.logisticatops.com/copilot`.
2. Pregunta "¿Qué incidentes críticos están abiertos?" → debe responder con viñetas + chips `[S#]`
   (fixtures mock) + disclaimer; feedback 👍/👎 visible.
3. Un usuario NO piloto entra a `/copilot` → "Copilot en piloto cerrado".
4. Avisar al asistente para verificar en DB: `select outcome,provider,tools_used from ai_messages
   order by created_at desc limit 4;` (debe haber filas `provider=mock`).

### B) Activar GEMINI (tras A OK) — mini-paso de env
1. `AI_PROVIDER=gemini` en Netlify (production) + redeploy `--skip-functions-cache` + re-lock.
   (Opcional `AI_MODEL` — confirmar el model id vigente; default `gemini-2.5-pro`.)
2. Un piloto ejecuta **una** consulta ("¿Qué incidentes críticos están abiertos?").
3. Asistente verifica en DB: `provider=gemini`, `tokens_in/out` y `cost_estimate` poblados,
   `outcome` ∈ answered|no_evidence, y `ai_monthly_spend()` refleja el gasto.
4. Rollback si algo raro: `AI_PROVIDER=mock` (nivel 1) o `AI_ENABLED` fuera (nivel 0).

## Rollback disponible
- Nivel 0: `AI_ENABLED` ausente/≠1 → Copilot desaparece.
- Nivel 1: `AI_PROVIDER=mock` → sin red externa, costo cero.
- Nivel 2: republish deploy previo `8aa97a4` (`6a474ed1afe8a06286068508`) — instantáneo.
- **Rollback NO requerido en esta ventana** (mock sano; gemini no activado).

## Estado final de prod al cierre de la ventana
- Deploy publicado: **`6a4756db5ddf138b8a855179`** (commit `45f59b7`), `locked=true`.
- `AI_ENABLED=1`, `AI_PROVIDER=mock` → **Copilot activo en MOCK para pilotos** (costo IA $0,
  cero llamadas externas). Gemini **OFF**. F4.1–F4.4 sanas. main intacta.
