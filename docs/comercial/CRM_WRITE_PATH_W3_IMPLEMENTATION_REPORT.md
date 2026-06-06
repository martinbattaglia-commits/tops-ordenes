# CRM_WRITE_PATH_W3_IMPLEMENTATION_REPORT — W-3 · Wiring de la Ficha 360°

**Proyecto:** TOPS Nexus — Logística TOPS (Verotin S.A.)
**Rama:** `feature/crm-comercial-f2-1`
**Fecha:** 2026-06-06
**Frente:** Write-Path (F2.1-8) · **Paso W-3** — cablear la Ficha 360° a las server actions (W-2)
**Estado:** ✅ **implementado · tsc/lint/build verdes** — Ficha operable contra la fuente Supabase

> Solo UI (un archivo). **No** se modificó la base, `0047`, RLS/RBAC ni el motor. Misma UX, mismo flujo, mismas 7 tabs. Producción, `main`, Netlify, Clientify: intactos.

---

## 1. Entregable

`src/app/(app)/comercial/oportunidades/[id]/Opportunity360View.tsx` — cableado a las server actions `advanceStage`, `reserveCapacity`, `completeOnboarding` (de `stage-actions.ts`, W-2).

### 1.1 Mapa de requisitos → implementación

| Requisito W-3 | Dónde |
|---|---|
| **useTransition** | `const [isPending, startTransition] = useTransition()` + helper `run()` |
| **Estados pending** | Botones muestran "Procesando…/Reservando…" y `disabled` mientras `isPending` |
| **Manejo de errores** | `run()` captura `ActionResult`; banner `role="status"` verde (ok) / rojo (err) con el mensaje humanizado de la action |
| **lost_reason** | Botón "Perder" → input inline de motivo → `advanceStage(id,'perdido', motivo)` |
| **Selector de `assigned_site`** | `<select>` con las 2 sedes en el tab Capacidad |
| **Selector de `assigned_units`** | Tag-input (agregar/Enter, quitar con ✕) + sugerencias por sede + alta libre |
| **Acciones de etapa** | CTA primaria por etapa → `advanceStage` (transición) o navega a la tab donde se opera |

### 1.2 CTA primaria por etapa (`primaryCta`)
Mantiene las etiquetas y el flujo previos; ahora **ejecuta** en vez de solo cambiar de tab:

| Etapa | CTA | Acción |
|---|---|---|
| `nuevo_lead` | "Marcar contactado" | `advanceStage(→contactado)` |
| `contactado` | "Calificar" | `advanceStage(→calificado)` |
| `calificado` | "Validar capacidad y reservar" | navega a tab **Capacidad** (donde se reserva) |
| `visita` | "Cotizar" | navega a tab **Cotizaciones** |
| `propuesta` | "Pasar a negociación" | `advanceStage(→negociacion)` |
| `negociacion` | "Marcar ganado" | `advanceStage(→ganado)` *(bloqueo duro D-2 si no hay sitio → error legible)* |
| `ganado` | "Gestionar onboarding" | navega a tab **Onboarding** (botón completar) |

"Perder" disponible en toda etapa activa (no en `ganado`/`perdido`).

### 1.3 Tab Capacidad — reserva
Selector de sede + unidades (chips, sugerencias por sede claramente editables) → `reserveCapacity(id, { site, units })`. La action calcula `p_available_m2` con el motor y la RPC valida atómicamente (W-1/W-2). Precarga `assignedSite`/`assignedUnits` actuales si ya hay reserva.

### 1.4 Tab Onboarding — cierre
Cuando la oportunidad está en `ganado`, botón "Completar onboarding (→ ocupado)" → `completeOnboarding(id)`. Se deshabilita si ya está `completado`.

### 1.5 Dashboard automático
`run()` hace `router.refresh()` al confirmar; las actions ya emiten `revalidatePath` de ficha/lista/dashboard/pipeline → la vacancia comercial/proyectada se actualiza sin recarga manual.

---

## 2. Gate de escritura (`writable`) — decisión honesta

Las acciones se habilitan solo cuando `source === "supabase"` (la oportunidad existe en la base). En la **muestra local** (fallback cuando la app no encuentra `crm_*`) los controles se muestran **deshabilitados** con la nota *"las acciones operan sobre datos reales (Supabase)"*. Esto evita errores confusos (`OPP_NOT_FOUND`) sobre IDs de demo y es coherente con **RA-1** (el runtime actual apunta a PROD, que aún no tiene `crm_*`).

---

## 3. No-regresión de UX

- **Mismas 7 tabs**, mismo orden, mismos contadores. No se agregó ni quitó ninguna.
- CTA, stepper, KPIs, badges de etapa/compromiso, PDF/print, Capture Bridge (cotizaciones/propuestas): **sin cambios** salvo el cableado.
- Sin dependencias nuevas. `updateOpportunityFields` (W-2) queda disponible para un futuro editor de campos (no pedido en W-3).

---

## 4. QA (detalle en `CRM_WRITE_PATH_W3_QA_RESULTS.md`)

| Check | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npx next lint` (Ficha) | ✅ sin warnings |
| `npm run build` | ✅ Compiled successfully · `/comercial/oportunidades/[id]` 9.35 kB (bundlea las server actions) |
| Iconos usados (`plus/check/x/check-circle/arrow-right/file-pdf`) | ✅ existen en `Icon` |
| Sin referencias a la API vieja (`nextAction`/`next.tab`) | ✅ 0 |

**Limitación de verificación interactiva:** la ruta `/comercial/*` está protegida por auth (redirige a `/login`) y el runtime local apunta a PROD (sin `crm_*`). No se ejecutó un click-through end-to-end en el navegador sin credenciales (no se usan credenciales reales por seguridad). La operabilidad real se da con sesión autenticada contra un Supabase con `crm_*` (staging) — el contrato action↔RPC ya está probado (W-2, 9/9) y las RPC en W-1 (29/29).

---

## 5. Frontera del paso

- ❌ Editor de campos de oportunidad en la UI (usaría `updateOpportunityFields`) — fuera de W-3.
- ❌ Catálogo "oficial" de unidades por sede (RA-4 / D-5) — se usan sugerencias editables.
- ❌ Clientify, webhook, producción, `main`, Netlify: intactos.

> **W-3 cerrado.** La Ficha 360° queda **operable** (cableada a las RPC transaccionales) sobre la fuente Supabase. No avanzar más sin aprobación.
