# Nexus — Política de ingeniería permanente

> Reglas de ingeniería **vinculantes** para todas las fases de Nexus Link RC1+ (RC1.3, RC1.4, RC2, …)
> y, en general, para todo el ERP. Las fija Dirección y se respetan automáticamente en cada fase.
> Complementan G1–G11 (GOVERNANCE) y la EOL (Engineering Observability Layer, Parte V del spec Connect).

---

## P-1 — Guards de autorización SECDEF: fail-closed y NULL-safe (Dirección, 2026-06-30)

**Origen:** hallazgo RC12-008 (RC1.2 readiness). Las 7 RPC de moderación de `0144` usaban
`if v_role not in ('owner','moderator') and not is_admin() then raise`, que es **NULL-inseguro**:
para un usuario NO-miembro `v_role = NULL` → `NULL not in (...)` = NULL → el `if` **no dispara**
→ la operación **procede** (fail-OPEN: escalada de privilegios). Corregido aditivamente en
`0151_connect_moderation_failclose.sql` (sin tocar `0144`).

**Regla (obligatoria para toda función `SECURITY DEFINER` nueva o modificada):**

1. **Considerar explícitamente el caso `NULL`.** Un valor de autorización ausente (sin fila, columna
   nullable, lookup vacío) DEBE tratarse como *denegar*.
2. **Prohibido depender únicamente de `NOT IN` / `<>` / `!=`** (u operadores que devuelven `NULL`
   con un operando `NULL`) como única barrera de un guard de autorización.
3. **Todo guard debe ser explícitamente fail-closed.** Patrón canónico:
   ```sql
   -- DENEGAR si: no es admin Y (no hay rol  O  el rol no alcanza)
   if not public.is_admin()
      and (v_role is null or v_role not in ('owner','moderator')) then
     raise exception '...' using errcode = 'insufficient_privilege';
   end if;
   ```
   Equivalente con `coalesce`: `coalesce(v_role::text,'') not in (...)`.
4. **Anti-patrón prohibido** (NULL-inseguro):
   ```sql
   if v_role not in ('owner','moderator') and not public.is_admin() then raise; end if;  -- ❌ fail-OPEN si v_role NULL
   ```
5. Toda SECDEF conserva además: `set search_path = public, pg_temp`; `revoke … from public, anon`
   (y `authenticated` si es de máquina); `grant execute` selectivo (hardening H-E1-1).

**Checklist de conformidad** (agregar a la revisión de toda fase que escriba SECDEF):
- [ ] ¿El guard deniega cuando el valor de rol/permiso es `NULL`?
- [ ] ¿Evita basarse solo en `NOT IN`/`<>` para autorizar?
- [ ] ¿`search_path` fijo + revoke/grant correctos?
- [ ] ¿Probado el caso "actor no-miembro / sin rol" en el kit de validación?

---

*Registrada por Dirección (Martín Battaglia) el 2026-06-30 como parte del cierre de RC1.2.
Futuras fases la respetan sin necesidad de re-aprobación.*
