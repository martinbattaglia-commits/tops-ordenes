# TOPS NEXUS — ARCA IMPLEMENTATION REPORT (FASE E3)

> **Estado:** ✅ **ProductionArcaService IMPLEMENTADO (NOT_READY eliminado) — credential-gated**
> **Fecha:** 2026-05-29 · **Rama:** `feature/arca-production-fase-e` (aislada, sin merge a `main`)
> **Producción fiscal:** ❌ **deshabilitada** · **Sandbox:** ✅ preservado · **Certificados productivos:** ❌ no usados

---

## 0. Objetivo de E3 (recordatorio)

> Transformar `ProductionArcaService = NOT_READY` en `ProductionArcaService = READY`
> **sin habilitar facturación productiva**. Preservar Sandbox. Incorporar Feature Flag,
> Fallback a Sandbox, Logging y Audit. Regla rectora: *¿esto acerca a emitir comprobantes
> fiscales reales de forma segura y auditada?* → **SÍ** (implementar + documentar).

**Definición operativa de READY (de E2 §11):** código completo + compila + *credential-gated*
(ConfigError si faltan cert/clave, **jamás** un CAE falso) + Mock/SANDBOX intacto + feature
flag/fallback/logging/audit presentes. **READY ≠ emitir en producción.**

---

## 1. Qué se implementó (módulos nuevos / reescritos)

| Archivo | Estado | Rol |
|---------|--------|-----|
| `src/lib/arca/logger.ts` | **nuevo** | Logging estructurado del subsistema ARCA. `maskSecret()` nunca expone Token/Sign/clave. |
| `src/lib/arca/soap.ts` | **nuevo** | Helper SOAP sin dependencias: `soapPost` (timeout + retries exp. para 5xx/red), detección de SOAP Fault, `extractTag`/`extractAllTags`, `escapeXml`/`unescapeXml`. |
| `src/lib/arca/wsaa.ts` | **nuevo** | Cliente WSAA: arma TRA, firma CMS/PKCS#7 (firmador inyectable; default `openssl` del host), `LoginCms`, parseo Token/Sign/expiración, **cache de TA con margen + de-dup de login concurrente**. |
| `src/lib/arca/wsfev1.ts` | **nuevo** | Cliente WSFEv1: `FEDummy`, `FECompUltimoAutorizado`, `FECAESolicitar`. Serializa el request (IVA/Tributos/CbtesAsoc) y parsea cabecera/detalle/Errors/Events/Observaciones 1:1 con `./types`. |
| `src/lib/arca/production-service.ts` | **reescrito** | Orquesta WSAA + WSFEv1, implementa `IArcaService`. `ArcaConfigError` si faltan credenciales. Reintento ante TA expirado. Feature flag + fallback. Logging/audit. **`NOT_READY` eliminado.** |
| `src/lib/env.ts` | **extendido** | `arca.cuit`, `arca.taMarginSeconds` (default 600), `arca.allowMockFallback` (`ARCA_ALLOW_MOCK_FALLBACK=1`), flags de override de URL por ambiente. |
| `src/lib/arca/service.ts` | **sin cambios** | El factory sigue llamando `new ProductionArcaService(ambiente)` (el constructor acepta string **o** config). |
| `src/lib/arca/mock-service.ts` | **sin cambios** | **Sandbox intacto** (requisito absoluto). |
| `src/lib/invoicing/emit.ts` | **sin cambios** | Flujo de emisión NO tocado (requisito absoluto). |

---

## 2. Flujo implementado (end-to-end)

```
emitInvoice()  ─►  getArcaService(ambiente)
                        │  SANDBOX        → MockArcaService            (sin cambios)
                        │  HOMOLOGACION   → ProductionArcaService
                        │  PRODUCCION     → ProductionArcaService
                        ▼
              ProductionArcaService
                 ├─ requireReady()  ──► sin cert/clave → ArcaConfigError
                 │                       (PRODUCCION: SIEMPRE; HOMOLOG: salvo flag)
                 ├─ getAuth()  ──► WsaaClient.getTicket()
                 │                   ├─ cache válido? → reusa TA
                 │                   ├─ inflight? → de-dup
                 │                   └─ login(): buildTra → openssl CMS → LoginCms → TA
                 ├─ ultimoComprobanteAutorizado() → Wsfev1.ultimoAutorizado(Auth,…)
                 └─ solicitarCAE() → Wsfev1.solicitarCAE(Auth, req)
                       └─ on AuthError (cód. 6xx/token expirado) → invalidate() + retry×1
```

---

## 3. Requisitos de E3 — cumplimiento

