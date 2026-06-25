# BLUEPRINT CONSISTENCY REPORT
## Plataforma Comercial de Nexus — Prospección Inteligente
**Fecha:** 2026-06-25 | **Fase:** F0-PRE (cierre) | **Propósito:** validación positiva de consistencia — evidencia objetiva para autorizar F0

---

## 1. RESUMEN EJECUTIVO

**Índice Global de Consistencia de Arquitectura: 96.4 / 100** (umbral GO ≥ 95). **Dictamen: GO.**

El blueprint de la Plataforma Comercial de Nexus alcanza un estado de consistencia documental verificada tras **2 rondas adversariales** que no solo corrigieron residuos puntuales, sino que **endurecieron el linter determinístico** (de 23 a 26 checks) para atrapar mecánicamente el drift semántico que la revisión humana había detectado. El índice subió de **94.05 → 96.4**.

Lo que se logró tras las dos rondas adversariales:

- **Tabla fantasma erradicada.** `prospeccion_dead_letter` / `dead_letter` desaparecieron de todo el corpus (`grep` = CERO hits). La DLQ quedó uniformemente definida como un **estado lógico** (`status='dead'` de `prospeccion_events`), no una tabla física, de forma coherente en 40, 30 y 35.
- **Máquina de estados unificada.** El Event Storming (15 §15.4) y el DDD (20 §1.1) ahora describen **UNA sola máquina** (9 estados + `rejected` terminal), estructuralmente idéntica; `pending_approval` quedó colapsado en `ai_analyzed/con_ia` como rótulo UI/operativo (CC-7), ya no como estado-máquina.
- **Mis-cite de ADR corregido.** La cita de `45-security-rules.md:83` quedó anclada al Outbox (ADR-004), no a DDD (ADR-001).
- **Linter reforzado.** Se añadieron 3 checks nuevos —no-phantom-tables, state-machine-subset, adr-citation-semantics— que ahora cubren deterministicamente el drift hallado por la auditoría adversarial. Resultado: **26/26 PASAN**.

De las **18 relaciones** de la Consistency Matrix, **17 están CONSISTENTE** y **1 está PARCIAL** (DDD↔Event Storming) por un único residuo **cosmético de notación** (alias `sync_*` en prosa/Mermaid de §15.4) que **NO constituye divergencia de máquina** y **no bloquea** el cierre. **Cero críticos, cero contradicciones, refs válidas.**

---

## 2. DICTAMEN: **GO**

| # | Condición GO | Estado |
|---|--------------|:------:|
| 1 | Cero críticos | ✓ |
| 2 | Cero contradicciones entre artefactos | ✓ |
| 3 | DDL consistente (Canonical Model ↔ DDL) | ✓ |
| 4 | Roadmap consistente | ✓ |
| 5 | ADRs consistentes (ledger ↔ citas) | ✓ |
| 6 | Referencias cruzadas válidas | ✓ |
| 7 | Índice global ≥ 95 | ✓ (96.4) |

**Las 7 condiciones se cumplen. Veredicto: GO. Blockers restantes: ninguno.**

---

## 3. BLUEPRINT CONSISTENCY MATRIX (18 relaciones)

Las **7 relaciones antes-PARCIAL** (4 re-validadas en la corrida previa + las 3 re-validadas en esta corrida) se marcan **re-validadas → CONSISTENTE**, salvo DDD↔Event Storming que queda **PARCIAL** por residuo cosmético no bloqueante.

