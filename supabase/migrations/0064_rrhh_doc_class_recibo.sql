-- CAPITAL HUMANO · CH5-b — Clase documental "recibo_sueldo".
-- Habilita clasificar los recibos de sueldo en el centro documental / legajo digital.
-- Idempotente. NO aplicado a producción desde la sesión (lo aplicás vos junto con 0062/0063).
-- Orden sugerido: 0062 → 0063 → 0064 → ingesta de recibos (script CH5-b).
-- PG15 permite ADD VALUE IF NOT EXISTS fuera de transacción explícita.

alter type public.rrhh_doc_class_t add value if not exists 'recibo_sueldo';
