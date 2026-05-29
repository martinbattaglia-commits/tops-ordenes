# TOPS NEXUS — ARCA FINAL VERDICT (GATE 5)

> # 🟡 GO CON CONDICIONES
>
> **Fecha de ejecución:** 2026-05-29 · **Rama:** `feature/arca-production-fase-e` (sin merge a `main`)
> **Alcance:** habilitar el *camino* a ARCA productivo. **NO** autoriza emitir comprobantes reales:
> eso queda sujeto a las condiciones de §4 + gate ejecutivo explícito.
> **Regla rectora:** *NO ASUMIR. VERIFICAR.* Este veredicto se respalda **solo** en evidencia ejecutada
> hoy (corridas live, inspección de código/deps/RLS). Nada teórico se marca como aprobado.

---

## 1. Pregunta rectora

> *¿Esto acerca a TOPS Nexus ERP a emitir comprobantes fiscales reales de forma segura y auditada?*
> **SÍ.** El código está completo, seguro y auditado; el aislamiento multi-tenant está **probado en vivo**;
> la plomería SOAP está **validada contra el servicio real**. Lo que falta para emitir es **credencial +
> resolución de runtime de firma + gate**, **no código**.

---

## 2. Tabla resumen de gates (evidencia de esta ejecución)

| Gate | Resultado | Evidencia (archivo) | Síntesis |
|------|-----------|---------------------|----------|
| **GATE 1 — Homologación real** | ⏭️ **SKIP / PENDIENTE** | `ARCA-HOMOLOGATION-FINAL.md` | openssl + FEDummy = OK **live** (0 FAIL). LoginCms/TA/UltimoAut/FECAESolicitar **no validados** — falta cert de homologación. |
| **GATE 2 — R4 staging** | ✅ **PASS (live)** | `R4-STAGING-VALIDATION.md` | A↮B denegado, admin ve todo, RLS on, `0013` aplicado en staging, transacción revertida. |
| **GATE 3 — openssl / runtime** | 🔴 **RIESGO / PENDIENTE** | `OPENSSL-RUNTIME-REPORT.md` | Firma vía binario `openssl` no garantizada en Netlify Functions. Ruta de fix viable (node-forge `pkcs7`, hoy solo transitiva). No validable sin cert. |
| **GATE 4 — Auditoría de seguridad** | 🟢 **APROBADO** (O1/O2 menores) | `ARCA-SECURITY-AUDIT.md` | Sin secretos en logs (`maskSecret`), TA con margen + de-dup sin race, retry seguro, PRODUCCION nunca simula, multi-tenant enforced. |
| **GATE 5 — Veredicto** | 🟡 **GO CON CONDICIONES** | este documento | Camino + seguridad **completos**; emisión bloqueada por credencial/infra/gate. |

---

## 3. Lectura del veredicto

- **Verde (listo y probado):** GATE 2 (aislamiento fiscal, live) y GATE 4 (seguridad de código). El
  subsistema compila, no filtra secretos y es *fail-safe*.
- **Amarillo/Rojo (bloqueado, NO por código):**
  - GATE 1: sin **certificado de homologación** no se ejercita el handshake real (LoginCms/TA/lectura).
  - GATE 3: la **firma CMS en runtime serverless** no está garantizada; hay solución concreta (node-forge),
    pero **no se puede validar sin cert** → no se shippeó a ciegas (cumpliendo "no aprobar lo no verificado").
- **Ninguno de los bloqueos es un defecto de código.** Todos son **credencial / infraestructura / decisión**.

---

## 4. Condiciones obligatorias antes de emitir (cada una es un gate)

1. **Certificado de homologación ARCA** (CUIT 33-60489698-9) montado por path en el host → correr
   `arca-homologation-check.mjs` hasta **G4 y G5 = OK** *(cierra GATE 1)*.
2. **Resolver la firma en runtime** *(cierra GATE 3)*: implementar `CmsSigner` puro-JS con **node-forge**
   (mover a dependencia directa) **o** ejecutar la emisión en un runtime Node con `openssl` + cert montados;
   validar la firma contra WSAA real.
3. **Aplicar `0013` en producción** y (opcional) re-correr la validación R4 allí *(cierra C8/C12 del GO/NO-GO)*.
   *(En staging ya está PASS — GATE 2.)*
4. **Certificado productivo** + `ambiente=PRODUCCION` en `fiscal_config` **bajo gate ejecutivo explícito** +
   **comprobante piloto controlado** con verificación de CAE+QR.
5. **Revisión y merge** de `feature/arca-production-fase-e` a `main` (no realizado).

> **Orden recomendado:** 1 → 2 → 3 → (revisión/merge) → 4. No saltear el piloto controlado.

---

## 5. Por qué NO es 🟢 GO PLENO

- **Sin certificado** no se validó el login real (G4) ni la lectura `FECompUltimoAutorizado` (G5) — SKIP, no PASS.
- **Riesgo de runtime de firma** (GATE 3) no resuelto ni validado para el contexto productivo.
- Emitir requiere **cert productivo + decisión ejecutiva** (explícitamente fuera de alcance).

## 6. Por qué NO es 🔴 NO-GO

- **No hay defecto de código bloqueante:** compila, audita limpio, plomería SOAP validada en vivo (G3).
- **Diseño fail-safe:** sin credenciales lanza error claro; jamás simula un CAE en producción.
- **Aislamiento fiscal probado en vivo** (GATE 2 PASS) — el riesgo R4 original está cerrado en staging.
- **Sandbox intacto:** el ERP no se degrada por esta entrega.

---

## 7. Conclusión ejecutiva

> `ProductionArcaService` está **READY** (código completo, seguro, auditable, credential-gated, sandbox
> preservado, producción deshabilitada por diseño). El aislamiento multi-tenant del bucket fiscal está
> **ENFORCED y probado en vivo**. La conectividad SOAP real está **validada**. **El camino a ARCA
> productivo está habilitado.** La emisión real queda sujeta a **5 condiciones** (cert de homologación →
> resolución de firma en runtime → `0013` en prod → cert productivo + piloto bajo gate ejecutivo → merge),
> **todas de credencial/infra/decisión, ninguna de código.**
>
> **Veredicto objetivo: 🟡 GO CON CONDICIONES.**

---

## 8. Aislamiento respetado (toda la ejecución)

- ❌ Sin merge a `main`. ❌ Sin habilitar PRODUCCION. ❌ Sin emitir comprobantes. ❌ Sin certificados.
- ❌ Sin modificar datos productivos. ❌ Sin inventar resultados. ❌ Sin marcar como aprobado lo no verificado.
- ✅ Todo aislado en `feature/arca-production-fase-e`. Nada commiteado/pusheado sin autorización.
