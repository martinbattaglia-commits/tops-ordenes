# TOPS NEXUS — OPENSSL / RUNTIME REPORT (GATE 3)

> **Estado:** 🔴 **RIESGO DE RUNTIME CONFIRMADO — firma CMS vía `openssl` no garantizada en serverless**
> **Fecha de ejecución:** 2026-05-29 · **Rama:** `feature/arca-production-fase-e`
> **Regla rectora aplicada:** *NO ASUMIR. VERIFICAR.* Todo lo de abajo está respaldado por inspección
> real de código/dependencias/entorno en esta ejecución; lo no validable se marca **PENDIENTE DE VALIDACIÓN**.

---

## 1. Pregunta del gate

> ¿El firmador CMS/PKCS#7 que usa el subsistema ARCA funciona en el runtime real de producción de
> TOPS Nexus? ¿`openssl` está disponible? Si hay riesgo, ¿cuál es la solución definitiva?

---

## 2. Evidencia recolectada (esta ejecución)

### 2.1 Cómo se firma hoy (código real)

`src/lib/arca/wsaa.ts` — `opensslSigner()` invoca el **binario `openssl` del host** vía `child_process.spawn`:

```
src/lib/arca/wsaa.ts:14   import { spawn } from "child_process";
src/lib/arca/wsaa.ts:90   export function opensslSigner(certPath, keyPath): CmsSigner {
src/lib/arca/wsaa.ts:96       const proc = spawn("openssl", [
src/lib/arca/wsaa.ts:97         "smime", "-sign", "-signer", certPath,
src/lib/arca/wsaa.ts:...        "-inkey", keyPath, "-outform", "DER", "-nodetach" ]);
src/lib/arca/wsaa.ts:225  const signer = this.cfg.signer ?? opensslSigner(this.cfg.certPath, this.cfg.keyPath);
```

El firmador es **inyectable** (interfaz `CmsSigner`, `wsaa.ts:37`): el default es `openssl`, pero se puede
sustituir sin tocar el resto del flujo WSAA. **Este es el punto de extensión que habilita la solución (§5).**

### 2.2 Runtime real de ejecución

- Deploy: **Netlify** con `@netlify/plugin-nextjs`. Las rutas API corren como **Netlify Functions** (AWS
  Lambda, Node 20). Verificado: **todas** las rutas API declaran `export const runtime = "nodejs"`
  (incl. la ruta fiscal `src/app/api/invoices/[id]/pdf/route.ts:7`). **No** hay override a Edge en `next.config.mjs`.
- La cadena de emisión llega a la función: `src/lib/invoicing/emit.ts:135 → getArcaService(ambiente)`.

### 2.3 ¿Hay `openssl` en el runtime?

| Contexto | `openssl` | Evidencia |
|----------|-----------|-----------|
| Host de desarrollo (esta máquina) | ✅ **OpenSSL 3.6.2** | `arca-homologation-check.mjs` G1 = OK (corrida de hoy) |
| Netlify Functions (AWS Lambda) | ⚠️ **NO GARANTIZADO** | `zip-it-and-ship-it` **no** empaqueta binarios de sistema; el sandbox Lambda **puede** traer `openssl` pero **no es contractual** ni versionado por Netlify. **PENDIENTE DE VALIDACIÓN en el runtime real.** |

> **Conclusión honesta:** la firma actual depende de un binario externo cuya presencia en Netlify
> Functions **no está documentada ni garantizada**. No se verificó en el runtime productivo porque
> hacerlo requiere desplegar + un cert de homologación (ambos fuera del alcance de esta fase). Marcado
> **PENDIENTE DE VALIDACIÓN** — **no** aprobado.

### 2.4 Alternativas puro-JS instaladas (verificado hoy)

```
node-forge      : PRESENT (v1.4.0)   ← pkcs7.createSignedData = function ✅
pkijs           : ABSENT
pkcs7           : ABSENT
@peculiar/asn1-cms : ABSENT
node-jose       : ABSENT
```

**Matiz crítico (verificado con `npm ls`):** `node-forge@1.4.0` está presente **solo como dependencia
transitiva de `netlify-cli`** (dev tooling):

```
tops-ordenes → netlify-cli@26.0.2 → @netlify/images → ipx → listhen → node-forge@1.4.0
```

