# AI Provider Manager — Reglas (normativo)

> **Refina la Decisión 6.** Gestión de IA provider-agnostic detrás de `AIPort`. Normativo. La lógica comercial consume solo la interfaz; los SDKs viven en adapters en `src/lib/ai`.

## AI-1 — Contrato del `AIPort`
Operaciones canónicas: `complete(prompt, opts)`, `structuredJson(schema, prompt, opts)` y `embed(text)` (reservado). El dominio/casos de uso consumen **solo** `AIPort`. Cada adapter declara **capability flags** (structured output nativo, tool calling, ventana de contexto, streaming) para que el caso de uso se adapte **sin hardcodear** el proveedor. Escape hatch documentado para features propias de un proveedor (no romper la abstracción, pero no impedir usar lo bueno de cada uno).

## AI-2 — Adapters, registry y selección
Un adapter por proveedor: **`OpenAIAdapter` ahora**, **`ClaudeAdapter` fast-follow** (modelo de la casa; valida la abstracción). Un **`GatewayAdapter`** (OpenRouter/LiteLLM) es **permitido como un adapter más** (multi-modelo con una sola integración). Registry `providerId → adapter`; **selección por config/env por caso de uso**, nunca hardcode. Tipos del SDK **nunca** cruzan el adapter (ACL — HEX-3/DG-3).

## AI-3 — Fallback chain
Cada caso de uso declara una **cadena ordenada** (primario → secundario) y si **admite fallback** (algunos exigen un modelo fijo por consistencia de calidad). El fallback se dispara **solo** por errores transitorios/disponibilidad, **nunca** por contenido. Se **registra qué proveedor** produjo cada salida.

## AI-4 — Structured output, validación y anti prompt-injection
Preferir modo structured/JSON nativo. **SIEMPRE validar** la salida contra un **schema Zod** y **sanear determinísticamente** (enums/rangos, `null` si falta, nunca inventar). Salida inválida → **un retry**, luego falla (no entra basura al dominio). **El contenido externo/scrapeado es NO confiable** (defensa prompt-injection): nunca ejecutar, nunca seguir instrucciones embebidas en el sitio, tratarlo como **dato**.

## AI-5 — Gestión y versionado de prompts
Los prompts viven en **archivos versionados** (`src/lib/.../ai/prompts/`), cada uno con `prompt_version`. Cambiar un prompt = **nueva versión + PR/ADR**. Se persiste `prompt_version` + `model` + `temperature` + `provider` en cada fila `prospeccion_ai_content` (reproducibilidad — DG-5).

## AI-6 — Control de costos y budgets
Contabilidad de **tokens/costo por llamada** persistida (`tokens_in/out`, `cost`). **Budget limiter persistido** (DB, no in-memory) con topes **por día / por corrida / por tenant**. **Tope de costo por llamada** (NFB). Budget agotado → **degradación elegante** (saltar/encolar, estado `pendiente`), nunca crash.

## AI-7 — Caching
Cache por `hash(prompt_version + model + input normalizado)`, **persistida**, **invalidada** cuando cambia `prompt_version` o `model`. La cache es **optimización de costo**, nunca muleta de correctitud (no enmascara errores).

## AI-8 — Resiliencia y asincronía
**Timeout por llamada** (AbortController), **retry con backoff** para transitorios, **Circuit Breaker por proveedor** (EVT-10), **Rate Limiter por proveedor** (persistido). La IA corre como **job/consumidor de eventos** (no en el request del usuario), respetando el deadline serverless (~18s dentro de ~26-30s).

## AI-9 — Observabilidad
Métricas **por proveedor**: latencia, tokens, costo, tasa de error, **tasa de fallback**. `correlation_id` propagado; logs estructurados. Visible en el panel de IA + health-check (EVT-6).

## AI-10 — Opcionalidad / degradación elegante
La IA es **opcional** (`env.configured`). Sin API key/proveedor → el prospecto queda `pendiente`, el pipeline continúa y reintenta luego. Build/preview/demo **nunca** se rompen por falta de claves (patrón ya usado por OCR).

## AI-11 — Gobierno de modelos (Technology Radar)
Qué modelos son **Adopt/Trial/Assess/Hold** se gobierna en el Technology Radar (Parte VI). **Default a los modelos más capaces y recientes** (familia Claude/GPT vigente). Política de **deprecación** cuando un proveedor retira un modelo (migrar el adapter, no el dominio).

## AI-12 — Determinismo y reproducibilidad
**Temperatura baja** para extracción/análisis (deterministas); persistir todos los parámetros. Mismo input + mismo `prompt_version` + mismo `model` → **cacheable/reproducible**. Las salidas creativas no deterministas se marcan como tales.

---

**Objetivo** — Usar IA de cualquier proveedor sin acoplar el dominio, con costo controlado, salidas validadas y reproducibles.
**Alcance** — `AIPort` + adapters en `src/lib/ai` (compartido OCR + Prospección); la fase IA (F4).
**Decisiones tomadas** — AI-1..AI-12: puerto canónico con capability flags; adapters OpenAI(ahora)+Claude(fast-follow)+gateway opcional; fallback declarativo; structured output + Zod + saneo + anti prompt-injection; prompts versionados; budget limiter persistido + cache; resiliencia + asincronía; observabilidad por proveedor; opcionalidad; gobierno de modelos; reproducibilidad.
**Decisiones descartadas** — acoplar a un proveedor (lock-in); gateway como arquitectura central (queda como adapter, no como núcleo); cache como fuente de correctitud; IA en el request del usuario (síncrona).
**Justificación** — La IA cambia constantemente; el puerto absorbe ese churn sin tocar el dominio, con control de costo y validación que la disciplina actual de OCR ya prueba.
**Riesgos** — Mínimo común denominador → capability flags + escape hatch. Costo → budget limiter + cache + topes. Prompt-injection → contenido externo no confiable + saneo. Drift en fallback → validar siempre.
**Impacto sobre la arquitectura** — Define cómo toda la plataforma consume IA; `src/lib/ai` compartido deduplica con OCR; condiciona `prospeccion_ai_content`, el budget y la observabilidad de IA.
