-- =========================================================================
-- ROLLBACK LÓGICO · 0257 · SE RETIRA LA CREADORA HEREDADA DE CASOS
--
-- Inversa lógica e IDEMPOTENTE de 0257. NO es forward.
--
-- Devuelve `public.upsert_custody_integrity_assessment` al estado exacto que
-- `0223:159-160` dejó: revocada para `public` y `anon`, concedida a
-- `authenticated`.
--
-- ─── QUÉ SIGNIFICA EJECUTAR ESTO, ESCRITO PARA QUE QUEDE ─────────────────
--
-- Ejecutarlo REABRE la superficie que 0257 cerró: cualquier sesión
-- autenticada vuelve a poder crear, por PostgREST, casos de custodia
-- `packing_unit` o `shipment` que la pantalla NO puede decidir, porque
-- `decide_custody_integrity` (v1) sigue revocada desde `0250a:2199-2200` y
-- este rollback NO la reconcede.
--
-- Es decir: el estado al que vuelve es exactamente el estado inconsistente
-- que HN-1 describe. Se escribe igual, porque un rollback existe para poder
-- retirar un cambio que salió mal y esta migración debe ser reversible como
-- cualquier otra; pero quien lo ejecute debe saber que no está restaurando
-- una capacidad de negocio —no hay ningún consumidor que la use— sino
-- reabriendo un privilegio sin camino.
--
-- NO reconcede `decide_custody_integrity` (v1) a ningún rol: eso no es la
-- inversa de 0257 y sería reinstalar por simetría algo que nadie decidió.
--
-- No borra identidades, eventos, evidencias, intentos, decisiones,
-- certificados ni auditoría. No toca ninguna otra función.
-- =========================================================================

revoke all on function public.upsert_custody_integrity_assessment(
  text, uuid, int, uuid, uuid, text, text[]
) from public, anon, authenticated;

grant execute on function public.upsert_custody_integrity_assessment(
  text, uuid, int, uuid, uuid, text, text[]
) to authenticated;

notify pgrst, 'reload schema';
