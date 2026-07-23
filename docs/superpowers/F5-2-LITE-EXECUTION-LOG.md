# F5.2-lite — EXECUTION LOG · Ventana de aplicación 0173–0175 + deploy

> Ejecutado 2026-07-03 (UTC) bajo autorización explícita de Dirección
> ("Autorización ventana 0173–0175 infraestructura Copilot read-only").
> Alcance: infraestructura read-only. Provider real Anthropic INERTE.
> Regla cumplida: main intacta, sin push/merge, deploy manual Netlify.

## Etapa 1 — Pre-flight (2026-07-03 ~05:40Z) — 14/14 PASS

| Check | Resultado |
|---|---|
| `/api/version` | `93e6c9b` ✓ |
| Prod sana | `/login` 200, 0 500/502 ✓ |
| Netlify lock | `published_deploy.locked = true` ✓ |
| Última migración | `0172_connect_automations_mvp` ✓ |
| 0173/0174/0175 libres | ✓ (0176 no existe ni se creó) |
| Worktree F5 | `8aa97a4`, working tree limpio, package files intactos ✓ |
| Secrets | ninguno nuevo; **0 vars `AI_*` en Netlify** → `AI_ENABLED` ausente = fail-closed, `AI_PROVIDER` ausente = mock ✓ |
| main | sin tocar ✓ |

## Etapa 2 — Migraciones aplicadas (Supabase prod `arsksytgdnzukbmfgkju`)

- Inicio: **05:41:38Z** · Fin: **~05:47Z** · Vía Management API (MCP), registradas en `schema_migrations`.

| Migración | Resultado |
|---|---|
| `0173_ai_module_enum` | `{"success": true}` |
| `0174_ai_core` | `{"success": true}` |
| `0175_ai_rbac_seed` | `{"success": true}` |

## Etapa 3 — Checkpoints SQL reales

### C1 — Catálogo ✅
`schema_migrations`: 0173/0174/0175 registradas · enum `ai` presente · permisos `ai.view`/`ai.admin` ·
5 tablas `ai_*` con `relrowsecurity=true` · 5 policies · **13 funciones** ·
`ai_pilot_users` = **5/5**: Cynthia, joseluis, martin.battaglia, martinrinas, ruth (@logisticatops.com).

### C2 — Ejecución real de RPCs ✅ (como `authenticated` con JWT simulado; cero errores SQL)

Lecturas (identidad: joseluis, admin):
`search_knowledge('deposito')=0` (searchable_items vacía — esperado) · `incidents_overview(critica)=0` ·
`tasks_overview abiertas=5 / vencidas=0 / mias=1 / de_usuario=1` · scope inválido → `P0001 scope inválido` (controlado) ·
`workflows_stuck=0` · `entity_timeline=1` · `entity_360=1` (entidad real del spine) ·
`compliance_pending=16` · `clients_health=0` (sin links a clients aún) · `ops_digest(168h)=40` ·
`my_agenda=18` · `ai_monthly_spend()=0` · `ai_pilot_users` visibles como admin=5.

Escritura/auditoría (identidad: martin.battaglia, piloto NO admin; transacción con ROLLBACK — sin datos de prueba):
`ai_log_interaction` → 1 sesión + 2 mensajes + 1 fuente ✓ · `ai_set_feedback('up')` ✓ ·
**append-only real**: `UPDATE`/`DELETE` sobre `ai_messages` → **0 filas afectadas** (sin policy) ✓.

RLS cruzada (identidad: Cynthia, pilota NO admin): ve **0** sesiones/mensajes de Martín ✓ ·
ve su propia fila de `ai_pilot_users` (1) ✓ · su `ai_my_agenda()` ejecuta ✓.
Bonus: identidad NULL (claims vacíos) ve 0 en todo — fail-safe ✓.

No-piloto (identidad: mariela): `ai_log_interaction` → `P0001 usuario fuera del piloto` ✓.

### C3 — Seguridad ✅
`prosecdef` verificado en DB: **10 funciones de lectura INVOKER** (`false`) + **3 DEFINER justificadas**
(`ai_log_interaction`, `ai_set_feedback`, `ai_monthly_spend` — agregado sin contenido).
Sin `service_role` en retrieval (test estructural del módulo + policies). Sin PII/secrets en logs.

### C4 — Fail-closed ✅
Cubierto por: 0 vars `AI_*` en Netlify (kill-switch ausente = OFF) + suite local 594/594
(kill-switch, provider sin key = 0 llamadas red, mock sin red, budgets diario/mensual,
frase exacta de no-evidencia) + smoke prod post-deploy (/copilot → "Copilot desactivado").

