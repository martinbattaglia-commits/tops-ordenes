# TOPS NEXUS — R4 STAGING VALIDATION (GATE 2)

> **Estado:** ✅ **PASS — aislamiento cross-tenant del bucket `invoices` ENFORCED en staging (live)**
> **Fecha de ejecución:** 2026-05-29 · **Rama:** `feature/arca-production-fase-e`
> **Target:** Supabase **STAGING** `vrxosunxlhohmqymxots` (confirmado por código; **NO** producción)
> **Persistencia:** ❌ ninguna — todo dentro de una transacción `begin … rollback`.
> **Regla rectora:** *NO ASUMIR. VERIFICAR.* La evidencia de abajo es de una corrida **real** de hoy.

---

## 1. Qué exige el gate

Verificar la migración R4 y construir un escenario real Cliente A / Cliente B que **demuestre**:
A→A = OK, B→B = OK, **A→B = DENEGADO**, **B→A = DENEGADO**, registrando SQL, resultado y evidencia.

---

## 2. Estado de la policy en staging (R0/R1 — live)

`scripts/r4-invoices-isolation-validation.sql` ejecutado contra el ref staging confirmó que **`0013` está
aplicado** y RLS activo:

```
        policyname         |  cmd   |  qual (resumen)
---------------------------+--------+----------------------------------------------------------
 invoices delete admin obj | DELETE | bucket='invoices' AND current_role()='admin'
 invoices read scoped      | SELECT | bucket='invoices' AND ( current_role() IN
                           |        |   (admin,operaciones,supervisor)
                           |        |   OR split_part(name,'/',1) =
                           |        |        (SELECT client_id::text FROM profiles
                           |        |          WHERE id = auth.uid()) )
 invoices update internal  | UPDATE | bucket='invoices' AND current_role() IN (admin,operaciones,supervisor)
 invoices write internal   | INSERT | (with check)
(4 rows)

RLS storage.objects: relrowsecurity = t
```

- ✅ La policy de **lectura** usa `split_part(name,'/',1) = profiles.client_id` (mismo patrón enforced que
  `documents`). La policy insegura `invoices bucket internal` **ya no existe**.

---

## 3. Escenario real y simulación de usuario

- Fixtures reales (porque `profiles.id` es FK a `auth.users(id)` — verificado; no se inventan perfiles):
  - **Cliente A:** user `aaaaaaaa-…-0001`, `client_id = 11111111-…-00a1`
  - **Cliente B:** user `bbbbbbbb-…-0002`, `client_id = 22222222-…-00b2`
  - **Admin staff:** `eeeeeeee-…-0005`
- Se sembraron 2 objetos fiscales (uno por client_id) prefijados por `client_id/…` (canon
  `buildInvoicePdfPath`), dentro de `begin … rollback`.
- Simulación de identidad por consulta:
  `set local role authenticated; select set_config('request.jwt.claim.sub', <uid>, true);`
  ⇒ `auth.uid()` = ese uid; `current_role()` = `profiles.role` de ese uid.

---

## 4. Resultado en vivo (esta ejecución — evidencia real)

```
== Q1: Cliente A ==
 a_total_visible | a_ve_propio | a_ve_de_b_debe_0
-----------------+-------------+------------------
               1 |           1 |                0      ← A ve lo suyo, NO ve a B

== Q2: Cliente B ==
 b_total_visible | b_ve_propio | b_ve_de_a_debe_0
-----------------+-------------+------------------
               1 |           1 |                0      ← B ve lo suyo, NO ve a A

== Q3: Staff admin ==
 admin_total_visible
---------------------
                   2                                   ← admin ve TODOS

== VEREDICTO R4 ==
               veredicto_r4
------------------------------------------
 PASS — aislamiento cross-tenant ENFORCED

== R4 VALIDATION COMPLETE (transacción revertida; sin cambios persistidos) ==
```

| Caso | Esperado | Observado | ✓ |
|------|----------|-----------|----|
| A ve su propio comprobante | 1 | 1 | ✅ |
| A ve comprobante de B | **0 (DENEGADO)** | 0 | ✅ |
| B ve su propio comprobante | 1 | 1 | ✅ |
| B ve comprobante de A | **0 (DENEGADO)** | 0 | ✅ |
| Admin ve todos | 2 | 2 | ✅ |
| Veredicto automático | PASS | PASS | ✅ |

---

## 5. Veredicto del gate

✅ **GATE 2 = PASS (live).** El aislamiento cross-tenant del bucket fiscal `invoices` está **enforced en
staging**: ningún cliente ve comprobantes de otro; el staff con rol interno ve todo. Migración `0013`
aplicada y verificada. Transacción revertida → **cero cambios persistidos**.

---

## 6. Condición remanente (fuera de este gate)

Aplicar `0013` en **producción** sigue pendiente (gate de despliegue, requiere autorización). El código y
el SQL están listos y probados en staging; el cierre pleno de C8/C12 (ver GO/NO-GO) exige aplicar `0013` en
prod y, opcionalmente, re-correr esta validación allí.

---

## 7. Aislamiento respetado

- ✅ Target staging confirmado (`vrxosunxlhohmqymxots`), **no** producción.
- ❌ Sin persistir datos (rollback). ❌ Sin merge a `main`. ❌ Sin tocar producción.
- ✅ Trabajo en `feature/arca-production-fase-e`.
