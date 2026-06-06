# CRM_F2_1_4_CAPACITY_HOOK — Activación del hook de capacidad

**Fase:** F2.1-4 · **Rama:** `feature/crm-comercial-f2-1` · **Fecha:** 2026-06-06
**Objetivo:** activar el hook de capacidad conectando `crm_opportunities` ↔ `corporate-capacity`, habilitando **vacancia comercial** y **vacancia proyectada**.
**Sin main · sin Netlify · sin deploy · sin producción.**

---

## 1. Diseño técnico

### 1.1 Principio
El motor `corporate-capacity.ts` sigue siendo **PURO** (no accede a Supabase). Recibe un `CommittedSnapshot` por parámetro. Un módulo aparte (`committed-capacity.ts`) construye ese snapshot desde `crm_opportunities`. Así la matemática es 100% testeable y el motor no se acopla a la base.

### 1.2 Mapeo y reglas
- **service_type → categoría:** `anmat→anmat`, `general→general`, `oficinas→oficina`.
- **committed_state → bucket:**
  - `reservado` → **reservedM2** (propuesta/negociación).
  - `comprometido` → **committedM2** (ganado no onboardeado).
  - `ocupado` → **NO se cuenta** (su m² ya vive en la ocupación física del Digital Twin) — **regla anti-doble-conteo**.
  - `none` → ignorado.
- Solo oportunidades con `assigned_site` y `m2`, **no borradas** (`deleted_at is null`), **estado ≠ 'perdido'**.

### 1.3 Fórmulas
```
disponible_físico       = comercializable − ocupado
disponible_comercial    = disponible_físico − comprometido
disponible_proyectado   = disponible_comercial − reservado
vacancia_física %       = disponible_físico    / comercializable
vacancia_comercial %    = disponible_comercial / comercializable
vacancia_proyectada %   = disponible_proyectado/ comercializable
```

### 1.4 Activación segura
`COMMITTED_M2_ENABLED = true`. **Sin snapshot (default `{}`)** → reservado=comprometido=0 → comercial = proyectada = **física**. Encender el hook sin datos CRM **no cambia nada** (no-op). El dashboard ya lo refleja con el texto "activación segura".

### 1.5 Limitación documentada (anti-doble-conteo)
Una oportunidad recién onboardeada (`ocupado`) sale del committed del CRM, pero su m² solo aparece en "ocupado físico" cuando el **Digital Twin** (relevamiento) se actualiza. Hasta que se implemente la escritura de ocupación física al onboardear (decisión F-4, diferida), puede existir una ventana en la que ese m² no esté en ningún lado. Es conservador (no infla disponibilidad) y se cierra con F-4.

---

## 2. Implementación

| Archivo | Cambio |
|---|---|
| `src/lib/wms/corporate-capacity.ts` | `COMMITTED_M2_ENABLED=true`; `CommittedSnapshot`/`CommittedAmounts`; `reservedM2` en `CategoryCapacity`; `committedFor(cat,site,snapshot)`; totales con reservado/comprometido/comercial/proyectada; selectores aceptan snapshot; `findAvailability` con `basis: fisica\|comercial\|proyectada`. **Backward-compatible** (todos los exports y firmas previas siguen, snapshot opcional). |
| `src/lib/comercial/committed-capacity.ts` | **nuevo** — `getCommittedSnapshot()` lee `crm_opportunities` y arma el snapshot (resiliente: `{}` si no hay tabla/Supabase). |
| `src/app/(app)/comercial/dashboard-vacancia/page.tsx` | server `async` → `getCommittedSnapshot()` → prop al view; `force-dynamic`. |
| `src/app/(app)/comercial/dashboard-vacancia/DashboardVacanciaView.tsx` | recibe `committed`; sección **"1b · Vacancia física/comercial/proyectada"** + nota de compromisos CRM. |

---

## 3. QA

| Prueba | Resultado |
|---|---|
| Motor — sin snapshot (backward-compat) | ✅ comercial=proyectada=física=3.770 m² (37,5%), `hasCommitments=false` |
| Motor — con snapshot sintético | ✅ comercial 3.150 (3.770−620), proyectada 2.940 (−210); ANMAT comercial 408 (508−100) |
| Motor — anti-doble-conteo | ✅ `ocupado` no pasa al motor → no descuenta |
| Integración staging — `getCommittedSnapshot` query | ✅ 3 filas (excluye ocupado/perdido/sin-sede), snapshot correcto, **rollback** (sin residuos) |
| `findAvailability` basis comercial | ✅ CG física 3.212 → comercial 2.712 (−500) |
| `npx tsc --noEmit` | ✅ exit 0 |
| `npx next lint` | ✅ sin errores |
| `npm run build` | ✅ Compiled successfully · `/comercial/dashboard-vacancia` 5,98 kB |

> Nota build: una corrida intermedia falló por caché `.next` stale en `/api/orders/export` (ajeno a este cambio); se auto-sanó al regenerar `.next`.

---

## 4. Evidencia (números reales)

**Motor con snapshot sintético** `{Luján: general(r100,c500), anmat(c100); Magaldi: oficina(r10,c20)}`:
- reservado **210** · comprometido **620**
- disponible físico **3.770** → comercial **3.150 (31,3%)** → proyectada **2.940 (29,3%)**

**Integración staging** (oportunidades de prueba, rolled back):
```
3 filas consideradas (excluye ocupado, perdido, sin-sede)
snapshot: { PEDRO_LUJAN_3159: { general: { reservedM2:100, committedM2:300 } },
            MAGALDI_1765:     { oficina: { committedM2:20 } } }
RESULTADO: PASS ✅
```

---

## 5. Impacto en el dashboard corporativo

- Nueva sección **"1b · Vacancia: física · comercial · proyectada"** (3 bandas con m² disponibles + %), alimentada por el `CommittedSnapshot` que el server fetchea de `crm_opportunities`.
- **Hoy (sin compromisos CRM cargados):** comercial = proyectada = física = **3.770 m² / 37,5%** → el dashboard se ve igual que antes + las 3 bandas, con la nota "activación segura del hook, sin impacto".
- **Cuando el CRM tenga oportunidades** en `reservado`/`comprometido`, el dashboard mostrará automáticamente la **vacancia comercial** (lo realmente vendible hoy) y la **proyectada** (descontando reservas), por categoría y consolidado.
- El resto del dashboard (resumen, categorías, racks, coworking, comparativa por sede, matching) **intacto**; el motor es backward-compatible.

---

## 6. Estado

✅ Hook activo · motor + snapshot + dashboard implementados y validados (unit + integración staging + build). **Sin merge · sin main · sin Netlify · sin deploy.** Producción intacta.

**Próximo:** conectar el CRM real (UI de oportunidades F2.1-6) poblará el snapshot y el dashboard reflejará vacancia comercial/proyectada con datos vivos.
