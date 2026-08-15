-- ROLLBACK_0239a_nexus_link_revoke_trigger_execute.sql
--
-- Rollback documental y deliberadamente fail-closed.
--
-- La migración 0239a sólo revoca privilegios de invocación directa que nunca
-- fueron necesarios para el funcionamiento del trigger. Reotorgarlos a
-- PUBLIC, anon, authenticated o service_role reabriría exactamente la
-- exposición que el correctivo cierra. Por eso no existe una inversa segura
-- que restaure esos grants.
--
-- El rollback funcional del ciclo de uploads sigue siendo ROLLBACK_0238, que
-- elimina el binding y la función completa. Mientras 0238 permanezca aplicada,
-- esta ACL debe permanecer cerrada.

select 1; -- no-op seguro: nunca reabre EXECUTE.
