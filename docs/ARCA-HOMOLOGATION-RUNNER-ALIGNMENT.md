# ARCA-HOMOLOGATION-RUNNER-ALIGNMENT — FASE F · Preparación final pre-homologación

**Fecha:** 2026-05-29
**Rama:** `feature/arca-production-fase-e`
**Alcance autorizado:** alinear el runner de homologación al camino criptográfico oficial validado en F2 — **eliminar la dependencia residual de OpenSSL** en `scripts/arca-homologation-check.mjs` y usar **exclusivamente `forgeCmsSigner()`** a través de la interfaz `CmsSigner` ya validada.
**Regla rectora:** *"¿Esto acerca a TOPS Nexus a emitir comprobantes fiscales reales de forma segura, auditada y conforme a ARCA?"* — NO ASUMIR · VERIFICAR · evidencia real.

**NO autorizado / NO ejecutado:** conexión a ARCA · LoginCms real · WSAA real · certificados reales · homologación (ejecución) · emisión fiscal · cambios en producción · cambios en `fiscal_config` · GATE F2–F6 · merge a `main`.

---

## 1. Diferencias antes/después

**Archivo:** `scripts/arca-homologation-check.mjs` — `1 file changed, 71 insertions(+), 80 deletions(-)`.

### Motivo

El binario `openssl` **no es confiable en el runtime serverless** (Netlify Functions / AWS Lambda: `zip-it-and-ship-it` no empaqueta binarios del sistema). El firmador puro-JS `forgeCmsSigner` (node-forge) fue validado en F2 (`CMS-SIGNING-FINAL-REPORT.md`, 9/9 checks) y es el camino que iría a producción. El runner debía firmar **exactamente con ese mismo módulo** para que la homologación valide el camino real, sin residuos de OpenSSL.

### Eliminado (residual OpenSSL)

| Elemento | Antes | Después |
|---|---|---|
| Import | `import { spawn, spawnSync } from "node:child_process";` | `import { spawnSync } from "node:child_process";` (solo para invocar esbuild) |
| Opción CLI | `const SIGNER = opt("signer", "forge") === "openssl" ? "openssl" : "forge";` + flag `--signer openssl` | **eliminado** — no hay selección de firmador |
| Gate G1 | `checkOpenssl()` → `spawn("openssl", ["version"])` | **reemplazado** por gate de readiness del firmador forge (ver §2) |
| Firma alternativa | `signCmsOpenssl()` → `spawn("openssl", ["smime","-sign",…])` | **eliminado** |
| Dispatcher | `signCms(tra) = SIGNER === "openssl" ? signCmsOpenssl : signCmsForge` | `signCms(tra)` firma **siempre** con forge vía `CmsSigner.sign()` |
| Gating G4/G5 | `signerReady = SIGNER === "forge" ? creds.ok : creds.ok && ov;` | `signerReady = forgeOk && creds.ok;` |
| Logs/labels | `"G1 openssl"`, `signer=${SIGNER}`, mensajes `--signer` | `"G1 forge signer"`, `signer=forge` fijo |
| Docstring | "requerido SOLO si --signer openssl" / "Con `--signer openssl`…" | "usa EXCLUSIVAMENTE `forgeCmsSigner`… sin depender del binario openssl" |

### Añadido / reestructurado

- **`loadForgeFactory()`** — transpila `src/lib/arca/cms-forge.ts` con esbuild (`--bundle --format=cjs --platform=node`) una sola vez y devuelve la factory `forgeCmsSigner`. Reutilizada por G1 (readiness, sin CERT/KEY) y por la firma real (G4).
- **`signCms(tra)`** — instancia el `CmsSigner` con `forgeCmsSigner(CERT, KEY)`, verifica que expone `.sign()` y firma. Único camino de firma.
- **G1 (gate)** — "forge signer": transpila `cms-forge.ts` y verifica que `forgeCmsSigner` devuelve un `CmsSigner` con `.sign()`. **No usa CERT/KEY** (la lectura del material ocurre recién en `.sign()`), por lo que es verificable sin certificado.
- `cleanupForge()` — sin cambios funcionales (limpia el tmpdir de transpilación).

> El único uso restante de `spawnSync` es para invocar `esbuild` (transpilación de TypeScript), **no** para criptografía. Las únicas apariciones de la palabra "openssl" en el archivo están en comentarios que explican por qué **ya no** se depende de él.

---

## 2. Evidencia de que el runner usa `forgeCmsSigner`

Gate G1 (readiness del firmador) en `main`:

```js
// G1 — firmador CMS puro-JS: transpilar cms-forge.ts y verificar que
// forgeCmsSigner expone la interfaz CmsSigner (.sign()). NO usa CERT/KEY.
let forgeOk = false;
try {
  const forgeCmsSigner = await loadForgeFactory();
  const probe = forgeCmsSigner("/dev/null", "/dev/null");
  if (typeof probe?.sign !== "function")
    throw new Error("forgeCmsSigner no devuelve un CmsSigner con .sign()");
  forgeOk = true;
  log("G1 forge signer", "OK", "cms-forge.ts transpila y expone CmsSigner.sign()");
} catch (e) {
  log("G1 forge signer", "FAIL", e.message);
}
```

Firma del TRA en G4 (vía interfaz `CmsSigner`, único firmador):

```js
async function signCms(tra) {
  if (!_forgeSigner) {
    const forgeCmsSigner = await loadForgeFactory();
    const signer = forgeCmsSigner(CERT, KEY);
    if (typeof signer?.sign !== "function")
      throw new Error("forgeCmsSigner no devolvió un CmsSigner con .sign()");
    _forgeSigner = signer;
  }
  return _forgeSigner.sign(tra);
}
// …
async function wsaaLogin() {
  const tra = buildTra();
  const cms = await signCms(tra); // ← firma puro-JS forge, sin openssl
  // …
}
```

