# TOPS NEXUS — INFRASTRUCTURE DECISION REPORT (Entregable 1 · Fase C)

> **Estado:** análisis de decisión · **Fecha:** 2026-05-29
> Compara **Docker Local** vs **Supabase Staging aislado** como entorno para
> ejecutar **GATE 2** (validación de `0010` y, encadenado, `0011`) sin tocar
> producción. **No implementa nada.** Fuente de verdad:
> [ERP-FASE3-AUDITORIA-REPOSITORIO.md](./ERP-FASE3-AUDITORIA-REPOSITORIO.md) ·
> [ERP-FASE2-GATE2-STAGING-VALIDATION.md](./ERP-FASE2-GATE2-STAGING-VALIDATION.md).

---

## 0. Diagnóstico del entorno (verificado hoy, no asumido)

| Componente | Estado verificado | Comando / evidencia |
|------------|-------------------|---------------------|
| Docker | ❌ **no instalado** | `command -v docker` → vacío |
| `psql` | ❌ **no instalado** | `command -v psql` → vacío |
| Supabase CLI | ✅ **2.101.0** | `supabase --version` |
| `supabase/config.toml` | ❌ **no existe** | `ls supabase/config.toml` → no existe (nunca se hizo `supabase init`) |
| Link CLI | ⚠️ **apuntando a PRODUCCIÓN** | `supabase/.temp/project-ref` = `arsksytgdnzukbmfgkju` |
| Estado de migraciones (LIVE, read-only) | **0001–0009 aplicadas; 0010 y 0011 NO** | `supabase migration list` (ver abajo) |

```
   Local | Remote
   0001..0009  | 0001..0009     ← aplicadas en prod
   0010        | (vacío)        ← NO aplicada
   0011        | (vacío)        ← NO aplicada
```

> **Consecuencia:** GATE 2 (validar `0010` aplicándola en un entorno aislado) está
> **bloqueado hoy** por dos motivos: no hay Docker (Opción A) y no hay un proyecto
> staging creado (Opción B). El link a PROD agrega un riesgo operativo a mitigar.

---

## 1. Comparación (7 ejes)

| Eje | Opción A — Docker Local (`supabase start`) | Opción B — Supabase Staging aislado (proyecto cloud nuevo) |
|-----|--------------------------------------------|-------------------------------------------------------------|
| **Costo** | ✅ **$0** (recursos de la Mac) | 🟡 **$/mes**: free tier limitado (pausa por inactividad, 500 MB DB, storage acotado); para fidelidad real → Pro (~USD 25/mes/proyecto) |
| **Complejidad** | 🟡 media: instalar Docker Desktop + `supabase init` (crea `config.toml`) + `supabase start` (levanta ~7 contenedores: postgres, gotrue, postgrest, storage, kong, studio, realtime) | 🟢 baja-media: crear proyecto en dashboard, **re-linkear** CLI al ref staging, `supabase db push` al staging |
| **Tiempo** | 🟡 setup inicial 30–60 min (instalar Docker + primer pull de imágenes); luego iteración rápida y offline | 🟢 provisioning ~5 min; push de migraciones en minutos; requiere red |
| **Riesgo a producción** | 🟢 **nulo** (100% aislado, local, sin red a prod) | 🟡 **bajo pero real**: la CLI **hoy apunta a PROD**; un `db push` sin re-linkear correctamente impactaría producción → mitigable con verificación explícita de ref |
| **Fidelidad vs producción** | 🟡 **alta en schema/RLS/funciones** (mismo Postgres + mismas imágenes Supabase), pero storage = backend local (no S3 real), sin datos de prod salvo seed manual | 🟢 **máxima**: misma plataforma gestionada que prod (igual versión PG, **storage S3 real**, Auth/GoTrue, pooler, motor RLS); admite **restaurar un backup de prod** para datos/volumen reales |
| **Facilidad de rollback** | 🟢 trivial: `supabase db reset` / `supabase stop` / borrar contenedores; cero efecto en prod | 🟢 trivial: `supabase db reset` sobre staging o **borrar el proyecto**; cero efecto en prod (si el link es correcto) |
| **Mantenimiento** | 🟡 upkeep de Docker + imágenes que cambian con la CLI; consumo de disco/CPU local | 🟡 un segundo proyecto cloud a mantener sincronizado + costos recurrentes + gestión de secretos |

