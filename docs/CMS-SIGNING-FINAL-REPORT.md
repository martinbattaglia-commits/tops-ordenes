# CMS-SIGNING-FINAL-REPORT — GATE F · F2 (Firma CMS definitiva)

**Fecha:** 2026-05-29
**Rama:** `feature/arca-production-fase-e`
**Autor del gate:** Principal SW Eng · Staff Architect · DevSecOps · QA Lead · Auditor Técnico
**Regla aplicada:** NO ASUMIR · VERIFICAR · evidencia real · lo no verificable se marca **PENDIENTE DE VALIDACIÓN**.

---

## 1. Objetivo

Eliminar la **incertidumbre del binario `openssl` en runtime serverless** (Netlify Functions / AWS Lambda vía `zip-it-and-ship-it`, que **no empaqueta binarios de sistema**) detectada en GATE 3 (`OPENSSL-RUNTIME-REPORT.md`, 🔴 RIESGO).

Decisión: implementar un firmador CMS/PKCS#7 **100 % JavaScript** (sin dependencia de binario externo) y demostrar, **con evidencia ejecutada**, que produce un SignedData equivalente al de `openssl smime -nodetach` y aceptado por un verificador independiente.

Prioridad de tecnología (según master prompt): **1. node-forge** > 2. pkcs7 > 3. alternativa superior.
**Elegido:** `node-forge@1.4.0` (ya presente en el árbol; promovido a **dependencia directa**).

---

## 2. Qué se implementó (módulos reales, no prototipos)

| Archivo | Rol | Estado |
|---|---|---|
| `src/lib/arca/cms-forge.ts` | Firmador puro-JS `forgeCmsSigner(certPath, keyPath)` → PKCS#7 SignedData **embebido** (no detached), DER→base64. | NUEVO |
| `src/lib/arca/node-forge.d.ts` | Declaración ambiente mínima (`@types/node-forge` ausente). | NUEVO |
| `src/lib/arca/wsaa.ts` | `defaultCmsSigner()` selecciona `forge` (default) u `openssl` según `ARCA_CMS_SIGNER`; `login()` usa el selector. | MODIFICADO |
| `src/lib/env.ts` | Nueva var `env.arca.cmsSigner` (`forge` default \| `openssl`). | MODIFICADO |
| `scripts/arca-cms-signer-test.mjs` | Harness de prueba real (transpila el módulo real con esbuild, no reimplementa). | NUEVO |
| `package.json` / `package-lock.json` | `node-forge ^1.4.0` como dependencia directa (diff mínimo). | MODIFICADO |

**Equivalencia funcional buscada:**
`openssl smime -sign -signer cert -inkey key -outform DER -nodetach`
→ PKCS#7 **SignedData con el TRA EMBEBIDO**, DER, base64 — exactamente lo que WSAA `LoginCms` espera en `<in0>`.

---

## 3. Prueba real ejecutada (evidencia)

**Comando:** `node scripts/arca-cms-signer-test.mjs`
**Cert/clave:** RSA-2048 **autofirmado de prueba, descartable** (NO ARCA), generado con `openssl req -x509` y borrado al final. **No se usó certificado ARCA** (verificado ausente — ver §4).
**Módulo bajo prueba:** el **módulo real** `src/lib/arca/cms-forge.ts`, transpilado con `esbuild --format=cjs` (no una reimplementación en el test).

### Salida verbatim (2026-05-29)

```
=== GATE F · F2 — CMS signer test (sin ARCA) ===

✅ Generación de cert+clave de prueba (openssl req) — RSA-2048 autofirmado descartable
✅ Transpilación del módulo real cms-forge.ts (esbuild) — bundle CJS generado
✅ forgeCmsSigner exportado por el módulo
✅ Firma CMS producida (base64 no vacío) — len=2248, 22ms
✅ CMS parsea como PKCS#7 SignedData (node-forge) — type=1.2.840.113549.1.7.2
✅ openssl cms -verify ACEPTA el CMS de node-forge — CMS Verification successful
✅ Contenido recuperado por openssl == TRA original (nodetach OK) — recuperado 280B vs original 280B
✅ opensslSigner produce CMS sobre el mismo input — len=1808B
✅ Paridad forge↔openssl: ambos recuperan el mismo TRA — openssl-path recuperó 280B

=== Resumen: TODOS OK ===
```