| Requisito | Estado | Evidencia |
|-----------|--------|-----------|
| **Eliminar `NOT_READY`** | ✅ | `production-service.ts` ya no lanza el stub; implementa el flujo real. |
| **Mantener Sandbox funcional** | ✅ | `mock-service.ts` sin cambios; factory deriva SANDBOX→Mock. |
| **Feature Flag** | ✅ | `ARCA_ALLOW_MOCK_FALLBACK` (env). `fiscal_config.ambiente` sigue siendo la fuente de verdad del ambiente. |
| **Fallback a Sandbox** | ✅ (acotado) | Solo en **HOMOLOGACION** + flag. **PRODUCCION jamás** cae a Mock (no se simula CAE real). Queda logueado (`arca.fallback.mock`). |
| **Logging** | ✅ | `logger.ts` estructurado JSON; `wsaa.login`, `wsfev1.ultimoAutorizado`, `wsfev1.solicitarCAE` con latencia, resultado, códigos. |
| **Audit** | ✅ | Cada operación emite metadata trazable; `emit.ts` ya escribe `invoice_audit` aguas arriba (sin cambios). |
| **Nunca loguear secretos** | ✅ | `maskSecret()` → `len=N`; Token/Sign/clave/CMS jamás en claro (CMS solo por hash truncado). |
| **Credential-gated** | ✅ | `ArcaConfigError` accionable si faltan `ARCA_CERT_PATH`/`ARCA_KEY_PATH`/`ARCA_CUIT`. |
| **Compila** | ✅ | `tsc --noEmit`: **0 errores** en `arca/*`, `env.ts`, `invoicing/storage.ts` (ver §4). |

---

## 4. Verificación de compilación (real, no asumida)

```
$ npx tsc --noEmit
src/lib/compras/compras-mock.ts(415,5): error TS2322: Type '"warn"' is not assignable to
  type '"info" | "signed" | "new" | "observed"'.
```

- **Único error: `compras/compras-mock.ts:415`** — **pre-existente** y **ajeno a FASE E**
  (archivo no modificado; ver `git status`: solo `production-service.ts` y `env.ts` aparecen como `M`).
- Filtrando por los archivos de FASE E:
  ```
  $ npx tsc --noEmit 2>&1 | grep -E "arca/|env\.ts|invoicing/storage"
  NO ERRORS in ARCA/env/storage files
  ```
- **Honestidad de evidencia (rector "VERIFICAR, no asumir"):** se reporta el error pre-existente
  tal cual; **no se lo atribuye a FASE E ni se lo oculta**. Queda como hallazgo abierto (no bloqueante
  para E3, ajeno al subsistema fiscal) para una tarea de saneamiento separada.

---

## 5. Decisiones de diseño relevantes

1. **Firma CMS vía `openssl` del host (cero dependencias npm).** Node `crypto` no produce CMS/PKCS#7
   no-detached nativamente. Se usa `openssl smime -sign … -outform DER -nodetach` detrás de la interfaz
   `CmsSigner` (inyectable para tests/alternativas). **Caveat operativo:** Netlify Functions puede no
   incluir `openssl` ni los archivos de cert → la emisión real requiere un contexto Node con `openssl`
   + cert montados (documentado en E2 §6 y reafirmado en E5).
2. **SOAP/XML sin librería.** El contrato ARCA es acotado y estable; regex sobre nombres de elemento
   fijos del .NET de AFIP. Mantiene `package.json` sin tocar y reduce superficie de auditoría del módulo fiscal.
3. **URLs por ambiente.** HOMOLOGACION → `wsaahomo`/`wswhomo`; PRODUCCION → `wsaa`/`servicios1`.
   Override explícito por env (`ARCA_WSAA_URL`/`ARCA_WSFEV1_URL`) tiene prioridad.
4. **Reintento ante TA expirado.** Errores WSFEv1 de familia token (6xx / patrones de auth) → `invalidate()`
   del TA cacheado + 1 reintento. Errores de red ya reintentan en `soap.ts`; errores de negocio (Fault) no.
5. **Fallback asimétrico por ambiente.** Defensa en profundidad: el flag de fallback **no tiene efecto**
   en PRODUCCION por construcción (chequeo `ambiente === "PRODUCCION" || !allowFallback`).

---

## 6. Aislamiento respetado (restricciones FASE E)

- ❌ No se tocó `main` (rama `feature/arca-production-fase-e`).
- ❌ No se habilitó `ambiente=PRODUCCION` en `fiscal_config`.
- ❌ No se emitieron comprobantes reales ni se usaron certificados productivos.
- ❌ No se modificó Documents Enterprise, Billing Schema (tablas), `emit.ts`, ni la migración `0012`.
- ❌ No se inició Tesorería / Cuentas Corrientes / Balance / Centros de Costo / Neuralsoft ETL.
- ✅ Sandbox (Mock) preservado intacto.

---

## 7. Estado de E3

> **✅ E3 COMPLETO.** `ProductionArcaService` implementado y *credential-gated*; `NOT_READY` eliminado;
> Sandbox preservado; flag/fallback/logging/audit presentes; compila (0 errores en el subsistema fiscal).
> **Producción sigue deshabilitada por diseño.** Para emitir realmente se requieren: cert/clave válidos
> en el host + `openssl` disponible en runtime + ambiente PRODUCCION bajo gate ejecutivo. Validación de
> handshake real → **E4 (Homologación)**.
