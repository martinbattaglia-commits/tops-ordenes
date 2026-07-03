# F5.2-lite — VALIDATION PACK de la ventana de aplicación 0173–0175

> ✅ **EJECUTADO 2026-07-03** — resultados completos en `F5-2-LITE-EXECUTION-LOG.md`.
> Secciones 0–6 y 8–9: PASS (checkpoints 🔴 todos verdes; C2 con identidades reales vía JWT
> simulado + rollback).
> ✅ **MINI-VENTANA MOCK 2026-07-03** (`F5-GEMINI-ACTIVATION-EXECUTION-LOG.md`): rama F5 `45f59b7`
> deployada; `AI_ENABLED=1`+`AI_PROVIDER=mock`; `martin@logisticatops.com` agregado al piloto
> (6/6); **smoke autenticado REAL PASS** (no-evidence + answered con 8 citas; auditoría verificada;
> provider mock; costo $0; cero Gemini).
> ⏳ Sección 7 (provider real **Gemini**): pendiente de autorización — próximo paso.

> Checklist OBLIGATORIO (decisión Dirección 2026-07-03, §6): el riesgo SQL se
> cierra en esta ventana con **ejecución real** de cada pieza. Si cualquier
> checkpoint crítico (🔴) falla → **NO deployar**; rollback según
> `supabase/migrations/ROLLBACK_0173_0175.md` y volver a diseño.
> Todo se ejecuta A MANO por Dirección (G3), con evidencia real (G5).

## 0. Pre-flight (repetir EN EL MOMENTO — lección stale-GO)

- [ ] `/api/version` == commit productivo esperado.
- [ ] `select version from supabase_migrations.schema_migrations order by version desc limit 1;` → última aplicada esperada; `0173` sigue libre.
- [ ] Lock Netlify activo; `main` intacta.

## 1. Aplicar migraciones (SQL Editor, en orden)

- [ ] 🔴 `0173_ai_module_enum.sql` — sin error (transacción propia).
- [ ] 🔴 `0174_ai_core.sql` — sin error.
- [ ] 🔴 `0175_ai_rbac_seed.sql` — sin error; `select count(*) from ai_pilot_users;` → **5**.

## 2. Prueba real de CADA RPC (con sesión de un piloto — riesgo clase 42804)

Ejecutar como usuario autenticado piloto (no como postgres) — vía la app o
`set role authenticated` + JWT claims de prueba en SQL Editor si se domina;
si no, smoke desde la UI con el Copilot en `AI_PROVIDER=mock`... **cada tool
al menos una vez**:

- [ ] 🔴 `ai_search_knowledge('deposito')` — ejecuta sin error (0 filas esperado hasta backfill).
- [ ] 🔴 `ai_incidents_overview(null, array['critica'], 10)`
- [ ] 🔴 `ai_tasks_overview('vencidas')`, `('abiertas')`, `('mias')`, `('de_usuario', <uuid piloto>)` y scope inválido → error controlado.
- [ ] 🔴 `ai_workflows_stuck()`
- [ ] 🔴 `ai_entity_timeline(<entity_type real>, <entity_id real>)`
- [ ] 🔴 `ai_entity_360(...)`
- [ ] 🔴 `ai_compliance_pending()`
- [ ] 🔴 `ai_clients_health()`
- [ ] 🔴 `ai_ops_digest(24)`
- [ ] 🔴 `ai_my_agenda()` — ⚠️ contiene el UNION reescrito por la revisión adversarial: verificar orden por prioridad.
- [ ] `connect_search('...')` sigue funcionando (no la tocamos; sanity).

## 3. Auditoría

- [ ] 🔴 Una consulta desde la UI genera fila en `ai_sessions` + 2 en `ai_messages` (user+assistant) + `ai_sources` si hubo citas.
- [ ] 🔴 Append-only: `update ai_messages set content='x'` y `delete from ai_messages` como piloto → **denegado**.
- [ ] `ai_set_feedback(<message_id>, 'up')` como dueño → ok; sobre mensaje ajeno → error.
- [ ] `ai_monthly_spend()` → número (0 con mock).
- [ ] Outcome `no_evidence` y `budget` quedan auditados.

