# TOPS NEXUS — ARCA HOMOLOGATION REPORT (FASE E4)

> **Estado:** 🟡 **Homologación PREPARADA — handshake parcialmente validado en vivo (sin cert)**
> **Fecha:** 2026-05-29 · **Rama:** `feature/arca-production-fase-e`
> **Comprobantes de prueba emitidos:** ❌ **NINGUNO** · **PRODUCCION:** ❌ no tocada · **Cert productivo:** ❌ no usado

---

## 0. Objetivo de E4

> Preparar el entorno de **Homologación** de ARCA y validar el ciclo
> login → ticket → token → firma → CAE **de homologación**, **sin emitir comprobantes reales**
> y **sin cambiar PRODUCCION**. Entregable: este informe + script de dry-run.

**Limitación estructural y honesta:** la validación *completa* del handshake (G4/G5) requiere un
**certificado X.509 de homologación emitido por ARCA** para el CUIT del emisor. Ese certificado **no
está disponible en esta sesión** (no vive en el repo ni en la DB por diseño). Por lo tanto se valida
**en vivo todo lo que NO requiere cert** y se deja el resto **listo para ejecutar** apenas se monte
el certificado de homologación en el host.

---

## 1. Entorno de Homologación (endpoints oficiales)

| Servicio | URL homologación | Auth |
|----------|------------------|------|
| WSAA (LoginCms) | `https://wsaahomo.afip.gov.ar/ws/services/LoginCms` | cert X.509 + clave (CMS) |
| WSFEv1 | `https://wswhomo.afip.gov.ar/wsfev1/service.asmx` | Token+Sign del TA + Cuit |

> Resolución automática por ambiente en `production-service.ts` (`OFFICIAL_URLS.HOMOLOGACION`).
> Override por `ARCA_WSAA_URL` / `ARCA_WSFEV1_URL` si se necesita.

---

## 2. Script de dry-run — `scripts/arca-homologation-check.mjs`

Verifica 5 *gates* de readiness de forma **incremental y sin emitir comprobantes**:

