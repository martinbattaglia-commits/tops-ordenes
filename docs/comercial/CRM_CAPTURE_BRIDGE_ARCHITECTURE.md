# CRM_CAPTURE_BRIDGE_ARCHITECTURE — UX-1

**Módulo:** CRM Comercial Nexus · **Decisión:** UX-1 (puente de captura) · **Fecha:** 2026-06-04
**Objetivo:** que los artefactos existentes (**Cotizador**, **Propuesta ANMAT**, **Propuesta General**) persistan su salida dentro del dominio CRM (`crm_quotes`, `crm_proposals`) **sin reescribir su lógica de cálculo ni sus formularios**.
**Sin código · sin migraciones · sin RBAC.** Resuelve el riesgo R-1 de [CRM_UX_REVIEW](./CRM_UX_REVIEW.md).
**Base:** [CRM_DOMAIN_ARCHITECTURE](./CRM_DOMAIN_ARCHITECTURE.md) · tablas `crm_quotes(+items)` / `crm_proposals` (migración 0043).

---

## 1. Cómo funcionan hoy los artefactos (verificado)

| Artefacto | Ruta | Estado / salida | Persistencia hoy | PDF |
|---|---|---|---|---|
| Cotizador | `public/tools/cotizador/index.html` | app **bundleada** (gzip → `window.__resources`); cálculo en memoria | **ninguna** | `window.print()` |
| Propuesta ANMAT | `public/tools/propuesta-anmat/index.html` | HTML inline; estado en **`localStorage`** (`STORAGE_KEY`, `AG_KEY`) | localStorage | `window.print()` |
| Propuesta General | `public/tools/propuesta-general/index.html` | app **bundleada** | ninguna | `window.print()` |

**Embebido:** `ToolEmbed.tsx` monta `<iframe src="/tools/{slug}/index.html">` — **same-origin** dentro del shell Nexus. Directiva vigente: *la lógica, cálculos y formularios NO se tocan*; actualizar un artefacto = reemplazar su `index.html` completo.

---

## 2. El enabler: iframe same-origin

Como el iframe es **same-origin**, el host (React) **puede acceder a `iframe.contentWindow`**: leer su `localStorage`, su DOM y llamar funciones globales que el artefacto exponga. **No hace falta postMessage** (eso es para cross-origin). Esto habilita capturar la salida **desde afuera**, sin modificar el artefacto.

> Consecuencia clave: el botón "Guardar en Nexus" puede vivir en la **barra del host** (ToolEmbed), no dentro del artefacto.

---

## 3. Evaluación de las 3 opciones

| Criterio | 1 · "Guardar en Nexus" (host + lectura same-origin) | 2 · postMessage | 3 · Reescritura nativa |
|---|---|---|---|
| Toca el artefacto | **No** (anmat) / mínimo (hook 1 función, bundleados) | **Sí** (agregar postMessage adentro) | **Sí** (se reescribe todo) |
| Esfuerzo | **Bajo** | Medio | **Alto** |
| Fidelidad de cálculo | total (usa el artefacto real) | total | riesgo de divergencia |
| Robustez | alta (localStorage/hook) · media (DOM-scrape) | alta | alta |
| Cuándo conviene | **ahora** (same-origin) | si los tools pasan a otro origen/CDN/sandbox | si un artefacto se vuelve inmantenible |
| Riesgo | acoplamiento a la forma interna | requiere editar artefacto | pierde lógica validada (tarifario MAYO/2026) |
| Veredicto | ✅ **Recomendado** | 🔁 plan B (transporte futuro) | 🆘 último recurso |

---

## 4. Recomendación — Opción 1 con contrato transport-agnostic

**Botón "Guardar en Nexus" en la barra del host (ToolEmbed)** + un **adapter de captura por artefacto** que extrae un **payload normalizado**. El payload es el mismo sin importar el transporte → si mañana los tools pasan a otro origen, se cambia el transporte (a postMessage) sin tocar la persistencia.

