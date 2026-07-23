# F2 — Inventario Funcional · Módulo Prospección Inteligente
**Estado:** `EN PRODUCCIÓN ✅` · **Versión:** `b1ea521` · **Fecha:** 2026-06-29

Este documento describe exactamente qué funcionalidades posee hoy el módulo **Prospección Inteligente** (`/comercial/prospeccion`) en producción. No incluye roadmap ni mejoras futuras.

---

## 1. Importación

### Lo que existe hoy

- **Soporte de formatos:** CSV y XLSX (vía `exceljs` + `papaparse`).
- **Fuentes detectadas automáticamente:** LinkedIn Sales Navigator, Evaboot, Apollo, Wiza, Phantombuster, Clientify, CSV genérico. La detección es por firma de headers, sin configuración manual.
- **Mecanismo de upload:** drag-and-drop o click sobre la zona de drop en la UI. **No existe** file picker de sistema operativo; todo va por el drop-zone del browser.
- **Parser (UDIE):** Universal Data Ingestion Engine — mapea headers heterogéneos a un esquema canónico normalizado. Tolerante a headers faltantes; solo `linkedin_url` es identidad obligatoria para prospectos LinkedIn.
- **Normalización automática:** nombre completo → firstName + lastName; cargo; empresa; email; teléfono; website; LinkedIn URL; país; industria (raw).
- **Deduplicación:** CUIT → email → linkedin_url. Un prospecto que ya existe (por cualquiera de esas 3 claves) es silenciosamente ignorado (no duplica).
- **Feedback de importación:** la UI muestra cuántos prospectos fueron importados y cuántos descartados por deduplicación.
- **Estado inicial:** todos los prospectos importados entran en `imported`.

### Lo que NO existe

- Mapeo manual de columnas (F1+: drag de headers).
- File upload por ruta de sistema (solo drag-and-drop en browser).
- Import desde URL / API de LinkedIn directamente (sin CSV).
- Soporte de XLS legacy (solo XLSX moderno).

---

## 2. Normalización

### Lo que existe hoy

- Normalización de nombre completo (split first/last por espacios).
- Normalización de cargo (raw string, sin taxonomía).
- Normalización de industria raw → `industry_normalized` con 4 valores canónicos: `ideal`, `compatible`, `neutral`, `incompatible`.
- Normalización de tamaño de empresa → `employee_band`: XS (<10), S (10-49), M (50-249), L (250-999), XL (≥1000).
- Normalización de país → `is_argentina` (boolean).
- Detección de señales logísticas desde texto/industria: `has_depositos`, `has_import_export`, `has_distribucion_nacional`, `has_cds`, `terceriza_almacenamiento`, `dentro_mercado_objetivo`.
- Detección de señal de crecimiento: `growth_signal` (none/low/mid/high).
- Evidencia: toda la normalización opera sobre los datos que el CSV ya trae; **no hay llamadas a APIs externas** en esta etapa.

### Lo que NO existe

- Taxonomía de cargos normalizada (solo raw string).
- Normalización de teléfonos a formato E.164.
- Resolución de nombre de empresa a entidad canónica (sin enriquecimiento externo).

---

## 3. Deduplicación

### Lo que existe hoy

- **Estrategia:** CUIT → email → linkedin_url (en ese orden de prioridad).
- **Nivel:** deduplicación contra la tabla `prospeccion_prospects` en Supabase (RPC `prospeccion_ingest` con lógica de upsert).
- **Comportamiento en duplicado:** el prospecto existente NO se actualiza; el nuevo se descarta silenciosamente.
- **Scope:** deduplicación cross-importación (un prospecto importado en sesión anterior no se vuelve a crear).

### Lo que NO existe

- Deduplicación fuzzy (nombres similares, emails con typos).
- Deduplicación contra contactos ya existentes en Clientify.
- Merge de datos entre versiones de un mismo prospecto.
- Detección de empresa duplicada (mismo empresa, distintos contactos).

---

## 4. Motor de Scoring

### Lo que existe hoy

