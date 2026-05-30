# ARCA-HOMOLOGATION-CERTIFIED — GATE F · F1 (Certificados y homologación)

**Fecha:** 2026-05-29
**Rama:** `feature/arca-production-fase-e`
**Regla aplicada:** NO ASUMIR · VERIFICAR · evidencia real · lo no verificable se marca **PENDIENTE DE VALIDACIÓN**.

---

## 1. Objetivo

Verificar la existencia y validez del material de homologación ARCA (certificado X.509, clave privada, CUIT, URLs WSAA/WSFEv1) y, **solo si está presente**, ejecutar pruebas reales contra homologación:
`LoginCms` → TA → `FECompUltimoAutorizado` → `FECAESolicitar`, registrando request/response/tiempos/errores/observaciones.

---

## 2. Verificación de prerequisitos (evidencia)

Comprobación de presencia (sin exponer valores), 2026-05-29:

| Variable | Shell env | `.env.local` | Archivo en disco |
|---|---|---|---|
| `ARCA_CERT_PATH` | vacío | sin clave `ARCA_*` | — (path vacío) |
| `ARCA_KEY_PATH` | vacío | sin clave `ARCA_*` | — (path vacío) |
| `ARCA_CUIT` | vacío | sin clave `ARCA_*` | n/a |
| `ARCA_AMBIENTE` | vacío (default `SANDBOX`) | — | n/a |
| `ARCA_WSAA_URL` | vacío (default prod) | — | n/a |
| `ARCA_WSFEV1_URL` | vacío (default prod) | — | n/a |

**Conclusión de prerequisitos:** **NO hay certificado ARCA, clave privada ni CUIT configurados.** Verificado en el entorno de shell y en `.env.local` (no existe ninguna clave `ARCA_*`).

> Esto es **correcto y esperado** por política: el cert/clave X.509 **nunca** viven en repo ni en DB; se referencian por path en el host. En este entorno de auditoría el host no tiene el material ARCA cargado.

---

## 3. Pruebas de homologación

Por ausencia de certificado ARCA, **las pruebas que dependen del handshake real NO pueden ejecutarse**. Se documentan honestamente como PENDIENTE (jamás como aprobadas):

| Prueba | Estado | Detalle |
|---|---|---|
| WSAA `LoginCms` (obtener TA) | **PENDIENTE DE VALIDACIÓN** | Requiere cert ARCA habilitado para el servicio `wsfe` en homologación. |
| TA (Token + Sign + expiración) | **PENDIENTE DE VALIDACIÓN** | Derivado de `LoginCms`. |
| WSFEv1 `FEDummy` (sin auth) | ✅ **VERIFICADO** (GATE 1) | Endpoint de homologación vivo (`AppServer/DbServer/AuthServer = OK`). No requiere cert. Ver `ARCA-HOMOLOGATION-FINAL.md`. |
| WSFEv1 `FECompUltimoAutorizado` | **PENDIENTE DE VALIDACIÓN** | Requiere TA válido. |
| WSFEv1 `FECAESolicitar` (emisión test) | **PENDIENTE DE VALIDACIÓN** | Requiere TA válido. Cubierto en F3. |

**Lo que SÍ está probado y vivo (sin cert):** conectividad e infraestructura de homologación vía `FEDummy` (GATE 1). El **camino de firma** del TRA quedó resuelto y probado estructuralmente en **F2** (`CMS-SIGNING-FINAL-REPORT.md`). El único faltante para cerrar el handshake es el **certificado ARCA**.

---

## 4. Qué se necesita para levantar el SKIP a PASS

1. Generar/obtener el **certificado X.509** ARCA (CSR → ARCA Clave Fiscal → cert) y habilitarlo para el servicio **`wsfe`** en **homologación**.
2. Colocar cert y clave en el **host** (no en repo/DB) y setear `ARCA_CERT_PATH`, `ARCA_KEY_PATH`, `ARCA_CUIT`, `ARCA_AMBIENTE=HOMOLOGACION`.
3. Re-ejecutar el flujo: `LoginCms` (con `forgeCmsSigner`) → TA → `FECompUltimoAutorizado` → `FECAESolicitar` y registrar request/response/tiempos/errores aquí.

---

## 5. Veredicto F1

**⏭️ SKIP (bloqueo NO técnico):** sin certificado ARCA cargado no es posible ejecutar el handshake real. Infraestructura (FEDummy) verificada viva; firma CMS resuelta y probada (F2). Pruebas dependientes del cert: **PENDIENTE DE VALIDACIÓN**.

**Evidencia:** verificación de presencia de variables/`.env.local` (§2) + `FEDummy` vivo (GATE 1, `ARCA-HOMOLOGATION-FINAL.md`).