---

## 2. Lo que GATE 2 realmente ejercita (define la fidelidad necesaria)

La batería de GATE 2 (de `ERP-FASE2-GATE2-STAGING-VALIDATION.md` §5) prueba
exactamente las capas donde **Docker Local y Supabase difieren**:

| Capítulo de la batería | ¿Sensible a la plataforma? | Implicancia |
|------------------------|:--------------------------:|-------------|
| Versionado / audit / soft-delete (triggers PL/pgSQL) | ❌ idéntico en ambos | Docker suficiente |
| RLS multi-tenant A/B/C (`current_role()`, policies) | ❌ idéntico | Docker suficiente |
| **Signed URLs + storage privado + aislamiento por `split_part(name,'/',1)`** | ✅ **difiere** | Staging (S3 real) es materialmente más fiel |
| **OCR / OpenAI (red)** | ✅ difiere | Staging tiene salida de red estándar; Docker requiere config |
| **Performance 100/500/1000/5000 docs** | ✅ difiere | Staging con backup de prod = números realistas; Docker = hardware local |
| Rollback de migración | ❌ idéntico | ambos sirven |

> **Conclusión técnica:** las partes críticas de GATE 2 que **no** se validan bien
> en local son justamente las de `0010`: **storage privado, signed URLs y
> aislamiento multi-tenant de archivos**. Ahí Supabase Staging gana por fidelidad.

---

## 3. Criterio rector — ¿acerca a reemplazar Neuralsoft?

| Opción | ¿Acerca a reemplazar Neuralsoft? | Veredicto |
|--------|----------------------------------|-----------|
| Docker Local | **SÍ** — harness de validación barato para schema/lógica; permite probar 0010→0011→0012 antes de prod | Documentar (fallback válido) |
| Supabase Staging | **SÍ (más)** — valida en la **misma plataforma** que correrá el ERP financiero (storage/Auth/pooler/RLS reales); permite ensayar con datos/volumen de prod | Documentar (recomendado) |

Ninguna se descarta: ambas suman. La diferencia es **grado de fidelidad** vs **costo**.

---

## 4. Recomendación fundamentada

**Recomendación primaria: Opción B — Supabase Staging aislado**, condicionada a
autorización de gasto cloud.

**Por qué:**
1. **Fidelidad máxima donde importa:** GATE 2 valida storage privado, signed URLs
   y aislamiento multi-tenant de `0010` — capas que solo se ensayan fielmente en
   la plataforma gestionada (S3 real, no el storage local de Docker).
2. **No requiere instalar Docker** (el bloqueo actual de infraestructura).
3. **Datos y volumen realistas:** se puede restaurar un backup de prod al staging
   para correr la performance 100/500/1000/5000 docs con números representativos.
4. **Rollback trivial y aislamiento total** del entorno productivo (reset o borrar
   proyecto).

**Riesgo a mitigar (único relevante):** la CLI **hoy apunta a PROD**. El plan de
ejecución (Entregable 2) **debe** incluir, como prerrequisito bloqueante,
re-linkear al ref del staging y **verificar el ref impreso** antes de cualquier
`db push`, además de la regla permanente "prohibido `db push` contra
`arsksytgdnzukbmfgkju`".

**Fallback (si NO se autoriza gasto cloud): Opción A — Docker Local.** Cubre el
~70% de la batería (schema/RLS/triggers/rollback) a costo $0. Aceptable para una
primera pasada de validación lógica; insuficiente por sí sola para certificar la
capa de storage/performance con fidelidad de producción.

| Escenario | Decisión |
|-----------|----------|
| Hay presupuesto cloud (≈USD 25/mes temporal) | **Opción B** (Staging) |
| No hay presupuesto, o se quiere una pasada lógica rápida primero | **Opción A** (Docker) como paso previo, luego B para certificar storage/perf |

> **No se implementa nada en esta fase.** Esta recomendación alimenta el GO/NO-GO
> (Entregable 6). La elección final del entorno es **decisión ejecutiva** del
> usuario; este informe la deja fundamentada y lista.