```
┌─────────────────────── Host Nexus (React) ───────────────────────┐
│  Barra ToolEmbed:  [Pantalla completa]  [💾 Guardar en Nexus]     │
│        │ click                                                    │
│        ▼                                                          │
│  captureAdapter(slug).read(iframe.contentWindow)  ── same-origin  │
│        │  → CapturePayload (normalizado)                          │
│        ▼                                                          │
│  validar (Zod) → persistir crm_quotes(+items) / crm_proposals     │
│        │  → ligar a opportunity_id                                 │
│        ▼                                                          │
│  (opcional) generar PDF desde el payload → documents              │
└───────────────────────────────────────────────────────────────────┘
        ▲ iframe same-origin /tools/<slug>/index.html (NO se reescribe)
```

### 4.1 Adapter por artefacto (cómo lee cada uno)
| Artefacto | Fuente de captura | ¿Toca el artefacto? |
|---|---|---|
| **Propuesta ANMAT** | `contentWindow.localStorage[STORAGE_KEY/AG_KEY]` → JSON del formulario | **No** (cero cambios) |
| **Cotizador** | **preferido:** hook `window.__nexusCapture()` (1 función read-only que devuelve el estado del cálculo) · **fallback:** DOM-scrape de los totales/ítems renderizados | hook = +1 función additive · scrape = cero |
| **Propuesta General** | igual que cotizador (hook o DOM-scrape) | igual |

> El **hook mínimo** `window.__nexusCapture()` NO es reescritura: no toca cálculo, formularios ni UI; solo expone (read-only) el estado que el artefacto ya tiene en memoria. Es el "toque más liviano posible". Si Comercial prefiere cero cambios, se usa DOM-scrape (más frágil ante cambios de layout).

---

## 5. Contrato de captura (payload normalizado)

Forma conceptual (transport-agnostic). Se mapea 1:1 a las tablas de 0043.

### 5.1 Cotización → `crm_quotes` + `crm_quote_items`
```
QuoteCapture {
  kind: "quote",
  service_type: "anmat" | "general" | "oficinas",
  tarifario_ref: "MAYO/2026",
  currency: "ARS",
  subtotal, descuento_total, iva, total,        // números del cálculo
  items: [ { concepto, categoria, cantidad, unidad, precio_unit, importe } ],
  raw: { ...snapshot completo... }              // jsonb de trazabilidad
}
```

### 5.2 Propuesta → `crm_proposals`
```
ProposalCapture {
  kind: "proposal",
  tipo: "anmat" | "general",
  fields: { ...datos del formulario de la propuesta... },
  raw: { ...localStorage / estado... }
}
```

**Mapeo:** `QuoteCapture` → `crm_quotes` (totales) + `crm_quote_items` (líneas) + `payload=raw`. `ProposalCapture` → `crm_proposals.payload` (+ versión + PDF). Ambos se ligan a `opportunity_id` (la captura se invoca **desde la ficha 360°**).

---

## 6. Flujo de secuencia (happy path)

```
1. Vendedor, en la Ficha 360° de una oportunidad → botón "Cotizar".
2. Host abre el iframe del cotizador, prefill por URL params si el artefacto lo soporta
   (?opp=OPP-2026-0042&service=anmat&m2=300). Si no, carga manual.
3. Vendedor completa el cálculo dentro del artefacto (lógica intacta).
4. Click "💾 Guardar en Nexus" (barra del host).
5. captureAdapter lee el payload (localStorage / hook / DOM) same-origin.
6. Host valida (Zod) → persiste crm_quotes(+items) ligada a la oportunidad.
7. (Opcional) genera PDF desde el payload → documents (tipo 'presupuesto').
8. Vuelve a la ficha con la cotización guardada y versionada.
```
Para propuestas, idéntico → `crm_proposals` + PDF (tipo 'contrato'/'presupuesto').

---

## 7. PDF — sub-decisión

Los artefactos hacen PDF por `window.print()` (no capturable programáticamente). Para persistir el PDF:

