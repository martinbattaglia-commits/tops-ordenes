-- ENTREGADA — F0.5.1 Knowledge Layer · 0131 — Hardening H-E1-1.
-- Cierra el EXECUTE de anon/authenticated sobre las funciones SECURITY DEFINER de knowledge.
-- Causa raíz: Supabase concede EXECUTE a anon/authenticated por ALTER DEFAULT PRIVILEGES
-- DIRECTO (no vía PUBLIC), por lo que el `revoke all from public` de 0127/0128 no los alcanza.
-- Riesgo cerrado: knowledge_emit_event es SECURITY DEFINER y escribe en knowledge_events
-- saltando RLS; un usuario authenticated podía invocarla vía PostgREST RPC (inyección).
-- 100% correctivo de privilegios. service_role y postgres conservan EXECUTE. Idempotente.

revoke execute on function public.knowledge_emit_event(public.knowledge_event_canonical) from anon, authenticated;
revoke execute on function public.knowledge_visibility_for(text, text)                    from anon, authenticated;
revoke execute on function public.knowledge_backfill_audit_log(int)                       from anon, authenticated;

-- PostgREST: refrescar caché de esquema.
select pg_notify('pgrst', 'reload schema');