| Gate | Qué valida | Requiere cert |
|------|------------|---------------|
| **G1** | `openssl` disponible (firma CMS/PKCS#7) | no |
| **G2** | cert X.509 + clave privada presentes y legibles | — (es el chequeo) |
| **G3** | Conectividad SOAP a WSFEv1 homologación (`FEDummy`, sin Auth) | no |
| **G4** | WSAA: TRA → firma CMS → `LoginCms` → Token+Sign | **sí** |
| **G5** | WSFEv1 read-only: `FECompUltimoAutorizado` | **sí** + CUIT |

- **Nunca** llama `FECAESolicitar` (no se emite ningún comprobante, ni de prueba). El flag `--emit`
  está **deshabilitado por política FASE E** (se ignora explícitamente).
- **Nunca** usa endpoints de PRODUCCIÓN (URLs de homologación hardcodeadas).
- **Nunca** imprime Token/Sign/clave/CMS en claro (solo longitudes + hash truncado del CMS).

**Uso (cuando exista cert de homologación):**
```bash
ARCA_CERT_PATH=/host/homo-cert.pem \
ARCA_KEY_PATH=/host/homo-key.pem \
ARCA_CUIT=33604896989 \
  node scripts/arca-homologation-check.mjs --ptovta 1 --cbtetipo 11
```

---

## 3. Resultado de la corrida en vivo (esta sesión — evidencia real)

```
$ node scripts/arca-homologation-check.mjs --ptovta 1 --cbtetipo 11
=== ARCA Homologación readiness check (sin emisión) ===
WSAA:   https://wsaahomo.afip.gov.ar/ws/services/LoginCms
WSFEv1: https://wswhomo.afip.gov.ar/wsfev1/service.asmx

✅ G1 openssl: OK — OpenSSL 3.6.2 7 Apr 2026 (Library: OpenSSL 3.6.2 7 Apr 2026)
⏭️  G2 cert/key: SKIP — ARCA_CERT_PATH/ARCA_KEY_PATH no seteados
✅ G3 FEDummy: OK — HTTP 200 App=OK Db=OK Auth=OK
⏭️  G4 WSAA login: SKIP — requiere G1 (openssl) + G2 (cert/key)
⏭️  G5 FECompUltimoAutorizado: SKIP — requiere G4 + ARCA_CUIT

=== Resumen: 2 OK · 3 SKIP · 0 FAIL ===
```

| Gate | Resultado | Lectura |
|------|-----------|---------|
| **G1 openssl** | ✅ **OK** | Firmador CMS operativo en este host (OpenSSL 3.6.2). |
| **G2 cert/key** | ⏭️ SKIP | No hay cert de homologación disponible (esperado). |
| **G3 FEDummy** | ✅ **OK (live)** | **Roundtrip SOAP real contra `wswhomo.afip.gov.ar`**: HTTP 200, `AppServer=OK / DbServer=OK / AuthServer=OK`. **Valida en vivo** la construcción del envelope, el `SOAPAction` (`http://ar.gov.afip.dif.FEV1/FEDummy`) y el parseo de respuesta de `soap.ts`/`wsfev1.ts` contra el servicio real. |
| **G4 WSAA login** | ⏭️ SKIP | Bloqueado por G2 (sin cert). Código listo (`wsaa.ts` + script). |
| **G5 ÚltimoAutorizado** | ⏭️ SKIP | Bloqueado por G4 + CUIT. Código listo. |

> **Honestidad de evidencia (rector "VERIFICAR, no asumir"):** **0 FAIL**. Lo verificable sin cert
> se verificó **en vivo** (G1, G3). Lo que requiere cert (G4/G5) se reporta como **SKIP**, **no como
> aprobado**. No se fabricó evidencia de login ni de CAE.

**Valor de G3:** que `FEDummy` devuelva `App/Db/Auth = OK` es la confirmación más fuerte disponible
sin certificado de que la **plomería SOAP del cliente nuevo es correcta contra el servicio real** —
no un mock. El paso restante (G4/G5) es exclusivamente de credenciales, no de código.

---

## 4. Checklist para completar la homologación (cuando haya cert)

| # | Paso | Responsable | Estado |
|---|------|-------------|--------|
| 1 | Generar CSR + clave privada para CUIT 33-60489698-9 (homologación) | Fiscal/IT | ⬜ |
| 2 | Tramitar certificado de **homologación** en el portal ARCA (WSASS) | Fiscal | ⬜ |
| 3 | Asociar el alias del WS `wsfe` al certificado de homologación | Fiscal | ⬜ |
| 4 | Montar cert + clave en el host (paths `ARCA_CERT_PATH`/`ARCA_KEY_PATH`); **nunca** en repo/DB | IT/DevOps | ⬜ |
| 5 | Setear `ARCA_CUIT` y, si aplica, `ARCA_AMBIENTE=HOMOLOGACION` | IT/DevOps | ⬜ |
| 6 | Correr `arca-homologation-check.mjs` → G1–G5 = OK | IT | ⬜ |
| 7 | (Opcional, gate aparte) Emitir 1 comprobante de homologación con `FECAESolicitar` y verificar CAE + QR | Fiscal | ⬜ |
| 8 | Confirmar que `openssl` está disponible en el runtime productivo (ver §5) | DevOps | ⬜ |

---

## 5. Riesgo de runtime conocido (reafirmado)

El firmador CMS por defecto usa el binario **`openssl` del host**. **Netlify Functions puede no
incluir `openssl` ni los archivos de cert.** La emisión real (homologación o producción) debe correr
en un **contexto Node con `openssl` + cert montados** (worker dedicado / contenedor / host gestionado),
o reemplazar `CmsSigner` por una implementación pura-JS de CMS. **Decisión pendiente de E5 / gate de
infraestructura.** (En este host de desarrollo, G1 confirma `openssl` presente.)

---

## 6. Aislamiento respetado

- ❌ No se emitió ningún comprobante (ni de homologación).
- ❌ No se tocó PRODUCCION ni `fiscal_config`.
- ❌ No se usaron certificados (productivos ni de homologación).
- ❌ No se modificó Documents Enterprise, Billing Schema, `emit.ts`, `0012`, ni `main`.
- ✅ Solo se agregó `scripts/arca-homologation-check.mjs` (read-only / health-check) + este informe.

---

## 7. Estado de E4

> 🟡 **Homologación PREPARADA.** Endpoints, script de dry-run y checklist listos. **Validación en vivo
> parcial real:** G1 (openssl) + G3 (FEDummy contra el servicio real de homologación) = **OK**, **0 FAIL**.
> **Condición de cierre pleno:** montar el certificado de homologación de ARCA y correr G4+G5 = OK
> (login/token/firma + lectura `FECompUltimoAutorizado`). El código está completo; lo único que falta
> es **credencial**, no implementación.
