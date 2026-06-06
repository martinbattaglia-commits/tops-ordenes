# CRM_WRITE_PATH_W3_QA_RESULTS — W-3 · Evidencia de QA

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Fecha:** 2026-06-06
**Artefacto:** `src/app/(app)/comercial/oportunidades/[id]/Opportunity360View.tsx`

## Resultado

> ## ✅ GO (compilación/lint/build)
> tsc ✅ · lint ✅ · build ✅ (la Ficha bundlea las server actions). Verificación interactiva en navegador limitada por auth gate (ver §4) — documentada.

---

## 1. Compilación, lint y build

| Check | Comando | Resultado |
|---|---|---|
| Tipos | `npx tsc --noEmit` | ✅ exit 0 |
| Lint | `npx next lint --file …/Opportunity360View.tsx` | ✅ `No ESLint warnings or errors` |
| Build | `npm run build` | ✅ `✓ Compiled successfully` |
| Ruta Ficha | (build output) | `ƒ /comercial/oportunidades/[id]  9.35 kB · 112 kB First Load` |

> Los warnings de `alt-text` del build pertenecen a otros archivos (login/branding), preexistentes — no a este cambio.

---

## 2. Verificación estructural del wiring

| Check | Evidencia |
|---|---|
| `useTransition` importado y usado | `const [isPending, startTransition] = useTransition()` |
| `router.refresh()` tras éxito | en el helper `run()` |
| `advanceStage` cableado (CTA + Perder) | 2 call-sites |
| `reserveCapacity` cableado (tab Capacidad) | 1 call-site |
| `completeOnboarding` cableado (tab Onboarding) | 1 call-site |
| Sin API vieja (`nextAction`, `next.tab`) | 0 referencias |
| Iconos usados existen en `Icon` | `plus, check, x, check-circle, arrow-right, file-pdf` ✅ |

---

## 3. Comportamiento esperado por etapa (matriz de la UI)

| Etapa | CTA primaria | Resultado al confirmar |
|---|---|---|
| nuevo_lead | Marcar contactado | `estado=contactado` + ledger + refresh |
| contactado | Calificar | `estado=calificado` |
| calificado | Validar capacidad y reservar | abre tab Capacidad → reserva → `reservado` + `assigned_site` |
| visita | Cotizar | abre tab Cotizaciones |
| propuesta | Pasar a negociación | `estado=negociacion` (committed `reservado` si hay sitio) |
| negociacion | Marcar ganado | `estado=ganado` + `comprometido` · **o** error "No se puede ganar sin capacidad reservada" (D-2) |
| ganado | Gestionar onboarding | abre tab Onboarding → Completar → `ocupado` |
| (cualquiera activa) | Perder | input motivo → `perdido` + `lost_reason` + libera committed |

Estados de UI: `isPending` → etiqueta "Procesando…/Reservando…" + `disabled`; banner verde (ok) / rojo (err) con el mensaje de la action.

> La lógica de cada transición (atomicidad, D-2, derivación de `committed_state`, anti-doble-conteo) ya está validada en staging: **W-1 29/29** + **W-2 9/9**. W-3 conecta esa lógica a los controles.

---

## 4. Limitación de verificación interactiva (honesta)

Se levantó el dev server (`npm run dev`, puerto 3030) y se intentó navegar a `/comercial/oportunidades/opp-0001`:

- La ruta **redirige a `/login`** (las rutas `/(app)/comercial/*` están protegidas por auth). Título resultante: *"Iniciar sesión · TOPS NEXUS"*.
- El runtime local apunta a **Supabase PROD** (sin tablas `crm_*`), por lo que aun autenticado, la Ficha caería a la **muestra local** y los controles aparecerían **deshabilitados** (gate `writable`, por diseño).
- **No se usaron credenciales reales** para forzar el login (criterio de seguridad).

Por eso la evidencia de W-3 es **compilación + lint + build + verificación estructural del wiring**, más el contrato action↔RPC ya probado en staging (W-2). La verificación click-through end-to-end corresponde a un entorno con sesión autenticada y Supabase con `crm_*` (staging) — fuera del runtime local actual (RA-1).

---

## 5. Estado de producción

- **PROD / `main` / Netlify / Clientify:** intactos.
- **Sin cambios de esquema ni de base en W-3** (solo UI).

> **W-3 GO** (build verde). La Ficha 360° queda operable contra la fuente Supabase.