| # | Relación | Estado | Evidencia (resumen) | Resultado |
|---|----------|:------:|---------------------|-----------|
| 1 | **Canonical Model (40) ↔ DDL (35)** | **CONSISTENTE** (re-validada) | Ghost `prospeccion_dead_letter` = 0 hits en `_parts/`. DLQ = `status='dead'` uniforme en 40 R-7.6.4 (L301), 30 OB-10 (L163), 35 §1.1 (L60). `prospeccion_event_consumers` agregada al §1.1 (35:L62). Diff mecánico: único nombre fuera de catálogo = `prospeccion_outbox`, cubierto por CC-2 (05:L16-17) como alias-lógico normativo. | Residuo previo (tabla fantasma) totalmente resuelto. Sin nada que corregir. |
| 2 | **ADR ledger (55) ↔ Governance (50) + citas ADR-NNN** | **CONSISTENTE** (re-validada) | Fix verificado: `45:83` lee "El Outbox es append-only (ADR-004/OB-4)" → ADR-004 = "Event Bus = Outbox transaccional" (55:L29). Barrido de 56 citas: TODAS apuntan al ADR canónico (Outbox=004, outbound=006, cron=014, enum=011, AI=013, RLS=009, +008/002/012/015/019). 9 menciones de ADR-001 todas legítimas. | Fix puntual correcto y suficiente. Cero mis-cites. |
| 3 | **DDD máquina de estados (20 §1.1) ↔ Event Storming (15 §15.4)**, reconciliadas por CC-7 | **PARCIAL** (re-validada; residuo cosmético) | Residuo principal RESUELTO: 15 §15.4 (L272-282) = 9 filas idénticas a 20 §1.1 (L30-32); `pending_approval` ya NO es estado-máquina (rótulo UI/operativo, CC-7 en 05:L54/63, 20:L34, 15:L284). Split DEFINER/INVOKER idéntico. Residuo MENOR: prosa (L313, L326-327) y Mermaid (L433) de §15.4 usan alias `sync_*` mientras la nota al pie ¹ (L284) afirma "ya usa nombres canónicos". | Corrección estructural completa. No es divergencia de máquina; impide solo el CONSISTENTE estricto por inexactitud de notación auto-señalada. |
| 4 | RPC ↔ RLS | **CONSISTENTE** | Relación original consolidada. | Sin observaciones. |
| 5 | RLS ↔ Security | **CONSISTENTE** | Relación original consolidada. | Sin observaciones. |
| 6 | Security ↔ Governance | **CONSISTENTE** | Relación original consolidada. | Sin observaciones. |
| 7 | Roadmap ↔ DDL | **CONSISTENTE** | F0 = 5 tablas + 1 enum + 1 RPC (35:L176). | Sin observaciones. |
| 8 | Roadmap ↔ ADR | **CONSISTENTE** | Re-validada en corrida previa. | Sin observaciones. |
| 9 | CRM Sync ↔ Canonical | **CONSISTENTE** | Re-validada en corrida previa. | Sin observaciones. |
| 10 | AI ↔ Event Bus | **CONSISTENTE** | Relación original consolidada. | Sin observaciones. |
| 11 | Integraciones ↔ Canonical DTO | **CONSISTENTE** | Relación original consolidada. | Sin observaciones. |
| 12 | Event Storming ↔ Roadmap | **CONSISTENTE** | Re-validada en corrida previa. | Sin observaciones. |
| 13 | Roadmap ↔ DoD | **CONSISTENTE** | Relación original consolidada. | Sin observaciones. |
| 14 | DDD ↔ Bounded Contexts | **CONSISTENTE** | Relación original consolidada. | Sin observaciones. |
| 15 | DTOs ↔ RPC | **CONSISTENTE** | Relación original consolidada. | Sin observaciones. |
| 16 | Canonical ↔ DTOs | **CONSISTENTE** | Relación original consolidada. | Sin observaciones. |
| 17 | Event Catalog ↔ Event Bus | **CONSISTENTE** | Relación original consolidada. | Sin observaciones. |
| 18 | Event Bus ↔ Roadmap | **CONSISTENTE** | Capacidades Event Bus debutan en F2; Priority Lanes/Replay maduran F4-F7 (60:L198). | Secuenciación por riesgo explícita. |

**Tablero: 17/18 CONSISTENTE · 1/18 PARCIAL (cosmético, no bloqueante) · 0 contradicciones.**

---

## 4. CROSS-REFERENCE VALIDATION + BLUEPRINT BUILD SYSTEM

### 4.1 Linter determinístico (BB-5): **26/26 checks PASAN**

Los **3 checks NUEVOS** añadidos para cubrir el drift semántico hallado por la revisión adversarial:

| # | Check nuevo | Cubre | Resultado |
|---|-------------|-------|:---------:|
| 10 | **no-phantom-tables** | 20 identificadores `prospeccion_*` todos conocidos; 0 tablas fantasma (`dead_letter` eliminado) | PASA |
| 11 | **state-machine-subset** | Estados de 15 §15.4 ⊆ canónico CC-7; `pending_approval` ya no es estado-máquina | PASA |
| 12 | **adr-citation-semantics (OB↔Outbox)** | Citas `OB-*` apuntan a ADR-004/005 | PASA |

Checks pre-existentes (extracto): build-verification, adr-references-resolve (19 citados, todos definidos), adr-no-duplicate (19 únicos), 8 anti-drift en 0, ddl-events-index-columns-exist, mermaid balanceado, f0-table-count (5), parts-present (18).

### 4.2 Build-verification (BB-4)