**No** figura en `dependencies`/`devDependencies` directas (solo aparece en `package-lock.json`). Por lo
tanto **NO se empaquetaría** en la Netlify Function aunque se la importe: para usarla en runtime hay que
declararla como **dependencia directa**. La buena noticia: `forge.pkcs7.createSignedData` **existe y es
funcional** (verificado en esta ejecución), así que un `CmsSigner` puro-JS es **técnicamente viable**.

---

## 3. Veredicto del gate

🔴 **RIESGO CONFIRMADO / PENDIENTE DE VALIDACIÓN.** El camino de firma por defecto (`openssl` del host)
**no es confiable en el runtime serverless objetivo**. No hay evidencia de que falle —pero tampoco de que
funcione— en Netlify Functions. **No puede marcarse como aprobado.**

---

## 4. Por qué NO se "arregló" en esta ejecución

El master prompt manda **corregir solo problemas seguros y comprobados**. Implementar un `CmsSigner` puro-JS
con node-forge es factible, pero **su corrección end-to-end solo se puede verificar firmando un TRA real y
obteniendo un TA válido de WSAA** — y eso exige un **certificado de homologación** que no está disponible.
Shippear un firmador nuevo sin poder validar su salida contra ARCA violaría *"NO MARCAR COMO APROBADO ALGO
QUE NO HAYA SIDO VERIFICADO"*. Por eso se entrega como **recomendación con ruta concreta**, no como fix ciego.

---

## 5. Solución recomendada (definitiva, ordenada por preferencia)

| # | Opción | Esfuerzo | Riesgo | Recomendación |
|---|--------|----------|--------|---------------|
| **A** | **`CmsSigner` puro-JS con `node-forge`** (`pkcs7.createSignedData`, cert+key PEM en memoria, salida DER→base64), inyectado en `WsaaClient`. Mover `node-forge` a `dependencies` directas. | Medio | Bajo | ✅ **Preferida.** Elimina la dependencia de binario; portable a cualquier runtime Node (Lambda/Edge-node/container). El punto de inyección ya existe (`wsaa.ts:225`). **Debe validarse G4/G5 con cert antes de habilitar.** |
| **B** | Ejecutar la emisión en un **runtime Node dedicado** (contenedor / worker / host gestionado) con `openssl` + cert montados; sacar la firma de Netlify Functions. | Medio/Alto | Bajo | Válida si se prefiere no agregar dep de firma; agrega infra a operar. |
| **C** | **Servicio de firma externo** (HSM/KMS o microservicio de firma CMS). | Alto | Bajo (seguridad alta) | Para escala/seguridad máxima; sobredimensionado para el volumen actual. |
| **D** | Mantener `openssl` del host y **verificar su presencia en Netlify Functions** antes de habilitar. | Bajo | **Alto** | ❌ **No recomendada como solución final**: depende de un detalle no contractual del sandbox. Solo aceptable como mitigación temporal con verificación previa. |

> **Camino recomendado:** **A** (node-forge como dep directa + `CmsSigner` puro-JS) **→** correr el
> dry-run `arca-homologation-check.mjs` G4+G5 con cert de homologación **→** recién entonces marcar GATE 3 cerrado.

---

## 6. Criterio de cierre de GATE 3 (cuando haya cert)

1. Implementar `forgeCmsSigner(certPem, keyPem)` detrás de la interfaz `CmsSigner` existente.
2. Declarar `node-forge` en `dependencies` (hoy es transitiva de dev).
3. Firmar un TRA real → `LoginCms` (homologación) devuelve Token+Sign → **G4 = OK**.
4. `FECompUltimoAutorizado` con ese TA → **G5 = OK**.
5. Confirmar que el bundle de la función incluye node-forge (sin el binario `openssl`).

**Hasta completar 1–5: GATE 3 = 🔴 / PENDIENTE DE VALIDACIÓN.**

---

## 7. Aislamiento respetado

- ❌ Sin merge a `main`. ❌ Sin deploy productivo. ❌ Sin cert. ❌ Sin emitir comprobantes.
- ❌ No se modificó código en esta ejecución para este gate (solo inspección + este informe).
- ✅ Trabajo en `feature/arca-production-fase-e`.
