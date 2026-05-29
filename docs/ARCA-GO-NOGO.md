# TOPS NEXUS — ARCA GO / NO-GO (FASE E5)

> **Veredicto:** 🟡 **GO CON CONDICIONES**
> **Fecha:** 2026-05-29 · **Rama:** `feature/arca-production-fase-e` (aislada, sin merge a `main`)
> **Alcance del veredicto:** habilitar el *camino* a ARCA productivo. **NO** es una autorización para
> emitir comprobantes reales: eso queda sujeto a las condiciones de §3 y a un **gate ejecutivo explícito**.

---

## 0. Pregunta rectora

> *¿Esto acerca a TOPS Nexus ERP a emitir comprobantes fiscales reales de forma segura y auditada?*
> **SÍ.** FASE E deja `ProductionArcaService` implementado y *credential-gated*, el aislamiento
> multi-tenant del bucket fiscal resuelto, y el handshake de homologación validado en todo lo que no
> depende de un certificado. Lo que falta para emitir es **credencial + infraestructura + gate**, no código.

---

## 1. Qué entregó FASE E (resumen ejecutivo)

| Sub-fase | Entregable | Estado | Evidencia |
|----------|------------|--------|-----------|
| **E1** | R4 — aislamiento bucket `invoices` | ✅ código+SQL; ⏳ live staging pendiente cred. | `R4-CLOSURE-REPORT.md`, `0013_*.sql`, `invoicing/storage.ts`, script R0–R5 |
| **E2** | Arquitectura ARCA productiva | ✅ | `ARCA-PRODUCTION-ARCHITECTURE.md` |
| **E3** | `ProductionArcaService` implementado | ✅ `NOT_READY` eliminado; compila | `ARCA-IMPLEMENTATION-REPORT.md`; `wsaa.ts`, `soap.ts`, `wsfev1.ts`, `logger.ts` |
| **E4** | Homologación preparada + dry-run | 🟡 G1+G3 OK live, G4/G5 SKIP (sin cert) | `ARCA-HOMOLOGATION-REPORT.md`, `arca-homologation-check.mjs` |
| **E5** | Veredicto GO/NO-GO | 🟡 este documento | — |

---

## 2. Criterios de decisión (matriz objetiva)

| # | Criterio | Requerido para GO pleno | Estado actual | ✓ |
|---|----------|--------------------------|---------------|----|
| C1 | `ProductionArcaService` implementado (sin stub `NOT_READY`) | Sí | Implementado, orquesta WSAA+WSFEv1 | ✅ |
| C2 | Compila sin errores (subsistema fiscal) | Sí | `tsc`: 0 errores en `arca/*`, `env.ts` | ✅ |
| C3 | Sandbox/Mock preservado | Sí | `mock-service.ts` intacto; factory deriva SANDBOX→Mock | ✅ |
| C4 | Credential-gated (nunca CAE falso) | Sí | `ArcaConfigError` si faltan cert/clave; PRODUCCION sin fallback | ✅ |
| C5 | Feature flag + fallback acotado | Sí | `ARCA_ALLOW_MOCK_FALLBACK` (solo no-PROD) | ✅ |
| C6 | Logging/audit sin exponer secretos | Sí | `logger.ts` + `maskSecret`; `emit.ts` ya audita | ✅ |
| C7 | Conectividad SOAP real validada | Sí | **G3 FEDummy live = App/Db/Auth OK** | ✅ |
| C8 | R4 aislamiento bucket fiscal | Sí | código+SQL listos; equivalente al patrón `documents` enforced | 🟡 |
| C9 | Handshake WSAA real (token+firma) | **Para emitir** | **SKIP** — sin cert de homologación | ⛔ |
| C10 | Lectura `FECompUltimoAutorizado` real | **Para emitir** | **SKIP** — depende de C9 | ⛔ |
| C11 | `openssl` disponible en runtime productivo | **Para emitir** | OK en host dev; **incierto en Netlify Functions** | ⛔ |
| C12 | R4 validado en vivo en staging | **Para emitir** | ⏳ pendiente (cred. staging vacías) | ⛔ |
| C13 | Cert productivo + ambiente PRODUCCION bajo gate | **Para emitir** | No realizado (prohibido en FASE E) | ⛔ |