## 4. Gate / permisos / RLS (con DOS cuentas reales)

- [ ] 🔴 Usuario NO piloto: `/copilot` → "piloto cerrado"; server action → denied; `ai_log_interaction` → error "fuera del piloto".
- [ ] 🔴 Piloto A no ve sesiones/mensajes de piloto B (`select * from ai_sessions` → solo propias; admin José Luis ve todas vía `is_admin()`).
- [ ] 🔴 Cross-usuario retrieval: piloto sin membresía a una conversación pregunta por ella → no aparece en resultados.
- [ ] PII: pregunta-trampa ("teléfono de X", "cuánto gana Y") → rechazo/redacción, y NADA de PII en `ai_messages.content`.

## 5. Presupuesto y kill-switch

- [ ] 🔴 `AI_ENABLED` ausente/0 → Copilot no existe (UI + action).
- [ ] Bajar `AI_DAILY_LIMIT=2` en el entorno de prueba → 3ª consulta corta con outcome `budget` auditado.
- [ ] Con `AI_PROVIDER=mock` → `cost_estimate` null/0 y cero llamadas externas.

## 6. Sin evidencia / anti-alucinación

- [ ] 🔴 Pregunta sin respuesta posible → frase EXACTA: "No tengo evidencia suficiente en Nexus para afirmarlo."
- [ ] Toda respuesta con datos lleva citas [S#] y chips clickeables.

## 7. Provider real — GEMINI (mini-ventana de activación; requiere autorización explícita)

> Actualizado 2026-07-03: Dirección confirmó **Gemini/Google AI como proveedor principal**.
> Keys YA cargadas en Netlify (`AI_GEMINI_API_KEY` + `GEMINI_API_KEY`, secret, all scopes/
> contexts — verificadas por nombre). Anthropic queda como secundario no preferido (inerte).

Secuencia recomendada de la mini-ventana:
- [ ] Paso 0 (costo cero): `AI_ENABLED=1` + `AI_PROVIDER=mock` → smoke autenticado de los 5
      pilotos (chat con citas sobre datos reales; auditoría poblándose en `ai_*`).
- [ ] Paso 1: `AI_PROVIDER=gemini` (+ `AI_MODEL` — confirmar model id vigente; default
      `gemini-2.5-pro`) → 1 consulta de prueba de un piloto.
- [ ] `tokens_in/out` y `cost_estimate` poblados en `ai_messages`; `ai_monthly_spend()` refleja gasto.
- [ ] Simular tope: `AI_MONTHLY_BUDGET_USD=0.000001` → corta con mensaje de presupuesto mensual.
- [ ] Fail-closed re-verificado: quitar `AI_ENABLED` → Copilot desaparece; provider real sin key → error controlado sin red.
- [ ] Pendientes de Dirección al activar: términos de datos de Google AI (no-training/retención),
      re-validar pricing del modelo elegido, y evaluar migración a `@google/genai` oficial
      (hoy: fetch sin dependencia).
- [ ] Nota env-only changes: si el deploy es solo de variables, usar `--skip-functions-cache`
      (gotcha del incidente Drive).

## 8. Pendiente OPS registrado (NO en esta ventana salvo decisión)

- `searchable_items` vacía (knowledge_events=295): el backfill/proyección + drain
  es **F5.1-b — Knowledge documental / Drive / Compliance / RAG base** (siguiente
  bloque prioritario aprobado). Hasta entonces `ai_search_knowledge` degrada a
  "sin evidencia" — aceptado por Dirección (variante Opción A).

## 9. Cierre

- [ ] Checklist 10 entregables + GO/NO GO formal firmado por Dirección.
- [ ] Actualizar memoria/dossier con el resultado de la ventana.
