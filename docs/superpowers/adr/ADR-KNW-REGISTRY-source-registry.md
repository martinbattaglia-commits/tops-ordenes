# ADR-KNW-REGISTRY — Source Registry de Fuentes de Conocimiento

**Estado:** APROBADO por Dirección (Martín Battaglia, 2026-06-28)

---

## Contexto

El Knowledge Layer debe proyectar eventos de múltiples fuentes (`audit_log`, `recon_events`, `purchase_orders`, staging CRM, contratos, compliance, tracking, connect) hacia el read-model `knowledge_events`. El sistema necesita un mecanismo para:

1. Saber qué fuentes existen y están habilitadas, **sin** codificar esa lógica dentro del pipeline.
2. Activar o desactivar una fuente **sin** modificar el emisor, las vistas ni los adaptadores existentes.
3. Registrar metadata operativa por fuente (`last_backfill_at`, `visibility_mode`, `notes`).

Sin un registro centralizado, el pipeline acumularía lógica condicional por fuente (`if audit / if crm / case por source_table`) que viola OCP y hace al sistema frágil ante la suma de fuentes nuevas.

---

## Decisión

La tabla `public.knowledge_sources` es el **registro oficial de fuentes** (Source Registry). Todo lo relativo a qué fuentes existen y están activas se resuelve consultando esta tabla. El pipeline **depende únicamente del registro**, no conoce los adaptadores.

### Columnas relevantes (DDL en `0107_knowledge_core.sql`, líneas 212-220)

| Columna | Tipo | Descripción |
|---|---|---|
| `source_table` | `text NOT NULL UNIQUE` | Clave única de la fuente; es la misma que el adaptador pasa como `source_table` al emisor. |
| `enabled` | `boolean NOT NULL DEFAULT true` | Gate de proyección: el adaptador consulta su fila y aborta si `enabled = false`. |
| `last_backfill_at` | `timestamptz` | Marca de última ejecución exitosa del backfill; actualizada por `knowledge_backfill_<source>`. |
| `visibility_mode` | `text` | Hint de visibilidad por fuente para uso del helper `knowledge_visibility_for`. |
| `notes` | `text` | Documentación operativa libre. |

### Regla dura: sin condicionales por fuente en el pipeline

`knowledge_emit_event` y las vistas `v_knowledge_*` **NO contienen lógica condicional por `source_table`**. Está prohibido incluir `IF source_table = 'audit_log' THEN ...`, `CASE WHEN source_table = 'crm' ...`, o cualquier ramificación equivalente dentro del emisor o las vistas. Cada adaptador resuelve su propia lógica de mapeo y pasa su `source_table` como dato al emisor genérico.

### Flujo de gate por fuente

```
project_<source>() {
  select enabled from knowledge_sources where source_table = '<source>';
  if not found or enabled = false → return null (sin error);
  ...construye knowledge_event_canonical...
  → llama knowledge_emit_event(evento);
}
```

### Propagación de correlation_id

Se propaga vía GUC de sesión `knowledge.correlation_id`. La aplicación lo setea con `set_config('knowledge.correlation_id', <valor>, true)` al inicio de una operación trazada. El emisor, el backfill y el trigger lo leen con `current_setting('knowledge.correlation_id', true)` (segundo parámetro `true` = sin error si no existe). `NULL` es aceptado cuando no hay origen trazado. El GUC es local a la transacción (tercer parámetro `true` en `set_config`).

### Registro de una fuente nueva

Registrar la fuente `X` en el registry = ejecutar el siguiente DML **idempotente**:

```sql
insert into public.knowledge_sources (source_table, enabled, notes)
values ('X', true, 'Descripción de la fuente')
on conflict (source_table) do nothing;
```

Esto **no modifica** el DDL de `knowledge_sources`, no toca el emisor, no toca las vistas ni los adaptadores existentes.

---

## Consecuencias

### Positivas

