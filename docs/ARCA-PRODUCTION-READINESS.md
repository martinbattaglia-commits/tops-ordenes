# ARCA-PRODUCTION-READINESS — GATE F · F4 (GO / NO-GO productivo)

**Fecha:** 2026-05-29
**Rama:** `feature/arca-production-fase-e`
**Regla aplicada:** NO ASUMIR · VERIFICAR · evidencia real · veredicto basado **solo** en evidencia obtenida.

---

## 1. Resumen de etapas GATE F

| Etapa | Estado | Evidencia |
|---|---|---|
| **F1 — Certificados y homologación** | ⏭️ SKIP | `ARCA-HOMOLOGATION-CERTIFIED.md` — cert/clave/CUIT ausentes (verificado shell + `.env.local`); `FEDummy` vivo (GATE 1); handshake PENDIENTE. |
| **F2 — Firma CMS definitiva** | 🟢 PASS (alcance acotado) | `CMS-SIGNING-FINAL-REPORT.md` — 9/9 checks ✅; `openssl cms -verify` acepta CMS de node-forge; paridad forge↔openssl; 22 ms. LoginCms-real PENDIENTE. |
| **F3 — Piloto controlado** | ⏭️ SKIP | `ARCA-END-TO-END-PILOT.md` — no ejecutable sin cert; emisión de producción prohibida; código implementado. |
| **F4 — GO/NO-GO productivo** | 🟡 (este doc) | Consolidación de evidencia. |

---

## 2. Validaciones obligatorias (estado verificado)

| # | Validación | Estado | Evidencia / Nota |
|---|---|---|---|
| 1 | **Logs sin secretos** | 🟢 OK | `maskSecret()` enmascara Token/Sign (`len=N`); clave/CMS nunca en claro. `cms-forge.ts` no loguea material. (GATE 4) |
| 2 | **Secretos fuera de repo/DB** | 🟢 OK | Cert/clave por path en host (`ARCA_CERT_PATH`/`ARCA_KEY_PATH`). No hay `ARCA_*` en `.env.local` ni claves en repo. |
| 3 | **Certificados** | 🟡 PENDIENTE | No hay cert ARCA cargado → handshake no validado. (F1) |
| 4 | **Expiración TA** | 🟢 OK (lógica) | `WsaaClient` cachea hasta `expirationTime` con margen `taMarginSeconds` (600s default). Renovación verificada por código. Validación con TA real: PENDIENTE. |
| 5 | **Retries** | 🟢 OK | `soap.ts`: 2 reintentos, 5xx transitorio / 4xx no-retry / SOAP Fault no-retry, timeout 15s. (GATE 1/4) |
| 6 | **Cache TA** | 🟢 OK (lógica) | Cache por proceso + de-dup `inflight`. **Observación O2 (GATE 4):** en serverless el cache es por-instancia → más logins, no es bug. |
| 7 | **Multi-tenant** | 🟢 OK | `cacheKey = certPath:service`; aislamiento por tenant en data layer. |
| 8 | **RLS** | 🟢 PASS | `R4-STAGING-VALIDATION.md` — aislamiento bucket `invoices` validado en staging (4 cuadrantes). |
| 9 | **Auditoría fiscal** | 🟢 OK (diseño) | Registro inmutable + trazabilidad (FASE E). Validación con comprobante real: PENDIENTE (F3). |
| 10 | **QR AFIP/ARCA** | 🟡 PENDIENTE | `qr.ts` implementa RG 4892/2020 (`afip.gob.ar/fe/qr/`). Validación contra ARCA con CAE real: PENDIENTE. |
| 11 | **Almacenamiento PDF** | 🟡 PENDIENTE | Bucket `invoices` con RLS validado (R4); generación PDF con CAE/QR real: PENDIENTE (F3). |
| 12 | **Numeración comprobantes** | 🟡 PENDIENTE | `FECompUltimoAutorizado` implementado/validado contra estructura; correlatividad con CAE real: PENDIENTE. |
| 13 | **Firma CMS serverless** | 🟢 RESUELTO | F2 — firmador puro-JS, sin binario; riesgo GATE 3 cerrado estructuralmente. |

---

## 3. Análisis del veredicto

**Lo que está sólido y verificado con evidencia ejecutada:**
- Firma CMS portable a serverless (F2) — el bloqueo técnico principal de GATE 3 **resuelto**.
- Aislamiento RLS multi-tenant del bucket `invoices` (R4, staging).
- Manejo de secretos, retries, timeouts, cache/TA, enmascarado de logs (GATE 4: APROBADO).
- Infraestructura de homologación viva (`FEDummy`, GATE 1).

**Lo único que impide un 🟢 GO pleno (no técnico):**
- **Ausencia del certificado ARCA.** Sin él no hay `LoginCms` real, ni TA, ni `FECAESolicitar`, ni piloto end-to-end, ni validación de QR/PDF/numeración con CAE real.

Esto **no es un defecto del software**: es un insumo operativo/administrativo (tramitar cert ARCA y cargarlo en el host). Todo el código del camino crítico está implementado y, donde fue posible sin cert, **probado**.

---

## 4. Veredicto F4

# 🟡 GO CON CONDICIONES

**No habilitar producción todavía.** El sistema está **técnicamente listo** en el camino crítico de firma + infraestructura + seguridad, pero la facturación electrónica real **no puede certificarse** sin completar las siguientes condiciones, todas dependientes del **certificado ARCA**:

### Condiciones para pasar a 🟢 GO PRODUCCIÓN

1. **Tramitar y cargar el certificado ARCA** de homologación en el host (`ARCA_CERT_PATH`/`ARCA_KEY_PATH`/`ARCA_CUIT`, `ARCA_AMBIENTE=HOMOLOGACION`).
2. **Ejecutar F1 real:** `LoginCms` (con `forgeCmsSigner`) → TA → `FECompUltimoAutorizado` → `FECAESolicitar`; registrar evidencia en `ARCA-HOMOLOGATION-CERTIFIED.md`.
3. **Ejecutar F3 (piloto) en homologación:** emitir comprobante de prueba y validar CAE · número · vencimiento · **QR contra ARCA** · PDF · persistencia · trazabilidad.
4. **Repetir con certificado de PRODUCCIÓN** y un comprobante controlado antes del go-live masivo.
5. **Confirmar el firmador en el runtime real de deploy:** `ARCA_CMS_SIGNER=forge` por defecto (no depender de `openssl` en Netlify Functions).

### Restricciones que siguen en vigor
- NO merge a `main`. NO habilitar producción. NO emitir comprobantes de producción. NO usar certificados productivos en pruebas. Trabajo confinado a `feature/arca-production-fase-e`.

**Evidencia base del veredicto:** `CMS-SIGNING-FINAL-REPORT.md`, `ARCA-HOMOLOGATION-CERTIFIED.md`, `ARCA-END-TO-END-PILOT.md`, `R4-STAGING-VALIDATION.md`, `ARCA-SECURITY-AUDIT.md`, `OPENSSL-RUNTIME-REPORT.md`.
