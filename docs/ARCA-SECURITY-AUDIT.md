# TOPS NEXUS — ARCA SECURITY AUDIT (GATE 4)

> **Estado:** 🟢 **APROBADO con 2 observaciones menores (no bloqueantes)**
> **Fecha de ejecución:** 2026-05-29 · **Rama:** `feature/arca-production-fase-e`
> **Alcance:** `wsaa.ts`, `wsfev1.ts`, `soap.ts`, `logger.ts`, `production-service.ts` + RLS bucket fiscal.
> **Regla rectora:** *NO ASUMIR. VERIFICAR.* Cada hallazgo cita archivo:línea inspeccionados hoy.

---

## 1. Manejo de certificado y clave privada

| Control | Resultado | Evidencia |
|---------|-----------|-----------|
| Clave privada fuera de repo/DB | ✅ | Se referencia **solo por path** (`certPath`/`keyPath`); `wsaa.ts:90` lee los archivos con `readFile`. No hay material PEM en código ni migraciones. |
| Sin credenciales en PRODUCCION → error, nunca CAE falso | ✅ | `production-service.ts:117-126` + `requireReady()` (`:165`) lanza `ArcaConfigError`; PRODUCCION nunca instancia fallback. |
| Cert/clave nunca logueados | ✅ | No se loguea contenido de archivos; solo el **hash sha256 truncado (12 hex)** del CMS (`wsaa.ts:243`). |

---

## 2. Secretos en logs (Token / Sign / CMS / clave)

| Control | Resultado | Evidencia |
|---------|-----------|-----------|
| `maskSecret` no expone valor | ✅ | `logger.ts:31-34` → devuelve `len=N` o `∅`; **nunca** el valor. |
| Token/Sign enmascarados | ✅ | `wsaa.ts:240-241` loguea `token: maskSecret(...)`, `sign: maskSecret(...)`. |
| CMS solo por hash truncado | ✅ | `wsaa.ts:243` `cmsHash = sha256(cms).slice(0,12)`. No se loguea el CMS. |
| CUIT enmascarado en emisión | ✅ | `production-service.ts:276,291` `cuit: maskSecret(emisor.cuit)`. |
| CAE enmascarado (largo, no valor) | ✅ | `production-service.ts:281` `cae: len=N` / `∅`. |
| Logger estructurado de 1 línea | ✅ | `logger.ts:36-41` JSON single-line, parseable. |

**Hallazgo: no se detectó ninguna ruta que escriba Token/Sign/clave/CMS en claro.**

---

## 3. Cache de TA, expiración y concurrencia

| Control | Resultado | Evidencia |
|---------|-----------|-----------|
| TA cacheado con margen de seguridad | ✅ | `wsaa.ts:194-197` `isValid()` resta `marginSeconds*1000` (default 600s) antes de reutilizar. |
| De-dup de login concurrente (sin race) | ✅ | `wsaa.ts:200-216` usa `inflight` Map: logins concurrentes con misma key comparten una sola promesa; `.finally` limpia. |
| Invalidación tras AuthError + retry-once | ✅ | `production-service.ts:228-232,264-266` `invalidate()` + 1 reintento; `wsaa.ts:218-221`. |
| Detección de error de auth acotada | ✅ | `production-service.ts:197-205` códigos 600-699 o regex token/sign/ticket/expir. |

---

## 4. Errores SOAP, timeouts y reintentos

| Control | Resultado | Evidencia |
|---------|-----------|-----------|
| Timeout por request (AbortController) | ✅ | `soap.ts:66-67,102` default 15s. |
| Reintentos solo para transitorios (red/5xx) | ✅ | `soap.ts:81-93` 5xx→retry; 4xx→no-retry; Fault→no-retry (`:96` "negocio: no reintentar"). |
| Backoff exponencial + jitter | ✅ | `soap.ts:107-109` `500*2^attempt + rand(250)`. |
| SOAP Fault detectado y propagado | ✅ | `soap.ts:118-129` `extractFault` (1.1 y 1.2). |

---

## 5. Fallback y aislamiento de ambiente (defensa en profundidad)

| Control | Resultado | Evidencia |
|---------|-----------|-----------|
| PRODUCCION **jamás** cae a Mock | ✅ | `production-service.ts:119` `if (ambiente==="PRODUCCION" \|\| !allowFallback)` → sin fallback. |
| Fallback Mock solo en HOMOLOGACION + flag | ✅ | `production-service.ts:127-136`, logueado `arca.fallback.mock` (warn). |
| URLs oficiales fijas por ambiente | ✅ | `production-service.ts:46-55`; override explícito solo por env. |
| Sandbox (Mock) intacto | ✅ | `mock-service.ts` sin cambios (no aparece en `git status`). |

---

## 6. Multi-tenant (bucket fiscal)

| Control | Resultado | Evidencia |
|---------|-----------|-----------|
| Aislamiento cross-tenant del bucket `invoices` | ✅ | **GATE 2 PASS live** (`R4-STAGING-VALIDATION.md`): A↮B denegado, admin ve todo, RLS on. |

---

## 7. Observaciones menores (no bloqueantes)

| # | Observación | Riesgo | Recomendación |
|---|-------------|--------|---------------|
| **O1** | `wsaa.ts:118` incluye el **stderr de `openssl`** en el mensaje de `WsaaAuthError`. Puede filtrar **paths** del host (no secretos) a logs de error. | Bajo | Truncar/normalizar stderr antes de propagarlo, o loguear solo el `code`. |
| **O2** | El cache de TA es **in-memory por proceso** (`wsaa.ts:173`). En serverless multi-instancia cada Lambda hace su propio `LoginCms` → **más logins** (no es fuga; ARCA tolera, pero conviene vigilar rate). | Bajo/operativo | Aceptable para el volumen actual; si crece, considerar cache compartido (con cuidado: el TA es sensible — cifrar en reposo). |

> Ninguna observación expone secretos ni habilita acceso cruzado. **No bloquean** el camino a producción.

---

## 8. Veredicto del gate

🟢 **GATE 4 = APROBADO (con O1/O2 menores).** El subsistema fiscal no expone secretos en logs, gestiona el
TA con margen + de-dup sin race, reintenta de forma segura, y el aislamiento de ambiente es *fail-safe*
(PRODUCCION nunca simula). El aislamiento multi-tenant está enforced (GATE 2). Las 2 observaciones son de
endurecimiento, no defectos de seguridad bloqueantes.

---

## 9. Aislamiento respetado

- ❌ Sin merge a `main`. ❌ Sin tocar producción. ❌ Sin modificar código en esta auditoría (solo lectura + informe).
- ✅ Trabajo en `feature/arca-production-fase-e`.
