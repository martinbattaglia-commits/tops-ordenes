# CRM-PIPELINE-DEEPLINK-FIX (Contactos + Empresas + Oportunidades)

**Fecha:** 2026-06-08 · **`tsc` EXIT 0.** Patrones **verificados por Presidencia** (no asumidos).
Sin tocar diseño/layout/estilos/pipelines/sincronización. Solo deep links (UX/navegación).

---

## Patrones confirmados (reemplazan los legacy)

| Entidad | URL ANTERIOR (legacy, eliminada) | URL CORRECTA (implementada) | ID usado |
|---|---|---|---|
| Contacto | `…/contacts/contact_detail.html?id={id}` | `https://new.clientify.com/contacts/details/{contact_id}` | `contact_id` (`c.id`) |
| Empresa | `…/companies/company_detail.html?id={id}` | `https://new.clientify.com/contacts/companies/details/{company_id}` | `company_id` (extraído de la URL `company`) |
| Oportunidad | `…/deals/?deal={id}` | `https://new.clientify.com/sales/deals/details/{deal_id}` | `deal_id` (`d.id`) |

Ejemplos validados (Presidencia):
- contacto `…/contacts/details/162770027`
- empresa `…/contacts/companies/details/11986449`
- deal `…/sales/deals/details/29712563`

---

## Auditoría / archivos modificados

Todos los deep links están **centralizados en el mapper** (`src/lib/clientify/mappers.ts`) → un solo punto de cambio; las pages ya consumen `c.href`, `c.companyHref`, `d.href`.

| Símbolo | Antes | Ahora |
|---|---|---|
| `UiContact.href` (`mapContact`) | `contacts/contact_detail.html?id=${c.id}` | **`contacts/details/${c.id}`** |
| `UiContact.companyHref` (`mapContact`) | `companies/company_detail.html?id=${companyId}` | **`contacts/companies/details/${companyId}`** |
| `UiDeal.href` (`mapDeal`) | `deals/?deal=${d.id}` | **`sales/deals/details/${d.id}`** |

`companyId` se extrae de la URL real `c.company` (`/companies/<id>/`) vía `extractIdFromUrl`.

**Consumidores (sin cambios de URL, ya usan el mapper):**
- `comercial/contactos/page.tsx`: nombre → `c.href`; razón social → `c.companyHref`.
- `comercial/pipeline/page.tsx`: cards de etapa (todas) → `d.href`; tabla Top deals → `d.href`.

---

## Validaciones

- ✅ **Sin URLs legacy en todo `src`** — `grep -rE "contact_detail.html|company_detail.html|deals/?deal="` → **0 coincidencias**.
- ✅ **IDs correctos** — el mapper usa `c.id` / `companyId` / `d.id` reales de Clientify. Cross-check con el ejemplo validado: contacto `144077405` tiene `company = …/companies/11986449/` → `companyHref = …/contacts/companies/details/11986449` (coincide exacto con el ejemplo de Presidencia).
- ✅ **Apertura en nueva pestaña** — todos los `<a>` (contactos desktop+mobile, cards de etapa, tabla Top) llevan `target="_blank" rel="noopener"`.
- ✅ `tsc --noEmit` EXIT 0.
- ✅ `/comercial/contactos` y `/comercial/pipeline` → HTTP 307 (login; recompilan sin 500).

---

## Resultado esperado (cumplido por construcción del id)

```
Contacto  Ezequiel Martínez  → https://new.clientify.com/contacts/details/<su contact_id>
Empresa   MEDICINA DEL PLATA SRL → https://new.clientify.com/contacts/companies/details/11986449
Deal      Valentina Mainardi → https://new.clientify.com/sales/deals/details/<su deal_id>
```

Cada registro abre **exactamente su ficha** (el id proviene del propio registro sincronizado), en nueva pestaña, en el módulo correcto. Sin home, sin vistas genéricas, sin patrones legacy.

---

## Evidencia funcional
```
grep legacy en src ................ 0
mappers.ts:97  → contacts/companies/details/${companyId}
mappers.ts:103 → contacts/details/${c.id}
mappers.ts:133 → sales/deals/details/${d.id}
tsc --noEmit ...................... EXIT 0
```
> La verificación del click real (abrir Clientify logueado) la confirma Presidencia con los patrones ya validados; el código ahora emite exactamente esas URLs con el id correcto de cada registro. Sin commit/push.
