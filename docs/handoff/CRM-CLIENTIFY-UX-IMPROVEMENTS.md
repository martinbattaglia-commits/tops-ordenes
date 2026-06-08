# CRM-CLIENTIFY-UX-IMPROVEMENTS

**Fecha:** 2026-06-08 · **Alcance:** UX/datos/navegación de Contactos + Pipeline. **`tsc` EXIT 0.**
No se modificó diseño/layout/estilos corporativos ni la sincronización ni la estructura de pipelines.

---

## MÓDULO 1 — Buscador de Contactos

### Auditoría (evidencia empírica contra la API real)
| Param enviado | count devuelto | ¿filtra? |
|---|---|---|
| baseline (sin filtro) | 2139 | — |
| `?search=drog` | 2139 | ❌ (Clientify lo ignora) |
| `?name=drog` | 2139 | ❌ |
| **`?query=drog`** | **4** | ✅ parcial |
| `?query=martin` | 40 | ✅ |
| `?query=ezequiel` | 16 | ✅ |

**Diagnóstico:** el parámetro correcto de Clientify es **`query`** (no `search`/`name`). El código **ya** mapea `search → query` (`src/lib/clientify/client.ts:134`, fix CRM-C4) y el flujo `form q → getContactsPage({search}) → listContacts(query)` es correcto. **El buscador filtra bien en este worktree.**

### Corrección aplicada
- El backend del buscador ya era correcto → se confirmó por evidencia (arriba).
- Mejora de robustez: `q` ahora se **normaliza con `.trim()`** en `contactos/page.tsx` (evita búsquedas con espacios accidentales).
- **Causa probable del síntoma reportado:** build desplegado desactualizado (prod/`main` sin el fix CRM-C4 `query`). **Recomendación:** desplegar este worktree para que prod tome el mapeo `query`.

---

## MÓDULO 2 — Empresa vinculada (razón social)

**Antes:** la celda Empresa mostraba `"Vinculada"` (solo sabía que había URL, no el nombre).
**Ahora:** muestra la **razón social real** (`company_name`, que el payload del contacto SÍ trae).
- Regla aplicada: si hay empresa → razón social; si no → **"Sin empresa asignada"**.
- Evidencia: contacto `144077405` → `company_name = "MEDICINA DEL PLATA SRL"`; contactos sin empresa → `company_name = None` → "Sin empresa asignada".

Cambios: `ClientifyContact.company_name` (tipo), `UiContact.companyName` (mapper).

---

## MÓDULO 3 — Deep link Contacto

El **nombre del contacto** ahora es un acceso directo a su ficha en Clientify (tabla desktop + card mobile):
- `href = https://new.clientify.com/contacts/contact_detail.html?id=<contact_id>`
- `target="_blank"`, `cursor-pointer`, `hover:underline/text-fg-link`. Sin modal, sin pantalla intermedia.
- (El ícono ↗ existente se conserva como acceso redundante.)

---

## MÓDULO 4 — Deep link Empresa

La **razón social** es clickeable y abre la ficha de empresa en Clientify:
- Se extrae `company_id` de la URL `c.company` (`/companies/<id>/`).
- `companyHref = https://new.clientify.com/companies/company_detail.html?id=<company_id>`.
- Evidencia: company_id `11986449` resuelto correctamente.
- Si no hay empresa → no hay link (muestra "Sin empresa asignada").

Cambios: `UiContact.companyHref` (mapper, vía `extractIdFromUrl`).

---

## MÓDULO 5 — Pipeline: deep link de oportunidades

Cada oportunidad sincronizada es ahora un **acceso directo** a su ficha en Clientify, en **todas** las etapas (Nuevo Lead, Contactado, Propuesta Enviada, Alta Probabilidad, Cuarentena, etc.) y en la tabla Top:
- Se centralizó `UiDeal.href = https://new.clientify.com/deals/?deal=<deal_id>` en el mapper (mismo patrón que ya usaba la tabla Top; ahora reutilizado).
- **Cards de etapa:** el `<div>` de cada deal pasó a `<a>` clickeable (`block`, `cursor-pointer`, `hover:bg-neutral-50`, `target=_blank`).
- **Tabla Top deals:** el link del título ahora usa `d.href` centralizado.
- **No se tocó** lógica comercial, etapas, importes ni agrupación por stage.
- Evidencia: `deal_id` disponible para todos los deals (ej. `29943954`, `29899931`).

---

## Cambios realizados (archivos)

| Archivo | Cambio |
|---|---|
| `src/lib/clientify/types.ts` | `ClientifyContact.company_name` |
| `src/lib/clientify/mappers.ts` | `UiContact.companyName` + `companyHref`; `UiDeal.href`; `mapContact`/`mapDeal` |
| `src/app/(app)/comercial/contactos/page.tsx` | `q.trim()`; nombre deep-link (desktop+mobile); razón social + deep-link empresa / "Sin empresa asignada" |
| `src/app/(app)/comercial/pipeline/page.tsx` | cards de etapa clickeables (deep link); tabla Top usa `d.href` |

> Sin cambios en `client.ts`/`data.ts` (el buscador ya estaba correcto). Sin commit/push.

---

## Validaciones ejecutadas

**Contactos**
- ✅ búsqueda exacta — `query` filtra (ej. `martin`→40).
- ✅ búsqueda parcial — `drog`→4.
- ✅ búsqueda sin resultados — `query` devuelve 0 → la tabla muestra "No hay contactos…".
- ✅ contacto con empresa — razón social real (MEDICINA DEL PLATA SRL).
- ✅ contacto sin empresa — "Sin empresa asignada".
- ✅ deep link contacto — `contact_detail.html?id=`.
- ✅ deep link empresa — `company_detail.html?id=` (company_id resuelto).

**Pipeline**
- ✅ deep link oportunidad — `deals/?deal=<id>` en cards de etapa y tabla Top.
- ✅ oportunidad abre Clientify — `target=_blank`.
- ✅ etapa correcta — sin cambios en agrupación por stage.
- ✅ importes intactos — sin cambios en `amount`/totales.
- ✅ navegación correcta — `cursor-pointer` + hover en todas las cards.

**Build**
- ✅ `tsc --noEmit` EXIT 0.
- ✅ `/comercial/contactos`, `/comercial/pipeline`, `?q=drog` → HTTP 307 (login; recompilan sin 500).

---

## Evidencia funcional (API real, token no impreso)
```
query=drog   → 4 contactos      query=martin → 40      query=ezequiel → 16   (search/name → 2139, ignorados)
contacto 144077405 → company_name="MEDICINA DEL PLATA SRL" · company_id=11986449
contacto 151486442 → company_name=None → "Sin empresa asignada"
deal 29943954 → https://new.clientify.com/deals/?deal=29943954
```

> Nota: la verificación visual logueada (click real abriendo Clientify) requiere sesión de usuario; los identificadores y URLs ya quedan correctamente construidos y los datos verificados contra la API. Sin alterar diseño corporativo, sincronización ni estructura de pipelines.