- Consolidado `PLATAFORMA-COMERCIAL-NEXUS-ARQUITECTURA.md` (**4673 líneas**) == `cat(_parts)`.
- **parts-present = 18/18**.
- **f0-tables-created**: las 5 tablas F0 (sources, prospects, events, import_jobs, crm_refs) con `CREATE TABLE`; f0-table-count coherente ("5 tablas"×4, "4 tablas"×0).
- **mermaid-fences-balanced** (13 bloques, 88 fences pares).
- **ddl-events-index-columns-exist** (índices solo sobre 17 columnas reales).

### 4.3 Pipeline de build (BB-1..7) y tooling

- **CI determinístico (BB-6, pasos 1-4): VERDE.** Ejecutado por el validador, no asumido.
- Linter 26/26 y build-verification **corridos**, solo lectura/`grep` — coherente con F0-PRE documental, sin commit ni deploy.

---

## 5. ARCHITECTURE CONSISTENCY INDEX

> Comparativa: índice global **94.05 → 96.4**.

| Dimensión | Peso* | Score | Evidencia (resumen) | Causa de pérdida | Plan a máximo |
|-----------|:----:|:-----:|---------------------|------------------|---------------|
| **Estructural** | igual | **98** | build-verification verde; 18/18 parts; 5 tablas F0 con CREATE TABLE; mermaid 13 bloques/88 fences; índices sobre 17 cols reales. Linter 26/26 + CI verdes ejecutados. | Nodos Mermaid de 30 (L369, L415) y 20 (L226) etiquetan `[(prospeccion_outbox)]` sin anotación inline de CC-2 (cubiertos por override transversal; legibilidad aislada subóptima). | Anotar/renombrar labels `:::db` al físico `prospeccion_events` o agregar "prospeccion_outbox = prospeccion_events (CC-2)" en cada nodo. |
| **Semántica** | igual | **96** | Máquina reconciliada: 15 §15.4 (L272-282) = 9 filas idénticas a 20 §1.1 (L30-32); state-machine-subset confirma ⊆ CC-7; `pending_approval` = rótulo UI (05:L54/63, 20:L34, 15:L284). Split DEFINER/INVOKER idéntico. | Notación intra-§15.4: prosa (L313, L326-327) y Mermaid (L433) usan alias `sync_*` mientras la nota ¹ (L284) afirma "ya usa nombres canónicos". Alias válidos por CC-7; la nota over-reaches; el linter no atrapa prosa-vs-nota. | Reemplazar alias por canónicos largos (manteniendo `sync_failed` como manejo `*.failed` no-estado) o suavizar el claim; añadir check de linter prosa ⊆ {canónicos ∪ alias-CC7}. |
| **Documental** | igual | **96** | Ghost `dead_letter` erradicado (0 hits). DLQ = `status='dead'` en 40 (L301), 30 (L163), 35 (L60), 32 (L13/16/76). `prospeccion_event_consumers` en §1.1 (35:L62). Único nombre fuera de §1.1 = `prospeccion_outbox`, sancionado por CC-2 (05:L16-17). | 2 ocurrencias de `prospeccion_outbox` en Mermaid de 30 (L369, L415) sin aclaración inline CC-2; + residuo de notación `sync_*` de §15.4 (también documental). | Inline-anotar CC-2 en los nodos Mermaid; resolver el claim de la nota ¹ de §15.4 para que cada artefacto sea legible sin lectura cruzada. |
| **Fases** | igual | **97** | Roadmap↔DDL/ADR/DoD, EventStorming↔Roadmap, EventBus↔Roadmap todas CONSISTENTE. F0 = 5 tablas + 1 enum + 1 RPC (35:L176), pasos 1-2 del event storming (35:L88). `crm_refs` adelantada F1→F0 por ARB C-3 (vacía/read-only hasta F5, 35:L86). Dead Letter/lag/retry debutan F2; Priority Lanes/Replay maduran F4-F7 (60:L198). | Deuda DIFERIDA (no contradicción): EVT-5 Priority Lane sin columna de lane en el DDL (se infiere; worker no requerido F0-F5, 32:L9); compile real del DDL pre-G5 pendiente. | En F2/F4: materializar la columna/estructura de lane al incorporar worker dedicado y registrar la decisión; cerrar el compile del DDL en branch efímero de Supabase en G5. |
| **Modelo** | igual | **95** | Canonical (40) ↔ DDL (35) CONSISTENTE (4 archivos + 05 verificados). ER de 35 (L171): 5 entidades F0; prospects→events lógica por aggregate_id sin FK física (correcto para Outbox append-only); crm_refs con FK física on delete cascade. DLQ como estado del enum (check incluye 'dead' 35:L343; tipo TS L819). | Deuda DIFERIDA: DDL no compilado contra Postgres (branch Supabase pre-G5 pendiente) — consistencia documental/estática, no validada por motor. Doble esquema `prospeccion_outbox`: §2.2 (0089) vinculante vs boceto 30 §15.3 (0088) conceptual (nota de prevalencia 30:L145). | Compilar DDL (0089 + índices + RLS + RPC) en branch efímero pre-G5 y correr generate_typescript_types para confirmar paridad Row↔DDL; eleva el modelo a "consistente verificado" (98-99). |
| **Gobierno** | igual | **97** | ADR ledger ↔ Governance CONSISTENTE: `45:L83` ahora ADR-004 (ledger L29), ya no ADR-001/DDD. 9 ocurrencias de ADR-001 legítimas. Linter: adr-references-resolve (19), adr-no-duplicate (19 únicos), adr-citation-semantics OB↔Outbox; 8 anti-drift en 0. Fuente única de ADRs en 55 (MTD-02 cerrada). | Deuda DIFERIDA: gobernanza verificada por grep/linter estático (solo lectura, coherente con F0-PRE); gates operativos (G5 compile, branch Supabase) pendientes; falta check de prosa-vs-claim (caso §15.4). | Añadir al linter el check de notación de §15.4 (prosa/Mermaid ⊆ canónicos∪alias-CC7 + verificar exactitud de la nota ¹); ejecutar gates G5 a su tiempo. |