| Opción PDF | Cómo | Veredicto |
|---|---|---|
| **Regenerar desde el payload** | render server-side con `@react-pdf/renderer` (ya en el repo) usando los datos capturados | ✅ recomendado — el payload es la fuente de verdad |
| Snapshot HTML del artefacto | guardar el HTML de impresión + convertir | alternativa; más frágil |
| Mantener `window.print()` manual | el usuario imprime aparte; Nexus guarda solo el payload | mínimo viable inicial |

> Decisión: **persistir el payload primero** (fuente de verdad estructurada). El PDF se genera/adjunta después desde el payload — no se scrapea la salida de impresión.

---

## 8. Prefill (host → artefacto)

Dirección inversa: pasar contexto de la oportunidad **hacia** el artefacto.
- **Vía URL params** si el artefacto los lee (`/tools/cotizador/index.html?service=anmat&m2=300`). La Propuesta ANMAT ya tiene un mecanismo de "importar datos" → candidato directo.
- Si no los soporta: prefill manual (el vendedor copia servicio/m²). No bloqueante.
- **No requiere reescritura**; a lo sumo el artefacto lee query params (additive).

---

## 9. Seguridad

- **Same-origin = confianza de primera parte.** El artefacto corre con el origen de la app; leer su `contentWindow` es seguro porque es contenido propio (`public/tools/`).
- **Validar siempre con Zod** el payload capturado antes de persistir (no confiar ciegamente en la forma interna del artefacto).
- **Sanitizar** strings antes de guardar; nunca `eval` del contenido del iframe.
- Si en el futuro los tools se sirven desde **otro origen/CDN** o se aíslan con `sandbox`, se pierde el acceso directo → se migra el transporte a **postMessage** (Opción 2), conservando el mismo `CapturePayload`.

---

## 10. Cuándo escalar a Opción 2 o 3

| Disparador | Acción |
|---|---|
| Tools movidos a otro origen / `sandbox` estricto | → Opción 2 (postMessage), mismo payload |
| Un artefacto cambia de layout y rompe el DOM-scrape seguido | → agregar el hook `__nexusCapture()` (sigue siendo Opción 1) |
| Un artefacto se vuelve inmantenible / se necesita edición online | → Opción 3 (reescritura nativa) **solo de ese artefacto**, reusando el `CapturePayload` |

---

## 11. Decisiones a ratificar (antes de implementar el puente)

| # | Decisión | Recomendación |
|---|---|---|
| CB-1 | Transporte: lectura same-origin directa vs postMessage | **same-origin directa** (hoy) |
| CB-2 | Cotizador/General: **hook `__nexusCapture()`** (1 función) vs **DOM-scrape** (cero cambios) | ✅ **RATIFICADO: hook mínimo `window.__nexusCapture()`**. DOM-scrape queda SOLO como fallback de emergencia (más robusto, tipado, desacoplado de UI, compatible con evolución, same-origin confirmado) |
| CB-3 | PDF: regenerar desde payload vs print manual inicial | **regenerar desde payload** con `@react-pdf` |
| CB-4 | Prefill por URL params: ¿se pide a Comercial que el artefacto los lea? | sí (additive, no bloqueante) |
| CB-5 | ¿El botón "Guardar en Nexus" vive en el host (recomendado) o dentro del artefacto? | **host** (ToolEmbed) — no toca el artefacto |

---

## 12. Conclusión

**Opción 1 — "Guardar en Nexus" host-driven sobre iframe same-origin** resuelve UX-1 **sin reescribir** los artefactos: Propuesta ANMAT con cero cambios (localStorage), Cotizador/General con un hook read-only de una función (o DOM-scrape). El `CapturePayload` normalizado es transport-agnostic, de modo que postMessage (Opción 2) y la reescritura nativa (Opción 3) quedan como caminos de escape sin rehacer la persistencia.

> Resuelto UX-1 en diseño. El siguiente paso técnico sigue siendo **F2.1-3** (RBAC seed + `profiles_public`); la implementación del puente entra en F2.1-7 (persistencia de cotizaciones/propuestas), ya con contrato definido. **Sin código/migraciones/RBAC en este documento.**