- **Estrategia:** ICP general-v1 (Ideal Customer Profile, versión 1, unidad de negocio General).
- **Score:** 0-100, entero, calculado por función pura (sin I/O).
- **6 dimensiones de scoring:**

  | Dimensión | Peso | Variable |
  |-----------|------|----------|
  | Industria | 30% | `industry_normalized` |
  | Geografía | 20% | `is_argentina` |
  | Tipo de negocio | 15% | `is_b2b` |
  | Señales logísticas | 20% | 5 señales binarias (`has_depositos`, etc.) |
  | Mercado objetivo | 10% | `dentro_mercado_objetivo` |
  | Crecimiento | 5% | `growth_signal` |

- **Confidence Score:** 0-100, independiente del score principal; mide qué tan completa es la evidencia.
- **Prioridad comercial:** tier (alta/media/baja) + valor numérico para ordenamiento.
- **DecisionTrace:** envelope JSON completo persistido (factores, penalizaciones, hard_fails, versiones de modelo/ICP/confidence).
- **Explicación:** texto legible generado automáticamente por el motor explicando el score.
- **Persistencia:** append-only en `prospeccion_scores`. El historial completo de scoring se conserva. La vista `prospeccion_scores_current` expone solo la última puntuación.
- **Atomicidad:** el pipeline `enrichment + scoring` corre dentro de una RPC `SECURITY DEFINER` con savepoints por prospecto (fallo individual no cancela el lote).
- **Anti-tamper:** el servidor siempre recalcula; nunca acepta un score pre-calculado del cliente.
- **Preview isomorfo:** el mismo código de scoring corre en el navegador para preview instantáneo antes de guardar.

### Lo que NO existe

- ICP por unidad de negocio específica (ANMAT, Cargas Generales, Fulfillment, etc.) — solo `general`.
- Enriquecimiento externo (sin llamadas a Apollo/PDL/ZoomInfo/scraping).
- Feedback Loop (ganadas/perdidas actualicen el modelo).
- Auto-aprendizaje del scoring desde resultados históricos.
- Múltiples estrategias ICP activas simultáneamente.

---

## 5. Clasificación

### Lo que existe hoy

- **3 clases:** 🟢 Importar (≥75) · 🟡 Revisar (50-74) · 🔴 Descartar (<50).
- La clasificación se muestra en la columna `CLASIFICACIÓN` de la bandeja con badge de color.
- El campo `decision` persiste la clasificación del motor: `import` / `review` / `discard`.
- **El campo `status` del prospecto es independiente:** un prospecto clasificado como `discard` puede ser aprobado manualmente por el humano (gate de override).

### Lo que NO existe

- Clasificación manual editable desde la UI.
- Clases adicionales o personalizables.
- Alerta de override cuando el humano contradice al motor (pendiente F2.1).

---

## 6. Dashboard

### Lo que existe hoy

- **Tab "Dashboard"** en `/comercial/prospeccion`.
- **Estadísticas:**
  - Total importados
  - Total calificados
  - Excelentes 🟢 (score ≥ 75)
  - Para revisar 🟡 (score 50-74)
  - Descartados 🔴 (score < 50)
  - Score promedio
  - Total aprobados
- **Distribución por decisión del motor** (con porcentaje).
- **Top industrias** (por conteo).
- **Top cargos** (por conteo).

### Lo que NO existe

- Filtros temporales (por semana/mes/trimestre).
- Gráficos históricos de evolución del score promedio.
- Métricas de conversión (aprobados → clientes).
- Dashboard por unidad de negocio.
- Exportación del dashboard a PDF/Excel.

---

## 7. Aprobación humana

### Lo que existe hoy

- **Botón Aprobar** por fila (ícono esmeralda): disponible cuando el prospecto está en `scoreado`, `enriquecido` o `imported`.
- **Botón Rechazar** por fila (ícono rojo): disponible desde cualquier estado excepto `cliente_creado`.
- **Acciones bulk:**
  - "Aprobar todos los 🟢": aprueba masivamente todos los prospectos con decisión `import`.
  - "Aprobar selección": aprueba los prospectos marcados con checkbox.
  - "Descartar selección": rechaza los prospectos marcados con checkbox.
- **Guard de transición:** la RPC valida el estado actual antes de transicionar; error `INVALID_TRANSITION` si el estado no lo permite.
- **Persistencia:** `approved_at`, `approved_by`, `rejected_at`, `rejected_by`, `rejection_reason` en `prospeccion_prospects`.
- **Ciclo approve→reject→approve:** limpia los campos del estado anterior (no acumula basura).
- **RBAC:** requiere permiso `prospeccion.approve` (`action='sign'`). Roles con acceso: `comercial`, `director_ops`, `admin`.

