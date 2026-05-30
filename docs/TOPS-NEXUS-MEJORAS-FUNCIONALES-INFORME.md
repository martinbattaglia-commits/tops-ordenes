# TOPS NEXUS — Informe de Mejoras Funcionales y UX

**Proyecto:** TOPS NEXUS (Logística TOPS / Verotin S.A.)
**Fecha:** 2026-05-30
**Naturaleza:** Auditoría funcional + propuesta técnica + roadmap. **Diagnóstico, NO implementación.**
**Estado de la plataforma:** los cambios descritos están auditados contra el código real (rutas y líneas citadas). Nada fue modificado.

> 🛑 **Alcance honrado:** este documento no toca código, no deploya, no pushea. Es la guía para aprobar antes de programar. Una vez que apruebes el plan (total o por fases), se procede a implementar.

---

## 0 · Resumen ejecutivo

Pediste 8 mejoras. La buena noticia: **la mitad son quick wins de bajo riesgo** (el código ya existe o el cambio es de 1 archivo), y la pieza más ambiciosa —el **Digital Twin de depósitos**— es construible por fases sobre la arquitectura actual sin reescribir nada.

Hallazgo clave que cambia la economía del pedido #4: **el motor de OCR de facturas ya está construido y funciona** (`src/lib/ocr/openai.ts`, GPT-4o-mini + Vision). No hay que crearlo: está **huérfano** (nadie lo importa, no tiene endpoint ni UI). Recuperarlo es *cablearlo*, no inventarlo. Eso baja el costo del módulo más "caro" en apariencia.

| Pedido | Esfuerzo | Impacto | Riesgo | Fase |
|--------|----------|---------|--------|------|
| #1 Corregir sedes (3→2) | 🟢 Trivial (1 archivo) | Alto (dato ejecutivo erróneo) | Bajo | **F1 — Quick wins** |
| #2 Reordenar menú (Workspace #2) | 🟢 Trivial (1 archivo) | Medio | Bajo | **F1 — Quick wins** |
| #6 Carpeta Marketing en Drive | 🟢 Trivial (acción en Drive) / 🟡 Media (multi-root) | Medio | Bajo | **F1 / F3** |
| #4 Recuperar OCR facturas | 🟡 Media (cablear lib existente) | **Alto** | Medio | **F2 — OCR** |
| #3 "Información del día" + noticias | 🟡 Media (APIs externas) | Medio | Medio (costo/privacidad) | **F2** |
| Dashboard comercial (HTML) → Marketing | 🟡 Media | Medio | Bajo | **F3** |
| #5/#8 Digital Twin depósitos | 🔴 Grande (por fases) | **Muy alto** | Medio-alto | **F4-F6** |

**Recomendación de secuencia:** F1 (sedes + menú + Marketing folder) esta semana → F2 (OCR + info del día) → F3 (Marketing section + dashboard comercial) → F4-F6 (Digital Twin incremental). Las fases son independientes; podés aprobar y soltar cada una por separado.

---

## 1 · Diagnóstico por pedido

### #1 — Corrección de sedes (3 → 2) 🟢

**Estado actual (verificado):** el Cockpit ejecutivo (`src/app/(app)/ejecutivo/page.tsx`) imprime `{data.locations.length} locaciones` (línea 35) y `{...} sedes operativas` (línea 66). La fuente única es el array `LOCATIONS` en **`src/lib/ejecutivo/locations.ts` (líneas 28–59)** con **3 entradas**:

| id | label | m² (hardcoded) | ¿correcto? |
|----|-------|----------------|------------|
| `magaldi` | "Magaldi · Agustín Magaldi 1765, Barracas" | 6800 | ✅ Sede Central |
| **`barracas`** | **"Barracas · Av. Vélez Sarsfield"** | **5400** | ❌ **ENTRADA FANTASMA — eliminar** |
| `lujan` | "Pedro de Luján 3159" | 2800 | ✅ Sede Luján |

**Causa raíz:** "Barracas" se modeló como una tercera sede independiente, pero Barracas es el *barrio* donde está Magaldi, no una sede aparte. Como ese array alimenta el Cockpit, `/operaciones/mapa` y el componente `AmbaMap`, **borrar el objeto `barracas` corrige los tres consumidores de una sola vez** (`length` pasa a 2, el total de m² se recalcula).