`forgeCmsSigner` proviene de `src/lib/arca/cms-forge.ts` (módulo validado en F2, sin cambios). El runner lo transpila y lo importa; no hay ningún otro firmador en el archivo.

Verificación por grep (solo comentarios mencionan "openssl"; sin `spawn` desnudo, sin `SIGNER`, sin `--signer`):

```
19: * de firma que iría a producción, sin depender del binario openssl (no apto
153:// puro-JS, sin dependencia del binario openssl (no apto para serverless).
287:  // G4 + G5 requieren G1 (firmador forge) + G2 (cert/key). Sin openssl.
```

---

## 3. Evidencia de compilación

```
$ node --check scripts/arca-homologation-check.mjs
SYNTAX_OK
```

Ejecución local **sin certificado ARCA** (camino verificable sin material):

```
=== ARCA Homologación readiness check (sin emisión) ===
WSAA:   https://wsaahomo.afip.gov.ar/ws/services/LoginCms
WSFEv1: https://wswhomo.afip.gov.ar/wsfev1/service.asmx
Signer: forge (puro-JS, src/lib/arca/cms-forge.ts — validado en F2)

✅ G1 forge signer: OK — cms-forge.ts transpila y expone CmsSigner.sign()
⏭️  G2 cert/key: SKIP — ARCA_CERT_PATH/ARCA_KEY_PATH no seteados
✅ G3 FEDummy: OK — HTTP 200 App=OK Db=OK Auth=OK
⏭️  G4 WSAA login: SKIP — requiere G2 (cert/key)
⏭️  G5 FECompUltimoAutorizado: SKIP — requiere G4 + ARCA_CUIT

=== Resumen: 2 OK · 3 SKIP · 0 FAIL ===
EXIT=0
```

Interpretación:
- **G1 forge signer OK** — `cms-forge.ts` transpila y `forgeCmsSigner` expone `CmsSigner.sign()`. El firmador real está listo, **sin openssl**.
- **G3 FEDummy OK** — infraestructura de homologación viva (`App/Db/Auth = OK`), sin requerir cert.
- **G2/G4/G5 SKIP** — esperado: no hay certificado ARCA cargado en el host. G4/G5 quedan bloqueados **únicamente** por la ausencia del cert (no por openssl).
- **0 FAIL · EXIT=0**.

---

## 4. Variables requeridas para el día de homologación

Definir en el **host** (NO en repo, NO en DB; `chmod 600` para cert/clave):

```
ARCA_AMBIENTE=HOMOLOGACION
ARCA_CERT_PATH=/ruta/segura/homo-cert.pem   # certificado X.509 de HOMOLOGACIÓN (servicio wsfe)
ARCA_KEY_PATH=/ruta/segura/homo-key.pem     # clave privada correspondiente
ARCA_CUIT=<CUIT de homologación, sin guiones>
```

> `ARCA_CMS_SIGNER` ya no aplica al runner: el firmador es **forge fijo**. (En la app, `env.arca.cmsSigner` permanece en `forge` por defecto.)

Con esas variables presentes y el cert habilitado para `wsfe` en homologación, al re-ejecutar el runner:
- **G2** pasa a OK (cert/key legibles),
- **G4** ejecuta `LoginCms` real (firma forge → TA: Token+Sign),
- **G5** ejecuta `FECompUltimoAutorizado` (read-only, próximo número).

`FECAESolicitar` **nunca** se invoca desde este runner (no se emiten comprobantes, ni de prueba).

---

## 5. Confirmación: no se ejecutó ninguna llamada real a ARCA

- La única ejecución de red fue **G3 FEDummy** (endpoint público de homologación, **sin autenticación, sin certificado, sin emisión**) — diagnóstico de conectividad.
- **No** se ejecutó `LoginCms`, **no** se obtuvo TA, **no** se llamó `FECompUltimoAutorizado` ni `FECAESolicitar`: G4 y G5 quedaron en **SKIP** por ausencia de certificado (G2 SKIP).
- **No** se usó ningún certificado real; el gate G1 instancia el `CmsSigner` con paths placeholder (`/dev/null`) solo para verificar la forma de la interfaz, **sin firmar** (la lectura de cert/clave ocurre recién en `.sign()`, que no se invocó).
- **No** hubo merge a `main`, ni cambios en producción ni en `fiscal_config`.

---

## 6. Veredicto

# 🟢 Runner alineado — firmador exclusivo `forgeCmsSigner`, sin OpenSSL

`scripts/arca-homologation-check.mjs` firma el TRA **exclusivamente** con el firmador puro-JS validado en F2, a través de la interfaz `CmsSigner`. La dependencia residual de OpenSSL fue eliminada por completo (criptografía). El runner compila, corre limpio sin certificado (2 OK · 3 SKIP · 0 FAIL) y queda **preparado** para recibir `ARCA_CERT_PATH`/`ARCA_KEY_PATH`/`ARCA_CUIT`/`ARCA_AMBIENTE=HOMOLOGACION` el día de homologación.

**Próximo paso (fuera de este alcance):** proveer el certificado de homologación y ejecutar GATE F (F1→F5) en una sola corrida del runner ya alineado.

**Evidencia:** §2 (código + grep), §3 (`node --check` + corrida sin cert), `CMS-SIGNING-FINAL-REPORT.md` (F2).
