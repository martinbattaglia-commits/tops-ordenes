# TOPS NEXUS — RRHH · R5 FINAL VALIDATION (E1–E12)

> Validación de cierre de R5 (Documents & Storage). Metodología idéntica a R4: un único script en
> `BEGIN … ROLLBACK` (cero persistencia), resultados en **Results** (sin NOTICE), simulando actores
> con `set_config('request.jwt.claims', …)`. **Script ejecutable:** `RRHH_R5_EXECUTION_PACKAGE_V1.md`.
> Commit auditado: `9f02403`. **No ejecutado por mí** (sin acceso a la base). **Fecha:** 2026-06-07.

---

## 1. Qué valida cada control
| Test | Verifica | Esperado |
|------|----------|----------|
| **E1** | Buckets `rrhh-legajo` y `rrhh-health` existen | PASS (2 buckets) |
| **E2** | Tablas `rrhh_documents`, `rrhh_document_audit` existen | PASS |
| **E3** | RPC `emit_rrhh_signed_url(uuid,text)` existe | PASS |
| **E4** | Empleado accede a **su propio** documento | PASS |
| **E5** | Supervisor accede a `adjunto_solicitud` + `capacitacion` de su equipo | PASS |
| **E6** | Supervisor **bloqueado** para `dni`/`contrato`/`salud` (accesos indebidos = 0) | PASS |
| **E7** | RRHH (admin) acceso total (legajo + salud) | PASS |
| **E8** | Operaciones **acceso nulo** | PASS |
| **E9** | Salud solo `rrhh.admin` + dueño | PASS |
| **E10** | Cada lectura genera fila en `rrhh_document_audit` | PASS |
| **E11** | Signed URL devuelve grant `{bucket,path}` correcto | PASS |
| **E12** | Buckets privados (`public=false`) y **sin** lectura directa en `storage.objects` | PASS |

> Cobertura de Dirección: E4 (empleado), E5/E6 (supervisor D2), E7 (RRHH), E8 (operaciones),
> E9 (salud), E10 (auditoría), E11 (signed URL), E12 (buckets privados). FD-1/FD-4/FD-5/FD-10 cubiertas.

---

## 2. Ejecución
1. Abrir `RRHH_R5_EXECUTION_PACKAGE_V1.md`, copiar el bloque `BEGIN … ROLLBACK` completo.
2. Pegar en el SQL Editor de `arsksytgdnzukbmfgkju` y ejecutar **como una sola corrida**.
3. Capturar la pestaña **Results** (tabla `test | result | detail`).

Precondiciones: `0056`–`0060` aplicadas; ≥4 usuarios `auth.users` no-admin sin legajo; rol `rrhh_admin`
con permisos (0057). Si falta algo → fila `FIXTURES FAIL` con el detalle.

---

## 3. Plantilla de evidencia (pegar Results)
| test | esperado | result real | PASS/FAIL |
|------|----------|-------------|-----------|
| E1 | PASS | ____ | ☐ |
| E2 | PASS | ____ | ☐ |
| E3 | PASS | ____ | ☐ |
| E4 | PASS | ____ | ☐ |
| E5 | PASS | ____ | ☐ |
| E6 | PASS | ____ | ☐ |
| E7 | PASS | ____ | ☐ |
| E8 | PASS | ____ | ☐ |
| E9 | PASS | ____ | ☐ |
| E10 | PASS | ____ | ☐ |
| E11 | PASS | ____ | ☐ |
| E12 | PASS | ____ | ☐ |

---

## 4. Veredicto
- **Si E1–E12 = PASS** (con captura de Results):
  ```text
  R5 CLOSED
  DOCUMENTS & STORAGE COMPLETE
  READY FOR R6
  ```
- **Si alguno FALLA** → `R5 OPEN` + documentar causa (no avanzar).
- Hasta tener evidencia real: **veredicto PENDIENTE** (no se declara PASS sin la captura).

> **No abrir R6.** Esperar autorización explícita de Dirección tras evidencia PASS.

---

## 5. Notas
- Todo corre en `BEGIN … ROLLBACK` → **cero persistencia** (append-only ⇒ los fixtures serían
  imborrables con COMMIT).
- E6/E8 capturan la denegación esperada con `BEGIN/EXCEPTION` (no abortan la corrida).
- **No ejecutado por mí** (sin acceso a la base); construido contra el esquema real (`0060` @ `9f02403`).
  Para que lo ejecute yo: habilitar acceso a la base (siempre con ROLLBACK).

*Validación final R5 — protocolo + script. Veredicto pendiente de evidencia real (Results).*
