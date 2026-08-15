-- PostgreSQL no permite usar una etiqueta de enum nueva en la misma
-- transaccion en la que se agrega. Esta migracion queda deliberadamente
-- aislada; las tarifas que la usan se siembran en el archivo siguiente.
alter type public.service_unit_t add value if not exists 'm2';

notify pgrst, 'reload schema';