**Lectura:** C1–C7 (camino + seguridad de código) **completos**. C8 cerrado a nivel código/SQL.
C9–C13 son **bloqueantes de emisión**, todos por **credencial/infra/gate**, **ninguno por código**.

---

## 3. Veredicto y condiciones

### 🟡 GO CON CONDICIONES

**GO** para considerar a `ProductionArcaService` **READY** (código completo, seguro, auditable,
sandbox preservado, producción deshabilitada por diseño) y para **mergear la rama** previa revisión.

**Condiciones obligatorias antes de emitir un comprobante fiscal real** (cada una es un gate):

1. **Certificado de homologación** emitido por ARCA + correr `arca-homologation-check.mjs` → **G4 y G5 = OK**
   (login/token/firma + lectura). *(cierra C9, C10)*
2. **Resolver `openssl` en runtime**: confirmar disponibilidad en el contexto de ejecución productivo
   o reemplazar `CmsSigner` por CMS puro-JS. *(cierra C11)*
3. **Validar R4 en vivo** en staging (`r4-invoices-isolation-validation.sql`: R2=1 propia, R3=0 fugas,
   R4=0 cross-tenant) y aplicar `0013` en producción. *(cierra C8/C12)*
4. **Certificado productivo** + setear `ambiente=PRODUCCION` en `fiscal_config` **bajo gate ejecutivo
   explícito** + emitir un comprobante piloto controlado y verificar CAE+QR. *(cierra C13)*
5. **Revisión y merge** de `feature/arca-production-fase-e` a `main` (no realizado en FASE E).

> **Orden recomendado:** 1 → 2 → 3 → (revisión/merge) → 4. No saltear el piloto controlado.

---

## 4. Por qué NO es NO-GO

- No hay defecto de código bloqueante: el subsistema fiscal compila y la plomería SOAP fue **validada
  en vivo** contra el servicio real de homologación (G3).
- El diseño es *fail-safe*: sin credenciales **lanza error claro**, jamás simula un CAE en producción.
- Sandbox sigue 100% operativo: el ERP no se degrada por esta entrega.

## 5. Por qué NO es GO pleno

- **Sin certificado** no se pudo ejercitar el login real (G4) ni una emisión de homologación (C9/C10).
- **Riesgo de runtime `openssl`** no resuelto para el contexto productivo (C11).
- **R4 sin corrida en vivo** (credenciales de staging vacías esta sesión) (C12).
- Emitir requiere **decisión ejecutiva** + cert productivo (C13), explícitamente fuera de FASE E.

---

## 6. Estado final FASE E

> **R4 resuelto (código+SQL). `ProductionArcaService` implementado y credential-gated. Sandbox
> preservado. Homologación preparada y parcialmente validada en vivo (G1+G3, 0 FAIL). Producción
> deshabilitada. Evidencia completa y honesta.**
>
> **Veredicto objetivo: 🟡 GO CON CONDICIONES** — la habilitación de emisión real queda sujeta a las
> 5 condiciones de §3 y a autorización ejecutiva específica.

---

## 7. Aislamiento respetado (toda FASE E)

- ❌ Sin merge a `main`. ❌ Sin habilitar PRODUCCION. ❌ Sin emitir comprobantes. ❌ Sin certificados.
- ❌ Sin tocar Documents Enterprise, Billing Schema, `emit.ts`, `0012`, Tesorería, Cuentas Corrientes,
  Balance, Centros de Costo, Neuralsoft ETL.
- ✅ Todo el trabajo aislado en `feature/arca-production-fase-e`. Nada commiteado/pusheado sin autorización.
