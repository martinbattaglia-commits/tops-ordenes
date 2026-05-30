# ARCA-END-TO-END-PILOT — GATE F · F3 (Piloto controlado)

**Fecha:** 2026-05-29
**Rama:** `feature/arca-production-fase-e`
**Regla aplicada:** NO ASUMIR · VERIFICAR · evidencia real · lo no verificable se marca **PENDIENTE DE VALIDACIÓN**.

---

## 1. Objetivo

Si la homologación funciona, emitir un **comprobante de prueba** y validar end-to-end:
CAE · número · fecha de vencimiento · **QR fiscal** · PDF · persistencia · trazabilidad.

---

## 2. Precondición (bloqueante)

F3 depende **estrictamente** de F1 (handshake WSAA con certificado ARCA real). Verificado en F1:

- **No hay certificado ARCA cargado** (`ARCA_CERT_PATH`/`ARCA_KEY_PATH`/`ARCA_CUIT` vacíos en shell y `.env.local`).
- Sin TA válido de WSAA **no es posible** llamar `FECAESolicitar`.

Además, **restricción absoluta de este gate**: *NO EMITIR COMPROBANTES REALES DE PRODUCCIÓN*. El piloto sería solo en **homologación** y aun así requiere el cert de homologación, que está ausente.

**Conclusión:** el piloto end-to-end **no puede ejecutarse** en este entorno.

---

## 3. Estado del código que soportaría el piloto (verificado, no ejecutado)

Para no confundir "no ejecutado" con "no implementado", se verifica que el **camino de código existe**:

| Capacidad | Módulo real | Estado |
|---|---|---|
| Solicitud de CAE (`FECAESolicitar`) | `src/lib/arca/wsfev1.ts` (`solicitarCAE`) | Implementado. Extrae `CAE`, `CAEFchVto`, `Resultado`, `Observaciones`, `Errors`. |
| Próximo número (`FECompUltimoAutorizado`) | `src/lib/arca/wsfev1.ts` (`ultimoComprobante`) | Implementado. Valida `CbteNro`. |
| QR fiscal RG 4892/2020 | `src/lib/arca/qr.ts` | Implementado. Base `https://www.afip.gob.ar/fe/qr/`, JSON crudo + URL + hash. |
| Firma del TRA (CMS) | `src/lib/arca/cms-forge.ts` (forge) | Implementado y **probado** (F2). |
| Servicio productivo orquestador | `src/lib/arca/production-service.ts` | Implementado (FASE E). |

> El código está presente; lo que falta para correr el piloto es **exclusivamente el certificado ARCA**.

---

## 4. Validaciones end-to-end (no ejecutables sin cert)

| Validación | Estado |
|---|---|
| CAE devuelto y no vacío | **PENDIENTE DE VALIDACIÓN** |
| Número de comprobante correlativo (vs `FECompUltimoAutorizado`) | **PENDIENTE DE VALIDACIÓN** |
| Fecha de vencimiento del CAE (`CAEFchVto`) | **PENDIENTE DE VALIDACIÓN** |
| QR fiscal generado y válido contra ARCA | **PENDIENTE DE VALIDACIÓN** |
| PDF generado con CAE/QR | **PENDIENTE DE VALIDACIÓN** |
| Persistencia en DB (comprobante + CAE + QR) | **PENDIENTE DE VALIDACIÓN** |
| Trazabilidad / auditoría fiscal inmutable | **PENDIENTE DE VALIDACIÓN** |

---

## 5. Veredicto F3

**⏭️ SKIP:** piloto no ejecutable por (a) ausencia de certificado ARCA (F1) y (b) restricción explícita de no emitir comprobantes de producción. El código que lo soporta está implementado; la validación end-to-end queda **PENDIENTE DE VALIDACIÓN** hasta disponer del certificado de homologación.

**Evidencia:** F1 (`ARCA-HOMOLOGATION-CERTIFIED.md`) + inventario de módulos implementados (§3, código real en `src/lib/arca/`).