### Interpretación de cada check

| # | Verificación | Resultado | Significado |
|---|---|---|---|
| 1 | Cert+clave de prueba | ✅ | Material de prueba descartable (no ARCA). |
| 2 | Transpila módulo real | ✅ | Se prueba `cms-forge.ts`, no un clon. |
| 3 | `forgeCmsSigner` exportado | ✅ | API pública correcta. |
| 4 | Firma producida (base64) | ✅ | 2248 chars, **22 ms** (orden de magnitud apto para serverless). |
| 5 | Parsea como SignedData | ✅ | OID `1.2.840.113549.1.7.2` = `signedData` (estándar PKCS#7). |
| 6 | `openssl cms -verify` ACEPTA | ✅ | **Interoperabilidad:** verificador independiente (binario openssl) valida la firma de node-forge → "CMS Verification successful". |
| 7 | Contenido recuperado == TRA | ✅ | 280B == 280B → **no-detached** correcto (TRA embebido, como exige WSAA). |
| 8 | openssl firma el mismo input | ✅ | Línea base de comparación. |
| 9 | Paridad forge↔openssl | ✅ | Ambos caminos recuperan el **mismo TRA** tras verificación. |

**Nota sobre el tamaño (2248 vs 1808):** el CMS de node-forge es mayor porque incluye `signingTime` en los `authenticatedAttributes` y serializa el certificado; ambos son **válidos y verificables** (checks 6 y 9 lo prueban). El tamaño no afecta la aceptación.

### Typecheck

```
npx tsc --noEmit  →  los 4 archivos F2 (cms-forge.ts, wsaa.ts, node-forge.d.ts, env.ts) compilan SIN errores.
Único error remanente: src/lib/compras/compras-mock.ts(415,5) — PREEXISTENTE, ajeno a ARCA/F2.
```

---

## 4. Lo que NO se pudo verificar (PENDIENTE DE VALIDACIÓN)

| Ítem | Estado | Motivo |
|---|---|---|
| `LoginCms` real con CMS de node-forge contra WSAA homologación | **PENDIENTE DE VALIDACIÓN** | No hay certificado ARCA cargado (verificado: `ARCA_CERT_PATH`/`ARCA_KEY_PATH`/`ARCA_CUIT` vacíos en shell y en `.env.local`). Sin cert habilitado por ARCA, WSAA rechaza cualquier TRA. |
| TA (Token+Sign) emitido por WSAA usando el firmador forge | **PENDIENTE DE VALIDACIÓN** | Depende del punto anterior. |

> **No se reporta como aprobado el handshake con WSAA.** Lo demostrado es: (a) el CMS es **estructuralmente un PKCS#7 SignedData válido**, (b) es **aceptado e interoperable** con un verificador independiente (openssl), (c) recupera el TRA original (no-detached), (d) hay **paridad** con el firmador openssl previo. La pieza faltante para PASS pleno es exclusivamente el **certificado ARCA**.

---

## 5. Riesgo GATE 3 → estado tras F2

| Antes (GATE 3) | Después (F2) |
|---|---|
| 🔴 Firma depende de `openssl` CLI, **no garantizado** en Netlify Functions. | 🟢 Firma por defecto **100 % JS** (`node-forge`), sin binario externo. `openssl` queda como opt-in (`ARCA_CMS_SIGNER=openssl`) para hosts que sí lo tengan. |

**El bloqueo técnico de "firma en serverless" queda RESUELTO estructuralmente.**

---

## 6. Veredicto F2

**🟢 PASS (con alcance acotado y honesto):**
- Firma CMS puro-JS implementada en el código real.
- Validez estructural, interoperabilidad con openssl y paridad: **demostradas con evidencia ejecutada**.
- `LoginCms` real contra WSAA: **PENDIENTE DE VALIDACIÓN** (falta certificado ARCA — único bloqueo restante, no técnico).

**Evidencia:** salida del test (§3) + `tsc --noEmit` (§3) + `scripts/arca-cms-signer-test.mjs` (reproducible).