*Los pesos relativos por dimensión no fueron provistos en la evidencia; el índice global reportado es el agregado del validador.

**Índice Global de Arquitectura: 96.4 / 100** (vs. 94.05 previo, **+2.35**). Todas las dimensiones ≥ 95.

---

## 6. CRITERIO DE SALIDA F0-PRE / AUTORIZACIÓN DE F0

| # | Condición de salida F0-PRE | Estado |
|---|----------------------------|:------:|
| 1 | Cero críticos | ✓ CUMPLE |
| 2 | Cero contradicciones entre artefactos | ✓ CUMPLE |
| 3 | DDL consistente (Canonical ↔ DDL) | ✓ CUMPLE |
| 4 | Roadmap consistente | ✓ CUMPLE |
| 5 | ADRs consistentes | ✓ CUMPLE |
| 6 | Referencias cruzadas válidas | ✓ CUMPLE |
| 7 | Índice global ≥ 95 (= 96.4) | ✓ CUMPLE |

**Conclusión:** se cumplen las **7 condiciones** de salida de F0-PRE. El blueprint está **autorizado para abrir F0**. La única relación PARCIAL (DDD↔Event Storming) es un residuo **cosmético de notación** que no afecta la máquina de estados ni introduce contradicción, por lo que **no bloquea** el cierre.

**Nota honesta (alcance de la validación):** esta verificación fue **estática/documental** (lectura + `grep` + linter determinístico), sin commit ni deploy, coherente con la naturaleza de F0-PRE.
- El **compile real del DDL** (0089: tablas + índices + RLS + RPC `prospeccion_ingest`) contra un Postgres en **branch efímero de Supabase corresponde a pre-G5 y requiere autorización expresa** — hoy la consistencia DDL es documental, no validada por el motor. No es una contradicción entre artefactos: es deuda de validación diferida.
- Las **migraciones se aplican a mano en G3** (gobernanza de TOPS Nexus): el blueprint no autoriza por sí mismo escritura en producción.

---

## 7. PLAN PARA ALCANZAR EL MÁXIMO NIVEL

### Plan por dimensión (plan_to_max consolidado)
1. **Estructural (98→100):** anotar/renombrar los labels `:::db` de los Mermaid de 30 (L369, L415) y 20 (L226) al físico `prospeccion_events`, o agregar "prospeccion_outbox = prospeccion_events (CC-2)" en cada nodo, para que cada diagrama sea autoexplicativo sin depender del override transversal.
2. **Semántica (96→máx):** alinear §15.4 — reemplazar alias `sync_*` de prosa+Mermaid por los canónicos largos (manteniendo `sync_failed` como manejo `*.failed` no-estado) **o** suavizar el claim de la nota ¹ a "la TABLA usa nombres canónicos; la prosa cita alias según CC-7"; **añadir un check de linter de notación** (prosa de §15.4 ⊆ {canónicos} ∪ {alias-CC7}) para cerrar el gap mecánicamente.
3. **Documental (96→máx):** inline-anotar CC-2 en los nodos Mermaid que citan `prospeccion_outbox` y resolver el claim de la nota ¹ de §15.4, dejando cada artefacto legible sin lectura cruzada de la convención.
4. **Fases (97→máx):** al entrar F2/F4, materializar la columna/estructura de lane que EVT-5 requiere cuando se incorpore el worker dedicado y registrar la decisión en el roadmap; cerrar el compile del DDL en el branch efímero de Supabase en G5.
5. **Modelo (95→98-99):** compilar el DDL completo (0089 + índices + RLS + RPC) en un branch efímero pre-G5 y correr `generate_typescript_types` para confirmar paridad Row-type↔DDL contra el motor.
6. **Gobierno (97→máx):** añadir al linter el check de prosa-vs-claim de §15.4 para atrapar deterministicamente el único residuo cosmético; ejecutar los gates G5 a su tiempo para convertir la gobernanza documental en operativa.