### Lo que NO existe

- Motivo de rechazo desde la UI (el campo `rejection_reason` existe en DB pero no hay input en UI).
- Historial de cambios de aprobación en la UI.
- Notificación al equipo cuando un prospecto es aprobado/rechazado.
- Indicador visual de override IA (cuando el humano contradice la recomendación del motor) — pendiente **F2.1**.

---

## 8. Exportación a Clientify

### Lo que existe hoy

- **Botón "Exportar aprobados a Clientify"** en la bandeja (bulk).
- **Botón "Enviar a Clientify"** por fila (para prospectos en estado `aprobado`).
- **Modal de confirmación** con conteo de prospectos a exportar.
- **Dedup en CRM:** si el prospecto tiene email, se busca un contacto existente en Clientify antes de crear uno nuevo.
- **Payload a Clientify:**
  - `first_name`, `last_name` (si existe), `title` (cargo, si existe), `company_name` (si existe)
  - `emails` (si existe), `phones` (si existe), `taxpayer_identification_number` CUIT (si existe)
  - `channel: "linkedin"`, `contact_source: "Prospección Inteligente TOPS"`
  - Campos opcionales incluidos **solo si tienen valor**.
- **Transición de estado:** `aprobado` → `sincronizado` tras exportación exitosa.
- **Referencia cruzada:** `prospeccion_crm_refs` registra `prospect_id`, `crm_provider='clientify'`, `crm_contact_id`, URL del contacto en Clientify, `synced_at`.
- **Registro de lote:** `prospeccion_export_log` registra cada exportación con `exported_by`, `exported_at`, `prospect_count`, `provider`, `results` (jsonb por prospecto), `total_ok`, `total_errors`.
- **Exportación parcial:** un error en un prospecto individual no cancela el lote; se registra en `errors` jsonb.
- **RBAC:** requiere permiso `prospeccion.export` (`action='export'`). Roles: `comercial`, `director_ops`, `admin`.

### Lo que NO existe

- Modo de prueba / sandbox de exportación.
- Actualización de contactos existentes en Clientify (actualmente reutiliza el existente pero no actualiza sus datos).
- Exportación a otros CRMs (HubSpot, Salesforce, Pipedrive) — arquitectura preparada vía adapter, no implementado.
- Exportación bidireccional (cambios en Clientify → Nexus).
- Retry automático de exports fallidos.

---

## 9. Auditoría

### Lo que existe hoy

- **`prospeccion_scores`** es append-only: cada ejecución del pipeline genera un registro inmutable con DecisionTrace completo.
- **`prospeccion_export_log`** es append-only: cada lote de exportación queda registrado con usuario, fecha, resultados individuales.
- **`approved_by` / `rejected_by`**: UUID del usuario que realizó la acción de aprobación/rechazo.
- **`approved_at` / `rejected_at`**: timestamp de la acción.
- **RLS** en todas las tablas: solo usuarios con `prospeccion.view` pueden leer; inserts vía `prospeccion.create` o service_role.

### Lo que NO existe

- Audit log de cambios de estado (solo el estado final persiste en `prospeccion_prospects`).
- Visualización de historial de acciones en la UI.
- Exportación del audit log a CSV/PDF.

---

## 10. Trazabilidad

### Lo que existe hoy

- **`prospeccion_scores_current`** (vista): última puntuación vigente por prospecto con join a enrichment.
- **`prospeccion_crm_refs`**: mapea `prospect_id` → `crm_contact_id` en cada CRM con URL, versión y metadata.
- **`decision_trace` jsonb**: reconstruye completamente la lógica que produjo un score (factores, penalizaciones, versiones de modelo).
- **`model_version` / `icp_config_version` / `strategy_id` / `confidence_version`**: versionado del modelo para cada score histórico.
- **`source_event_id`**: referencia al evento de origen (cuando aplica).
- **`created_by`** en enrichment y scores: UUID del usuario o `NULL` para cálculos automáticos.

### Lo que NO existe

- Correlation ID end-to-end desde el CSV hasta Clientify (se registra por tabla, no como hilo único).
- Trazabilidad de cambios de campo específicos (delta tracking).
- Replay del pipeline de scoring desde un snapshot histórico.

---

*Inventario funcional al cierre de F2 · 2026-06-29 · TOPS NEXUS ERP*