- **OCP aplicado al pipeline:** el emisor y las vistas permanecen cerrados a modificación cuando se suma una fuente. El sistema se abre únicamente mediante un adaptador nuevo + una fila en el registry.
- **Gate operativo centralizado:** deshabilitar una fuente en producción (ej. durante mantenimiento o incident) = `UPDATE knowledge_sources SET enabled = false WHERE source_table = 'audit_log'`. Sin deploys, sin rollbacks de código.
- **Observabilidad del catálogo:** `last_backfill_at` permite monitorear qué fuentes están al día sin consultar `knowledge_events` directamente.
- **Descubrimiento de fuentes:** herramientas, dashboards y futuros workers pueden obtener la lista de fuentes activas con un simple `SELECT` sobre `knowledge_sources`, sin reflexión en código de aplicación.

### Negativas

- Los adaptadores tienen una dependencia de datos en `knowledge_sources` (deben existir sus filas antes de correr). Mitigación: el INSERT idempotente de la fila se incluye en la misma migración que crea el adaptador (`0109` para `audit_log`).
- Una fila `enabled = false` silencia la proyección sin error visible. Mitigación: el adaptador registra un evento técnico EOL al detectar `enabled = false` (canal separado, no `knowledge_events`).

---

## Alternativas consideradas (y por qué se descartan)

### Alternativa A: Condicionales por fuente en el emisor

`knowledge_emit_event` contiene `IF source_table = 'audit_log' THEN ... ELSIF source_table = 'recon_events' THEN ...`. El registry solo existe como documentación.

**Descartada.** Viola OCP: agregar una fuente requiere modificar el emisor. La lógica condicional crece con cada fuente. El emisor pierde su carácter agnóstico.

### Alternativa B: Enum de fuentes conocidas (PostgreSQL ENUM type)

Las fuentes válidas se definen como un tipo ENUM. `knowledge_sources` solo valida que `source_table` sea un valor del enum.

**Descartada.** Agregar una fuente nueva requiere `ALTER TYPE` (DDL), que en Postgres no es transaccional y puede bloquear. El registro declarativo con `text UNIQUE` logra el mismo nivel de validez sin restricciones de DDL.

### Alternativa C: Dispatch dinámico (orquestador genérico que itera el registry)

Un proceso itera `SELECT source_table FROM knowledge_sources WHERE enabled = true` y llama dinámicamente al adaptador correspondiente (`EXECUTE format('SELECT project_%s()', source_table)`).

**Descartada.** Prohibido explícitamente en F0.5.1 (límite duro de Dirección). Introduce reflexión, SQL dinámico, superficie de inyección, y dificulta el análisis estático y la auditoría de permisos. La extensibilidad se logra con OCP estructural (un adaptador por fuente), no con dispatch dinámico.

---

## Alcance F0.5.1

En F0.5.1 se registra **únicamente la fila `'audit_log'`** en `knowledge_sources` (INSERT idempotente en la migración `0109`). Las filas de las fuentes futuras (recon, orders, CRM, compliance, tracking, connect) se registrarán en sus fases correspondientes (F0.5.2+), junto con la implementación de sus adaptadores.

**Prohibido en F0.5.1:** reflexión, carga dinámica, dispatch dinámico que arme el nombre del adaptador, orquestador genérico que itere el registry.

---

## Relación

- **ADR-KNW-ADAPTER** — define cómo cada adaptador consulta su fila en el registry (gate `enabled`) y enruta por el emisor. Es la contraparte de ejecución de este ADR.
- **ADR-KNW-CONTRACT** — define el contrato canónico `knowledge_event_canonical` que pasa entre adaptadores y emisor. El registry no participa en la transformación: solo registra y resuelve fuentes.
- **D12** — el Source Registry es el mecanismo que permite al pipeline definido en D12 mantenerse agnóstico de las fuentes.
- **ADR-ENG-1** — los eventos técnicos EOL de activación/desactivación de fuentes (`KnowledgeProjection*`) se emiten desde los adaptadores al detectar el estado del registry (canal separado, nunca en `knowledge_events`).