### Deuda diferida registrada (NO bloqueante, NO contradicción)
- **Compile real del DDL** (0089: tablas + índices + RLS + RPC `prospeccion_ingest`) contra Postgres en branch efímero de Supabase pre-G5. Hoy la consistencia DDL es estática/documental.
- **EVT-5 Priority Lanes:** la lane se infiere (cron por lane); no existe columna/estructura de lane dedicada en el DDL; worker no requerido F0-F5 (32:L9). Materializar al entrar el worker en F2/F4.
- **Residuo cosmético (DDD↔Event Storming):** prosa de 15 §15.4 (L313, L326-327) y Mermaid (L433) usan alias `sync_*` mientras la nota ¹ (L284) afirma "ya usa nombres canónicos". Alias válidos por CC-7; máquina idéntica (9+rejected). Alinear notación o suavizar el claim; idealmente añadir check de linter prosa-vs-claim.
- **Labels Mermaid `prospeccion_outbox`** en 30 (L369, L415) y 20 (L226) sin anotación inline de CC-2 (cubiertos por override transversal). Mejora de legibilidad opcional.
- **Doble esquema del Outbox:** boceto conceptual 30 §15.3 (migración 0088) vs definición vinculante Persistencia §2.2 (migración 0089); convivencia correcta con nota de prevalencia (30:L145), requiere leerla para no confundir la migración portadora.

---

## 8. PRÓXIMO PASO

**Dictamen = GO** → el blueprint pasa a **ratificación en G7** para la **autorización formal de apertura de F0**.

Secuencia recomendada:
1. **Ratificación G7** del dictamen GO (índice 96.4, 7/7 condiciones, 0 críticos, 0 contradicciones).
2. **Autorización de F0** una vez ratificado.
3. En la **ventana de F0/pre-G5**: solicitar autorización para el **compile real del DDL** en branch efímero de Supabase (convierte la consistencia documental del modelo en consistencia verificada por motor).
4. Tratar los residuos cosméticos (notación §15.4 + labels Mermaid CC-2) como **mejoras opcionales** dentro de F0; no son condición de apertura.

> Recordatorio de gobernanza: las migraciones se aplican a mano en **G3**; el compile del DDL en **branch efímero** es **pre-G5 con autorización**. Nada de esto bloquea la autorización de F0.

---

## 9. ADENDA DE CIERRE — último residuo cosmético resuelto (post-índice, 2026-06-25)

> El índice **96.4 / GO** se calculó con la relación **DDD↔Event Storming** aún en **PARCIAL** por un residuo **cosmético de notación** (la nota ¹ de `15` §15.4 afirmaba "ya usa nombres canónicos" mientras prosa/Mermaid de esa sección usaban alias cortos `sync_*`). **Inmediatamente después se cerró ese residuo:**

- `15` §15.4: prosa (L313, L326-327) y Mermaid (L433) alineados a notación canónica — `sync_requested`→`crm_sync_requested`, `sync_completed`→`crm_sync_completed`, `sync_failed`→ evento `crm.sync.failed` (manejo `*.failed`, no estado). Verificación: `grep -rE "\bsync_(failed|requested|completed)\b" _parts/ | grep -v crm_sync` = **0 alias cortos sueltos**.
- Rebuild + linter: **26/26 checks PASAN** (build-verification, state-machine-subset, no-phantom-tables, adr-citation-semantics, …).

**Estado final de la Consistency Matrix: 18/18 CONSISTENTE · 0 PARCIAL · 0 INCONSISTENTE.** El dictamen **GO (Index 96.4)** queda **reforzado** (la corrección solo eleva las dimensiones Semántica/Documental; no las baja). Los ítems de §7 que permanecen son **deuda diferida explícita** (compile real del DDL pre-G5; columna de lane EVT-5 en F2/F4; anotación inline CC-2 en labels Mermaid) — **ninguno es contradicción entre artefactos ni bloquea la apertura de F0**.
