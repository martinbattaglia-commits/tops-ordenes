# TOPS NEXUS — ARCA HOMOLOGATION FINAL (GATE 1)

> **Estado:** ⏭️ **SKIP — handshake completo NO validable sin certificado de homologación**
> **Fecha de ejecución:** 2026-05-29 · **Rama:** `feature/arca-production-fase-e`
> **Comprobantes emitidos:** ❌ NINGUNO · **PRODUCCION:** ❌ no tocada · **Cert productivo:** ❌ no usado
> **Regla rectora:** *NO ASUMIR. VERIFICAR.* Lo verificable se corrió **en vivo hoy**; lo que requiere
> cert se reporta **PENDIENTE DE VALIDACIÓN**, jamás como aprobado.

---

## 1. Qué exige el gate

Verificar config (cert/clave/WSAA/WSFEv1) y correr pruebas reales documentadas de **LoginCms**, obtención
de **TA**, **FECompUltimoAutorizado** y **FECAESolicitar** (sin emitir en producción), registrando
request/response/código/errores/tiempos. Si un paso falla, hallar causa raíz y corregir si es seguro.

---

## 2. Verificación de configuración (esta ejecución)

| Variable | Estado | Evidencia |
|----------|--------|-----------|
| `ARCA_CERT_PATH` | ∅ **ausente** | `node -e` sobre `process.env` (corrida de hoy) |
| `ARCA_KEY_PATH` | ∅ **ausente** | ídem |
| `ARCA_CUIT` | ∅ **ausente** | ídem |
| `ARCA_AMBIENTE` | ∅ ausente (default por código) | ídem |
| `ARCA_WSAA_URL` / `ARCA_WSFEV1_URL` | ∅ ausente (usa oficiales por ambiente) | ídem |

**No existe certificado X.509 ni clave de homologación** en el entorno (ni en repo/DB, por diseño). Esto
es **bloqueante estructural** del gate: sin cert no se puede firmar un TRA ni ejercitar WSAA real.

---

## 3. Corrida en vivo — `scripts/arca-homologation-check.mjs` (2026-05-29)

```
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
| **G1 openssl** | ✅ **OK (live)** | Firmador CMS operativo en este host (OpenSSL 3.6.2). *(Su disponibilidad en runtime serverless es otro tema → ver GATE 3.)* |
| **G2 cert/key** | ⏭️ SKIP | Sin cert de homologación (esperado). |
| **G3 FEDummy** | ✅ **OK (live)** | **Roundtrip SOAP real contra `wswhomo.afip.gov.ar`**: HTTP 200, `App=OK / Db=OK / Auth=OK`. Valida en vivo el envelope, `SOAPAction` y el parseo de `soap.ts`/`wsfev1.ts` contra el servicio **real** (no mock). |
| **G4 WSAA LoginCms** | ⏭️ **SKIP — PENDIENTE DE VALIDACIÓN** | Bloqueado por G2. Código listo (`wsaa.ts` + script). No se fabricó evidencia de login. |
| **G5 FECompUltimoAutorizado** | ⏭️ **SKIP — PENDIENTE DE VALIDACIÓN** | Bloqueado por G4 + CUIT. Código listo. |

---

## 4. Estado de cada prueba pedida por el gate

| Prueba | Estado | Por qué |
|--------|--------|---------|
| LoginCms (handshake WSAA) | ⏳ **PENDIENTE DE VALIDACIÓN** | Requiere cert de homologación (ausente). |
| Obtención de TA (Token+Sign) | ⏳ **PENDIENTE DE VALIDACIÓN** | Depende de LoginCms. |
| FECompUltimoAutorizado (read-only) | ⏳ **PENDIENTE DE VALIDACIÓN** | Requiere TA válido + CUIT. |
| FECAESolicitar (NO en producción) | ⏳ **PENDIENTE DE VALIDACIÓN** (y deshabilitado por política de fase) | El script jamás llama `FECAESolicitar`; `--emit` se ignora. |
| Conectividad SOAP real (FEDummy) | ✅ **OK (live)** | Única prueba ejecutable sin cert; pasó. |

> **Honestidad de evidencia: 0 FAIL, pero NO es PASS de homologación.** Lo verificable sin cert se verificó
> en vivo (G1, G3). El handshake real (G4/G5) **no fue ejercitado** y se reporta como SKIP/PENDIENTE.

---

## 5. Causa raíz del bloqueo y plan de cierre

**Causa raíz:** ausencia de certificado X.509 de homologación emitido por ARCA para CUIT 33-60489698-9.
**No es un defecto de código** — el cliente WSAA/WSFEv1 está implementado y la plomería SOAP quedó validada
en vivo (G3). El bloqueo es 100% de **credencial**.

**Checklist de cierre (cuando exista cert de homologación):**
1. Generar CSR + clave privada; tramitar cert de homologación en WSASS; asociar alias `wsfe`.
2. Montar cert+clave en el host (`ARCA_CERT_PATH`/`ARCA_KEY_PATH`); **nunca** en repo/DB.
3. Setear `ARCA_CUIT` (y `ARCA_AMBIENTE=HOMOLOGACION`).
4. Resolver firma en runtime (GATE 3: `CmsSigner` puro-JS o runtime con `openssl`).
5. Correr `arca-homologation-check.mjs` → **G1–G5 = OK**.
6. (Gate aparte) Emitir 1 comprobante de homologación con `FECAESolicitar` y verificar CAE + QR.

---

## 6. Veredicto del gate

⏭️ **GATE 1 = SKIP / PENDIENTE DE VALIDACIÓN.** Config inspeccionada (sin cert). Live: openssl + FEDummy =
OK (0 FAIL). Handshake real (LoginCms/TA/UltimoAut/FECAESolicitar) **no validado** — exclusivamente por falta
de certificado, no por código.

---

## 7. Aislamiento respetado

- ❌ Sin cert. ❌ Sin emitir comprobantes. ❌ Sin tocar PRODUCCION/`fiscal_config`. ❌ Sin merge a `main`.
- ✅ Solo se corrió el health-check read-only + este informe, en `feature/arca-production-fase-e`.