### C5 — Knowledge/documentos ✅
`searchable_items` vacía aceptada (búsqueda=0 y degradación a "sin evidencia"). **No** se hizo
backfill; **no** se tocó Knowledge drain ni Drive drain. Documental profundo = F5.1-b.

## Etapa 4 — Deploy DRAFT ✅

- Checkout limpio **NO-worktree**: clone local `~/CODE/tops-ordenes-f5-deploy` @ `8aa97a4`
  (rama `feat/f5-ai-copilot-readonly`), working tree limpio, `npm ci` (lock intacto).
- Build: **Node 22** (`v22.23.1`, Homebrew `node@22`) + heap 4 GB (netlify.toml) vía
  `npx netlify deploy --build --context production` (CLI local pineada `netlify-cli ^26.0.2`,
  corrida desde la RAÍZ del checkout — gotcha del outage 06-30 respetado).
- `env:check` local: FAIL esperado (esta máquina no guarda CLIENTIFY/HIKVISION/OPENAI/MAPBOX);
  **las 6 variables verificadas presentes en el contexto production de Netlify** (solo nombres) —
  la CLI las inyecta en el build. Gate satisfecho por el entorno real de deploy.
- Draft deploy: **`6a474dc3337eb67108b012da`** (05:52Z, build 1m51s).
  URL: `https://6a474dc3337eb67108b012da--tops-ordenes.netlify.app`.
- **Smoke DRAFT PASS**: `/api/version = 8aa97a4` (environment production) · `/login` 200 ·
  `/copilot`, `/connect`, `/connect/tareas`, `/connect/incidentes`, `/connect/notificaciones`,
  `/dashboard`, `/` → 307 a login (middleware sano; `/copilot` NO está en la allowlist pública) ·
  webhook WhatsApp sin firma → **401** · 0 500/502.

## Etapa 5 — Deploy PROD ✅

- Inicio 05:54Z. Primer intento bloqueado por el **lock de deploys** (correcto — es su función).
  Procedimiento de ventana: `unlockDeploy(6a47132a3cfb0dba2ba13b51)` → `netlify deploy --prod
  --context production` → **`lockDeploy` sobre el deploy nuevo** (protección re-activada al salir).
- **Deploy PROD publicado: `6a474ed1afe8a06286068508`** (unique URL
  `https://6a474ed1afe8a06286068508--tops-ordenes.netlify.app`), mismo commit `8aa97a4`
  (el `--prod` re-ejecutó el build del mismo checkout: builtAt 05:55:32Z).
- **Rollback point**: deploy anterior `6a47132a3cfb0dba2ba13b51` (commit `93e6c9b`) — republish
  instantáneo en Netlify si hiciera falta.
- Lock verificado post-deploy: `published_deploy = 6a474ed1…`, `locked = true` ✓.
- **Smoke PROD PASS** (nexus.logisticatops.com): `/api/version = 8aa97a4` · `/login` 200 ·
  rutas protegidas 307 (copilot/connect/tareas/incidentes/notificaciones/dashboard) ·
  webhook WhatsApp sin firma **401** (F4.4 hardening intacto) · 0 500/502 ·
  PostgREST: RPCs `ai_*` y tabla `ai_pilot_users` como **anon → 401** (grants/RLS; **0** respuestas 300).

## Etapa 6 — Cierre ✅

- **Estado del Copilot en prod: FAIL-CLOSED** — 0 variables `AI_*` en Netlify:
  `AI_ENABLED` ausente → el Copilot no existe (UI muestra "desactivado" a pilotos autenticados;
  server action corta con outcome `killed`). `AI_PROVIDER` default `mock`. Sin API key cargada.
  **Cero llamadas reales a IA. Costo real de IA: $0.**
- **Activación Anthropic real = mini-ventana posterior** (Dirección): cargar `AI_ANTHROPIC_API_KEY`
  en Netlify + `AI_PROVIDER=anthropic` + `AI_ENABLED=1` + checklist §7 del Validation Pack
  (DPA/región, prueba de costo/presupuesto, evaluar migración a `@anthropic-ai/sdk`).
- **Knowledge documental** (backfill `searchable_items`, drain, texto de documentos, Drive) =
  **F5.1-b**, siguiente bloque prioritario. Nada de eso se tocó en esta ventana.
- Rollback: **NO requerido**. main: **intacta** (sin push/merge; deploy manual CLI).
- Checkout de deploy conservado en `~/CODE/tops-ordenes-f5-deploy` (reproducibilidad).
- Residual aceptado: smoke funcional AUTENTICADO del Copilot con pilotos reales queda para
  cuando Dirección habilite `AI_ENABLED=1` con `AI_PROVIDER=mock` (datos reales, costo cero) —
  los checkpoints SQL C2 ya probaron el backend con identidades reales.
