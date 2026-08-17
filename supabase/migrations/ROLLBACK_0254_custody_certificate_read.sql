-- =========================================================================
-- ROLLBACK LÓGICO · 0254 · EL CERTIFICADO SE PUEDE LEER
--
-- Inversa lógica e IDEMPOTENTE de 0254. NO es forward.
--
-- Retira la política de lectura y devuelve `custody_release_certificates` a su
-- estado previo: RLS habilitada SIN política, es decir, ninguna sesión lee.
--
-- ─── LO QUE NO DESHACE, A PROPÓSITO ──────────────────────────────────────
--
-- No borra ningún certificado emitido. La tabla es inmutable por trigger desde
-- 0250a —`prevent_custody_integrity_mutation` sobre update y delete— y una
-- inversa que borrara documentos probatorios sería justamente el ataque del que
-- el módulo protege. Al revertir, los certificados dejan de ser LEGIBLES desde
-- la aplicación; siguen existiendo, íntegros y verificables.
--
-- No toca el `grant select`, que es de 0250a y cuya inversa es la de 0250a.
-- =========================================================================

begin;

drop policy if exists custody_release_certificates_read on public.custody_release_certificates;

commit;
