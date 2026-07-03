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
- **⏳ Falta para cerrar Etapa 4:** ver la **respuesta mock de un PILOTO** (respuesta con citas +
  fila de auditoría). Requiere sesión de una de las 5 cuentas piloto — la sesión disponible en el
  navegador (`martin@`) no es piloto, así que este paso queda para un login piloto (ver Handoff).

## Etapa 5 — Activación GEMINI ⏸️ NO EJECUTADA (por diseño de seguridad)
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
