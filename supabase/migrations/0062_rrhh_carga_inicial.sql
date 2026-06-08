-- CAPITAL HUMANO · CH5 (v2) — Carga inicial de empleados (nómina real de los recibos
-- 05/2026 · Verotin S.A.). Idempotente: on conflict (cuil) do nothing.
-- DNI derivado de los 8 dígitos centrales del CUIL. ingreso = reconocida (de los recibos).
-- v2: modalidad_contratacion REAL por empleado (no todos tiempo_indeterminado) + es_jubilado.
-- ⚠️ Requiere 0061a aplicada antes (valores de enum + columna es_jubilado).
--    Secuencia: 0061a → 0062 → 0063 → 0064 → CH5-b.
-- NO incluye remuneración (no se modela) ni datos bancarios (ver 0063).
-- NO aplicado a producción desde la sesión.
--
-- Modalidades detectadas en los recibos (campo "MODALIDAD DE CONTRATACIÓN"):
--   tiempo_indeterminado : 1,3,6,7,8,9,10,11,14,15,23  (11 · "A tiempo completo indeterminado")
--   tiempo_parcial       : 16,21,22,25                 (4  · "A tiempo parcial")
--   director             : 4,13                         (2  · "LRT Directores SA")
--   periodo_prueba       : 26,27                        (2  · "Nuevo período de prueba")
--   es_jubilado=true     : 26                           (1  · obs. recibo "Empleado Jubilado")

insert into public.rrhh_empleados
  (public_id, apellido_nombre, dni, cuil, fecha_ingreso, fecha_reconocida, categoria, seccion, calificacion, modalidad_contratacion, estado, es_jubilado)
values
  (1 ,'Reynoso, Juan Carlos'             ,'14824517','20-14824517-8','1988-04-01','1988-04-01','MAESTRANZA C'         ,'MAESTRANZA'             ,'ENCARGADO DE DEPOSITO','tiempo_indeterminado','activo',false),
  (3 ,'Fernandez, Carlos Miguel'         ,'18345361','20-18345361-1','2004-03-18','2004-03-18','CONDUCTOR CAT. 2'     ,'INGENIERIA Y PRODUCCION','CHOFER'              ,'tiempo_indeterminado','activo',false),
  (4 ,'Fernandez Battaglia, Martin'      ,'28032178','20-28032178-9','2006-08-01','2006-08-01','DIRECTOR'             ,'GERENCIA GENERAL'       ,'AGENTE CONTABLE'     ,'director'            ,'activo',false),
  (6 ,'Martinez, Victor Nicolas'         ,'17833256','20-17833256-3','2010-05-17','2010-05-17','OPERARIO CATEG. 4'    ,'INGENIERIA Y PRODUCCION','OPERARIO 4'          ,'tiempo_indeterminado','activo',false),
  (7 ,'Rodriguez Silva, Jose Luis'       ,'94837779','23-94837779-9','2012-04-18','2012-04-18','ADMINIST. VTAS. CAT 3','MARKETING Y VENTAS'     ,'ADMINIST DE VENTAS'  ,'tiempo_indeterminado','activo',false),
  (8 ,'Rodriguez Ayala, Eliezer'         ,'94838520','20-94838520-2','2012-03-01','2012-03-01','CONDUCTOR CAT. 2'     ,'INGENIERIA Y PRODUCCION','CHOFER'              ,'tiempo_indeterminado','activo',false),
  (9 ,'Serrano Zapata, Jaime Alberto'    ,'95021287','20-95021287-0','2012-12-06','2012-12-06','MAESTRANZA A'         ,'MAESTRANZA'             ,'MAESTRANZA'          ,'tiempo_indeterminado','activo',false),
  (10,'Merino, Jorge Gabriel'            ,'24011564','20-24011564-7','2015-04-14','2015-04-14','GERENCIA GENERAL'     ,'GERENCIA GENERAL'       ,'GERENTE GENERAL'     ,'tiempo_indeterminado','activo',false),
  (11,'Alba, Cynthia Paola'              ,'29245752','27-29245752-4','2015-08-10','2015-08-10','ADMINISTRATIVO A'     ,'ADMINISTRACION'         ,'ADMINISTRACION'      ,'tiempo_indeterminado','activo',false),
  (13,'Fernandez Calvo, Angel Benito'    ,'04416209','20-04416209-2','2017-07-01','2017-07-01','DIRECTOR'             ,'DIRECCION'              ,'DIRECTIVO'           ,'director'            ,'activo',false),
  (14,'Silva Nuñez, Manuel Fernando'     ,'95555080','20-95555080-4','2018-05-14','2018-05-14','OPERARIO CAT 3'       ,'INGENIERIA Y PRODUCCION','OPERARIO 3'          ,'tiempo_indeterminado','activo',false),
  (15,'Velazquez, Jose Ezequiel'         ,'41969130','20-41969130-6','2018-05-16','2018-05-16','CONDUCTOR CAT. 2'     ,'INGENIERIA Y PRODUCCION','CHOFER'              ,'tiempo_indeterminado','activo',false),
  (16,'Mendoza, Ricardo Anibal'          ,'12644035','23-12644035-9','2018-10-05','2018-10-05','MAESTRANZA A'         ,'MAESTRANZA'             ,'SERENO'              ,'tiempo_parcial'      ,'activo',false),
  (21,'Rodriguez Rodriguez, Silvio Ivan' ,'96182735','27-96182735-9','2022-04-01','2022-04-01','OPERARIO CAT 4'       ,'INGENIERIA Y PRODUCCION','OPERARIO 4'          ,'tiempo_parcial'      ,'activo',false),
  (22,'Gonzalez, Valentina Silvia'       ,'28311907','27-28311907-1','2022-10-03','2022-10-03','MAESTRANZA A'         ,'MAESTRANZA'             ,'LIMPIEZA'            ,'tiempo_parcial'      ,'activo',false),
  (23,'Carrasquero Jimenez, Ruth Ylianis','19102426','27-19102426-0','2023-02-01','2023-02-01','ADMINISTRATIVO A'     ,'ADMINISTRACION'         ,'ADMINISTRACION'      ,'tiempo_indeterminado','activo',false),
  (25,'Ojeda, Juan Carlos'               ,'17832359','20-17832359-9','2025-07-04','2025-07-04','MAESTRANZA A'         ,'MAESTRANZA'             ,'MAESTRANZA'          ,'tiempo_parcial'      ,'activo',false),
  (26,'Veliz, Ramon Nestor'              ,'12835097','20-12835097-8','2025-09-27','2025-09-27','MAESTRANZA A'         ,'MAESTRANZA'             ,'PORTERO'             ,'periodo_prueba'      ,'activo',true ),
  (27,'Guadalupe, Alberto Jorge'         ,'18072454','20-18072454-1','2026-01-14','2026-01-14','MAESTRANZA A'         ,'MAESTRANZA'             ,'SERENO'              ,'periodo_prueba'      ,'activo',false)
on conflict (cuil) do nothing;

-- Evitar colisión futura de public_id (se insertaron legajos explícitos).
select setval('public.rrhh_empleado_legajo_seq', greatest((select max(public_id) from public.rrhh_empleados), 27), true);