**Propuesta:**
1. Eliminar la entrada `barracas` (`locations.ts:39–48`).
2. Limpieza cosmética asociada: pin huérfano y offset de etiqueta en `AmbaMap.tsx` (líneas 22, 102–105) + subtítulo hardcodeado "Magaldi · Barracas · Pedro de Luján" en `operaciones/mapa/page.tsx:56`.
3. **Reconciliar los m²:** los valores actuales (6800/2800) **no coinciden** con la superficie real. El plano de habilitación de VEROTIN da **Magaldi ≈ 6.893,87 m² autorizados**; vos manejás ~7.500 m² operativos por sede. **Decisión tuya:** ¿usamos los m² *autorizados* del plano (riguroso, fiscal) o los *operativos* redondeados (~7.500)? Esto se conecta directo con el Digital Twin (#8), donde los m² dejan de ser constantes y pasan a calcularse.

**Impacto técnico:** 1 archivo crítico + 2 cosméticos. Sin migración, sin riesgo de datos.

---

### #2 — Reordenamiento del menú principal 🟢

**Estado actual (verificado):** la navegación es **config-driven** — un array `DOMAINS` en **`src/components/shell/Sidebar.tsx` (líneas 29–111)**, 9 secciones colapsables. El orden en pantalla = orden del array. Hoy:

1. Cockpit (`/ejecutivo`) · 2. Compras · 3. Operaciones · 4. Comercial · 5. ANMAT · 6. CCTV · 7. Analytics & Finanzas · **8. Google Workspace** (`/workspace`) · 9. Sistema.

**Google Workspace está 8º de 9** — penúltimo, abajo de todo. (En `MobileBottomNav.tsx` ni aparece.)

**Propuesta (objetivo: Dashboard → Workspace → ERP → resto):**
- Mover el bloque `workspace` (Sidebar.tsx:92–98) a la **posición #2**, justo después de Cockpit. **Es un reordenamiento puro de elementos del array** — el loop de render (178–189) y el set `isActive` (122–148) son order-agnostic y **no requieren cambios**. Sin RBAC, sin rutas nuevas.
- **Sugerencia adicional:** surfacar `/workspace` también en `MobileBottomNav.tsx` para el acceso rápido a Gmail/Calendar/Gemini desde el celular (hoy no está).

**Nota de UX:** hoy "Drive" aparece **dos veces** (`/drive` "Drive TOPS" en §5 y `/compras/drive` "Drive sync" en §7). Vale unificar la nomenclatura al pasar Workspace arriba, para no confundir "Drive documental" con "Drive sync de compras".

**Impacto técnico:** 1 archivo, reorden de array. Riesgo nulo.

---

### #3 — Dashboard Ejecutivo: "Información del día" + noticias 🟡

**Estado actual (verificado):** **no existe** ningún widget de fecha/hora/clima/noticias en el Cockpit ni en `/dashboard`. Lo único con lógica de fecha es el saludo por hora ("Buen día"). El Cockpit es server component `force-dynamic` que ya trae datos reales de Supabase (KPIs de OC/OS).

**Propuesta — bloque "Hoy en TOPS" (header del Cockpit):**
- **Fecha + hora** (zona ART): trivial, sin API.
- **Clima + temperatura** (Buenos Aires): API externa. Opciones: Open-Meteo (gratis, sin API key, recomendado) o OpenWeatherMap (free tier). Se consume server-side y se cachea ~30 min.
- **2–3 noticias** (Economía AR/Intl · Logística · Comercio Exterior · Tecnología): fuente vía RSS curado o API de noticias (NewsAPI free tier / GNews). Server-side, cache ~1–2 h. **Diseño "contexto ejecutivo", no portal:** una tarjeta angosta, 2-3 títulos con fuente y link, sin imágenes ni scroll infinito.

**Arquitectura sugerida:** un Route Handler `GET /api/today` que agrega clima + noticias con cache (`revalidate`), consumido por un client component liviano en el header del Cockpit. Las claves de API van como env vars (nunca al repo).

**Riesgos/decisiones:** (a) costo y rate limits de la API de noticias — el free tier alcanza para uso interno; (b) **curaduría:** definir 3-4 fuentes confiables para no traer ruido; (c) privacidad: el clima por ciudad fija (Buenos Aires) no expone datos del usuario.

**Impacto técnico:** 1 route handler + 1 componente + 2 env vars + (opcional) selección de fuentes RSS. Medio.

---

### #4 — Recuperar OCR de facturas de proveedores 🟡 (mejor ROI del paquete)

**Estado actual (verificado) — el motor YA EXISTE y funciona:**
- **`src/lib/ocr/openai.ts`**: `extractFromPdf()` (pdf-parse → GPT-4o-mini) y `extractFromImage()` (Vision). El prompt (líneas 46–77) **ya extrae exactamente lo que pedís**: `parties(name, taxId/CUIT, role)`, `amounts(subtotal|iva|total|neto)`, `date`, `type`, `lineItems`, `tags`. Validado por `scripts/test-ocr.mjs` y `scripts/test-openai.mjs` ("OpenAI listo para OCR Centro Documental").
- **Tabla destino ya existe:** migración `0014_supplier_invoices.sql` crea `supplier_invoices` (vendor_id, tipo_comprobante, cae, fecha_emision, neto/iva/percepciones/total, status, **`pdf_url`**) + `cost_centers`.
- **UI manual ya existe y está en el menú:** `/compras/facturas` y `/compras/facturas/nueva` (formulario manual, sin upload/OCR).

**El gap (3 piezas):**
1. **El motor OCR está huérfano** — nadie importa `extractFromPdf`/`extractFromImage`, no hay endpoint `/api/documental/ocr`, no hay "Centro Documental" (solo referencias muertas en `anmat/page.tsx:284` y `layout.tsx`).
2. **`/compras/facturas/nueva` no tiene campo de upload** — el `pdf_url` existe pero ningún flujo lo llena.
3. **PDF escaneado → imagen** es un TODO del lib (hoy tira 422 en escaneos; los PDF de texto y las fotos JPG/PNG sí funcionan).

#### Propuesta técnica OCR (factibilidad · arquitectura · costos · automatización)

**Factibilidad: ALTA.** El 70% del trabajo está hecho. Es integración, no I+D.

**Arquitectura propuesta (human-in-the-loop):**
```
[Foto/PDF] → upload a Supabase Storage (bucket privado)
           → POST /api/documental/ocr  (wrap de src/lib/ocr/openai.ts)
           → extract { proveedor, CUIT, fecha, neto, IVA, total, tipo, condición pago }
           → PRE-LLENA el formulario /compras/facturas/nueva (no inserta a ciegas)
           → el usuario CONFIRMA/corrige → insert a supplier_invoices + pdf_url
```
**Por qué human-in-the-loop y no auto-insert total:** es contabilidad. Un dígito mal en un importe o CUIT contamina libros y conciliación ARCA. El patrón correcto es **"AI llena, humano confirma con 1 click"** — captura ~90% del tiempo de tipeo manteniendo control. La autonomía total se puede activar después, por proveedor confiable, una vez medida la precisión.

**Nivel de automatización alcanzable:**
- PDF de texto (e-facturas) y fotos nítidas: **~85-95% straight-through** (todos los campos pre-llenados, el humano solo confirma).
- Escaneos/fotos malas: requiere el paso PDF→imagen (render con `pdfjs`/`sharp`) — cerrable en F2.
- Validaciones automáticas: CUIT (dígito verificador), `neto + IVA = total`, fecha plausible → flags antes de confirmar.

**Costos estimados (orden de magnitud, GPT-4o-mini Vision):** una factura ≈ 1.000–2.500 tokens de entrada + ~500 de salida → **< US$0,01 por factura** (típicamente US$0,002–0,005). A 200 facturas/mes ≈ **< US$1–2/mes**. Costo despreciable frente al ahorro de carga manual. *(Confirmar contra el tarifario vigente de OpenAI; gpt-4o-mini es el modelo más económico con visión.)*

**Pendiente operativo:** documentar `OPENAI_API_KEY` + `OPENAI_OCR_MODEL` en `.env.example` (hoy solo en `.env.local`).

**Impacto técnico:** 1 route handler + 1 componente de upload + pre-fill del form + (opcional) render PDF→imagen. **Media — pero con motor ya probado.**

---

### #5 + #8 — Módulo Digital Twin de depósitos 🔴 (la pieza grande)

> #5 (mapa interactivo + estados + KPIs) y #8 (Digital Twin multi-cliente + motor de cálculo + vista comercial) son **el mismo módulo en dos niveles de ambición**. Los trato unificados, en fases.

**Estado actual (verificado):**
- **No existe** ningún módulo de ocupación basado en planos. Lo más cercano, `/operaciones/mapa` (`AmbaMap.tsx`), es un **mapa estilizado de la ciudad de CABA** (SVG con pins), **no** un plano de depósito.
- La ocupación hoy es **`occupancyPct: null` por diseño** (`locations.ts:34,44,54`) — el KPI "Ocupación m²" del Cockpit está hardcodeado en null con `pendingReason: "Pendiente de integración con sondas / entrada operativa real"` (`data.ts:102-108`). **Este es el hook natural** para que el Digital Twin alimente automáticamente ese KPI (tu pedido explícito: "que deje de ser un dato manual").
- Los planos adjuntos: **Magaldi ≈ 6.893,87 m² autorizados** (plano VEROTIN); **Luján dividido en PB1–PB8 y PA1–PA8** (16 sectores: planta baja + planta alta). Estos planos son la base geométrica del modelo.

#### Modelo de datos propuesto (evolutivo)

```
sede (2 filas: magaldi, lujan)
 └─ nave/sector  (PB1..PB8, PA1..PA8, etc.)  ── m2_total, geometría (polígono SVG), tipo (ANMAT|General|Oficina|Coworking|Cubículo)
     └─ ocupacion (multi-cliente, N por sector)
         ── cliente_id, m2_ocupados, fecha_inicio, fecha_vencimiento, estado (ocupado|reservado|fuera_servicio)
```
- Un sector tiene **m² total**; sus `ocupacion` suman lo ocupado; **disponible = total − Σ ocupado**.
- **Multi-cliente real:** Nave A (1.000 m²) = Cliente 1 (300) + Cliente 2 (450) + disponible (250) → se renderiza **segmentada** visualmente.

#### Estados visuales (tu spec)
🟢 Disponible · 🔴 Ocupado · 🟡 Reservado/pendiente · ⚪ Fuera de servicio/mantenimiento.

#### Hover (tu spec)
Nombre nave · m² total · m² ocupado · m² disponible · % ocupación · cliente(s) ocupante(s) · fecha inicio · fecha vencimiento.

#### Motor de KPIs (auto-calculado, conectado al mapa)
- **Globales:** m² totales / ocupados / disponibles · % ocupación · % vacancia.
- **Por sede:** Magaldi vs Luján.
- **Por tipo de negocio:** ANMAT · Cargas Generales · Oficinas · Coworking · Cubículos.
- **Alimenta el Cockpit:** reemplaza el `occupancyPct: null` por el cálculo real.

#### Vista comercial (tu spec)
Panel para el equipo de ventas: espacios disponibles inmediatos · próximos a liberarse (por `fecha_vencimiento`) · clientes con vencimientos próximos · m² disponibles por tipo de almacenamiento → **detección de oportunidades**.

#### Arquitectura preparada para el futuro (tu spec)
El modelo `sede → sector → ocupacion` se diseña con *puntos de extensión* para integrar luego: **WMS** (sync de stock/posiciones), **Clientify CRM** (cliente_id ya es la llave), **Contratos** (fecha_vencimiento → alertas), **Facturación** (m²×tarifa → el módulo de billing que ya vive en prod), **Google Maps Indoor / sensores IoT** (geometría + telemetría en tiempo real). No se construye ahora, pero el esquema no lo bloquea.

#### Fase 0 de datos (prerequisito): digitalizar los planos
Los planos PDF son la verdad geométrica. Hay que convertir PB1–PB8/PA1–PA8 (Luján) y los sectores de Magaldi a **polígonos SVG + m² por sector**. Opciones: (a) vectorización manual asistida (1-2 días de data-entry sobre los planos), o (b) reutilizar la Vision API para una primera extracción aproximada + ajuste manual. **Decisión:** este es el único trabajo "no-código" que te toca proveer/validar (los m² reales por sector).

**Impacto técnico:** migración nueva (sede/sector/ocupacion + RLS) · página interactiva SVG · motor de KPIs · vista comercial · wire al Cockpit. **Grande pero fasificable** — un MVP de "mapa + estados + KPIs globales" es entregable antes que la segmentación multi-cliente y la vista comercial.

---

### #6 — Carpeta "Marketing" en Google Drive + Dashboard comercial 🟢/🟡

**Estado actual (verificado):** la integración Drive activa (`src/lib/drive/client.ts`) expone **una sola carpeta raíz** vía `GOOGLE_DRIVE_ROOT_FOLDER_ID` y navega su subárbol con enforcement de scope (`isUnderRoot`). **"Agencia Gubernamental de Control" NO es un folderId configurado** — es solo texto descriptivo en `DriveBrowser.tsx:639`. No hay array de carpetas hardcodeado: se ve lo que cuelga del root.

**Propuesta Marketing — dos caminos:**
- **🟢 Camino rápido (cero código):** crear una subcarpeta **"Marketing"** dentro de la carpeta raíz actual en Drive → **aparece automáticamente** en `/drive`, sin tocar la app. Ideal para arrancar ya.
- **🟡 Camino completo (multi-root):** si Marketing debe ser un **root separado** (fuera del subárbol actual), hay que generalizar el modelo de single-root a multi-root: reemplazar `GOOGLE_DRIVE_ROOT_FOLDER_ID` por config multi-carpeta, extender `isUnderRoot()` (`client.ts:585`) y los guards (372, 490), y actualizar `/api/drive/list`. Más la copy en `DriveBrowser.tsx:639`.

**Dashboard comercial (`TOPS-Dashboard-Comercial.html`):** es un panel de pipeline (funnel, distribución, forecast por mes, heatmap, top 5 oportunidades ponderadas, tabla de oportunidades; basado en SheetJS, 2.6 MB standalone). **Propuesta de integración en la sección Marketing/Comercial:**
- **Rápido:** servirlo como página standalone embebida (iframe) bajo `/comercial` o `/marketing`.
- **Nativo (recomendado a mediano plazo):** reconstruirlo como página React consumiendo los datos reales del CRM (Clientify ya está integrado en `/comercial/pipeline`), para que las métricas dejen de ser estáticas. Esto conecta con tu pedido de "agregar los pipelines + este informe" en la sección Marketing.

**Workspace hoy:** `/workspace` es un **hub de links + mock** (Gmail/Calendar/Drive/Meet/Gemini como accesos externos), sin OAuth/APIs reales. Marketing debe aparecer tanto en el módulo documental (`/drive`) como referenciado desde Workspace.

---

## 2 · Mockups conceptuales (UX/UI)

**Cockpit ejecutivo (post-mejoras #1, #3):**
```
┌─────────────────────────────────────────────────────────────┐
│ Buen día, Martín.            ┌─ HOY EN TOPS ──────────────┐  │
│ 2 locaciones · 13.787 m²     │ Vie 30/05 · 14:32 · 🌤 18°C │  │
│ [Nueva OC] [Nueva OS]        │ • Dólar/Merval (Economía)   │  │
│                              │ • Puertos/logística (CdE)   │  │
│                              │ • Tech relevante            │  │
│                              └─────────────────────────────┘  │
├──────────────┬──────────────┬──────────────┬────────────────┤
│ KPI OC       │ KPI OS       │ Ocupación m² │ ...            │
│              │              │ 72% (auto ✅)│  ← ya no "—"    │
└──────────────┴──────────────┴──────────────┴────────────────┘
```

**Digital Twin — vista interactiva (#5/#8):**
```
┌─ Sede Luján ──────────────────────────  [Magaldi] [Luján] ─┐
│  PB1🟢  PB2🔴  PB3🟡  PB4🟢   ┌─ hover: PB2 ──────────────┐ │
│  PB5🔴  PB6🔴  PB7🟢  PB8⚪   │ Nave PB2 · 1.000 m²        │ │
│  ───────────────────────────  │ Ocupado 750 · Disp 250     │ │
│  PA1🟢  PA2🟢  PA3🔴  PA4🟡   │ 75% · Cliente1 300/Cli2 450│ │
│  PA5🟢  PA6🔴  PA7🟢  PA8🟢   │ Vence: 2026-09-15          │ │
│                               └────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│ KPIs: 13.787 m² tot · 9.9k ocup · 72% · ANMAT 81% · Gral 64% │
└──────────────────────────────────────────────────────────────┘
```
*(Sectores 🔴 multi-cliente se renderizan segmentados internamente por cliente.)*

**OCR facturas (#4):**
```
/compras/facturas/nueva
┌─ [📷 Sacar foto / 📎 Subir PDF] ──────────────────────────┐
│  → IA leyó la factura (revisá y confirmá):                 │
│  Proveedor [ACME S.A.____]  CUIT [30-xxxxxxxx-x]  ⚠ verif. │
│  Fecha [2026-05-12]  Neto [100.000]  IVA [21.000]          │
│  Total [121.000] ✅ neto+iva=total   Cond. pago [30 días]  │
│  [Confirmar y registrar]   [Editar manual]                 │
└────────────────────────────────────────────────────────────┘
```

---

## 3 · Riesgos y dependencias consolidados

| ID | Riesgo / Dependencia | Pedido | Mitigación |
|----|----------------------|--------|------------|
| R1 | m² de sedes inconsistentes (autorizado 6.893,87 vs operativo 7.500) | #1/#8 | Decisión tuya: fuente oficial de m². Reconciliar en Fase 0 de datos. |
| R2 | API de noticias: costo / rate-limit / ruido editorial | #3 | Free tier + curaduría de 3-4 fuentes + cache server-side. |
| R3 | OCR contable sin control → errores en libros | #4 | Human-in-the-loop (AI llena, humano confirma) + validaciones CUIT/total. |
| R4 | Geometría de planos sin digitalizar | #5/#8 | Fase 0 de datos (vectorización PB/PA + m² por sector) antes del front. |
| R5 | Modelo single-root de Drive | #6 | Camino rápido (subcarpeta) primero; multi-root solo si hace falta. |
| R6 | Claves de API (OpenAI, clima, noticias) en repo | #3/#4 | Siempre env vars; documentar en `.env.example`, nunca commitear secretos. |
| R7 | Dashboard comercial estático (2.6 MB) | #6 | Iframe ahora; reconstrucción nativa con datos Clientify después. |
| D1 | Clientify CRM (ya integrado) | #6/#8 | `cliente_id` como llave compartida ocupación↔CRM. |
| D2 | Billing en prod (ya vive) | #8 | m²×tarifa → futura facturación de ocupación. |

---

## 4 · Roadmap de implementación por fases

**F1 · Quick wins (≈ medio día) — riesgo bajo, alta visibilidad**
- #1 Sedes 3→2 (`locations.ts` + limpieza AmbaMap/mapa).
- #2 Reorden de menú (Workspace #2 en `Sidebar.tsx`) + opcional Workspace en mobile.
- #6 (rápido) crear subcarpeta "Marketing" en Drive (acción tuya en Drive, cero código).
- Decisión de m² oficiales (R1).

**F2 · Inteligencia diaria + OCR (≈ 2-4 días)**
- #4 Recuperar OCR: endpoint `/api/documental/ocr` + upload en `/compras/facturas/nueva` + pre-fill + validaciones; cerrar PDF-scan→imagen; documentar env vars.
- #3 "Información del día": `/api/today` (clima Open-Meteo + noticias curadas) + widget en Cockpit.

**F3 · Marketing & Comercial (≈ 2-3 días)**
- Sección Marketing: dashboard comercial integrado (iframe → luego nativo con Clientify).
- #6 (completo) multi-root Drive si se decide Marketing como root separado.

**F4-F6 · Digital Twin incremental (por etapas)**
- **F4 — Fase 0 datos + MVP:** digitalizar planos (polígonos + m²) → migración `sede/sector/ocupacion` → mapa SVG interactivo con estados + hover + KPIs globales. Wire al KPI de ocupación del Cockpit.
- **F5 — Multi-cliente + comercial:** segmentación por cliente dentro del sector + KPIs por sede/tipo + vista comercial (disponibles/próximos a liberarse/vencimientos).
- **F6 — Integraciones:** ganchos a Contratos, Facturación (m²×tarifa), y preparación WMS/Maps Indoor/IoT.

---

## 5 · Decisiones que necesito de vos (antes de programar)

1. **m² oficiales por sede:** ¿autorizados del plano (Magaldi 6.893,87) o operativos (~7.500)? ¿Tenés el m² real de cada sector PB/PA de Luján y de los sectores de Magaldi?
2. **OCR — nivel de autonomía inicial:** ¿arrancamos con "AI llena, humano confirma" (recomendado) o querés auto-insert directo?
3. **Noticias — fuentes:** ¿qué 3-4 fuentes confiables querés (Ámbito/Cronista/BAE/Telam/etc.)? ¿Algún sesgo a evitar?
4. **Marketing en Drive:** ¿subcarpeta bajo el root actual (ya) o root separado (multi-root)?
5. **Orden de ataque:** ¿confirmás F1→F2→F3→F4-F6, o querés repriorizar (ej. Digital Twin antes que OCR)?
6. **Aprobación:** ¿aprobás el plan completo, o fase por fase?

---

**Una línea:** plataforma auditada contra código real; 4 quick wins listos para F1, el OCR ya existe y solo hay que cablearlo (mejor ROI), y el Digital Twin es construible por fases sobre el hook de ocupación que ya quedó preparado en el Cockpit. **Nada se tocó — espera tu aprobación para implementar.**
