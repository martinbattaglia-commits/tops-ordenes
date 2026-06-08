-- ANMAT COCKPIT · Centro de Control Regulatorio — modelo DB-backed.
-- Fuente: COMPLIANCE-AUDIT-MASTER-REPORT (08/06/2026) · VEROTIN S.A. · 33 ítems / 2 sedes.
-- El cockpit hoy lee del dataset TS (operativo). Esta migración deja el modelo persistente
-- listo para la INGESTA AUTOMÁTICA futura (Drive → PDF → vencimientos → alertas).
-- `dias` NO se persiste (se calcula en runtime = vencimiento − hoy). Idempotente.
-- NO aplicado a producción desde la sesión.

create table if not exists public.compliance_items (
  id            text primary key,
  sede          text not null check (sede in ('MAGALDI','LUJAN')),
  categoria     text not null,
  documento     text not null,
  organismo     text,
  tipo          text,
  emision       date,
  vencimiento   date,
  frecuencia    text,
  estado        text,
  riesgo        text not null check (riesgo in ('Verde','Amarillo','Naranja','Rojo')),
  fuente        text,
  nota          text,
  docs          int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists compliance_items_sede_idx     on public.compliance_items(sede);
create index if not exists compliance_items_riesgo_idx   on public.compliance_items(riesgo);
create index if not exists compliance_items_categoria_idx on public.compliance_items(categoria);
create index if not exists compliance_items_venc_idx     on public.compliance_items(vencimiento) where vencimiento is not null;

alter table public.compliance_items enable row level security;
drop policy if exists "compliance read" on public.compliance_items;
create policy "compliance read" on public.compliance_items for select to authenticated using (true);
drop policy if exists "compliance write admin" on public.compliance_items;
create policy "compliance write admin" on public.compliance_items for all to authenticated
  using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

insert into public.compliance_items (id,sede,categoria,documento,organismo,tipo,emision,vencimiento,frecuencia,estado,riesgo,fuente,nota,docs) values
('MAG-01','MAGALDI','Habilitación','Habilitación Comercial / Ampliación (Depósito Primario 23.6)','GCABA – DGHP/AGC','Disposición / Certificado','2022-09-26',null,'Permanente (actualización s/ Ley 6.101 art.18)','Vigente','Verde','Leído','DI-2022-11141. EX-2022-34281856. Plantas Entrepiso/PA/PB. 16 operarios. Sin caducidad; exige actualización de datos.',11),
('MAG-02','MAGALDI','Impacto Ambiental','Certificado de Aptitud Ambiental (CAA) – Ciudad','GCABA – APRA / DGEVA','Certificado Ley 123 – SRE c/C','2025-04-09','2029-04-09','Renovación ~4 años','Vigente','Verde','Leído','CE-2025-20530028. Trámite 295517. Anexo VI Sin Relevante Efecto con Condiciones.',33),
('MAG-03','MAGALDI','Residuos','Generador de Residuos Peligrosos – Ciudad','GCABA – APRA / DGEVA','Certificado Ley 2214','2026-05-05','2029-05-05','Trianual','Vigente','Verde','Leído','CE-2026-21210993. Actuación 14287. Categorías Y8 e Y12.',16),
('MAG-04','MAGALDI','Residuos','Certificado Ambiental Anual (CAA) – Nación – Generador R. Peligrosos','Min. Ambiente Nación – SCyMA / DNSyPQ','CAA Ley 24.051','2022-10-06','2023-10-06','Anual','Vencido','Rojo','Leído','CRITICO. CE-2022-106880370. Renovacion EN TRAMITE (EX-2023-116887453). Vencido hace ~2,5 anios.',54),
('MAG-05','MAGALDI','Incendio','Instalación Fija Contra Incendio (IFCI) – Oblea anual','GCBA – AGC','Oblea Patente 1.898','2026-01-01','2026-12-31','Oblea anual + mant. mensual','Vigente','Verde','Leído','Oblea AGC Vigencia 2026. Mantenimiento mensual al dia. Renovar oblea 2027 en enero.',59),
('MAG-06','MAGALDI','Incendio','Prueba Hidráulica / Certificado de Mangas (hidrantes)','Empresa especializada matriculada','Certificado prueba hidráulica','2023-10-01',null,'Anual','No determinado','Amarillo','Carpeta/filename','Ultimo certificado completo Oct 2023. Verificar pruebas 2024-2025-2026.',0),
('MAG-07','MAGALDI','Seguridad','Matafuegos – Tarjetas + Control trimestral','GCBA – AGC / recargadora habilitada','Tarjeta extintor + control','2025-07-01','2026-07-31','Recarga anual + control trimestral','Próximo a vencer','Naranja','Leído','Tarjeta 37793036. Venc mantenimiento 07/2026. Control trimestral al dia. Programar recarga julio 2026.',45),
('MAG-08','MAGALDI','Simulacros','Sistema de Autoprotección (SAP) + Simulacros','GCABA – DGDCIV','Disposición Ley 5920','2025-04-14','2027-04-13','Reválida bianual + simulacros','Vigente','Verde','Leído','DI-2025-2060. Validez 2 anios. Ultimo simulacro 12/11/2025. Renovacion 2026 en curso.',71),
('MAG-09','MAGALDI','Electricidad','Puesta a Tierra (PAT) – Medición y continuidad','COPIME – Res. SRT 900/15','CETPD','2026-03-16','2027-03-16','Anual','Vigente','Verde','Leído','CETPD 811637. Prof. Farga Alejandro (Mat T014005). Vigencia 12 meses.',6),
('MAG-10','MAGALDI','Plagas','Control de Plagas – Oblea','Toro de Fuego SRL – Res. 360/APRA','Oblea control de plagas','2026-06-02','2026-07-02','Mensual','Vigente','Verde','Leído','Oblea 68358. Servicio 02/06/2026 valido hasta 02/07/2026. Renovar julio 2026.',2),
('MAG-11','MAGALDI','Agua','Limpieza de Tanques + Análisis Bacteriológico','SAKRON Servicio Integral','Certificado limpieza + potabilidad','2026-04-01','2026-10-01','Semestral','Vigente','Verde','Leído','Tratamiento Abril 2026. Agua apta para consumo. Proxima ~Octubre 2026.',29),
('MAG-12','MAGALDI','Habilitación','Ventilación Mecánica – Plano registrado','GCABA – DGROC','Plano/registro','2021-01-01',null,'Registro permanente','Vigente','Verde','Leído','EX-2021-05871004 / IF-2021-06131217. Integra la habilitacion.',4),
('MAG-13','MAGALDI','Seguros','Seguro de Responsabilidad Civil','Galicia Seguros S.A. (SSN)','Póliza RC','2026-05-15','2027-05-15','Anual','Vigente','Verde','Leído','Poliza 000273641. Suma asegurada 351.971.295. Vigencia 15/05/2026-15/05/2027.',4),
('MAG-14','MAGALDI','Seguros','Seguro de Incendio (Mercantil Andina / Swiss Medical)','Compañía aseguradora (SSN)','Póliza Incendio',null,null,'Anual','No determinado','Amarillo','Carpeta/filename','Polizas de incendio presentes; verificar vigencia.',0),
('MAG-15','MAGALDI','Seguridad','Capacitaciones de Seguridad e Higiene','Empresa / profesional S&H','Constancia','2024-06-01',null,'Anual','No determinado','Amarillo','Carpeta/filename','Ultima constancia Junio 2024. Verificar 2025/2026.',3),
('MAG-16','MAGALDI','ACUMAR','ACUMAR – Empadronamiento (Cuenca Matanza Riachuelo)','ACUMAR (Nación)','DDJJ Reempadronamiento','2024-09-13',null,'DDJJ anual','No determinado','Amarillo','Carpeta/filename','DJ 2022 + Acta 13/09/2024. Verificar DDJJ vigente y vinculo con CAA Nacion.',17),
('MAG-17','MAGALDI','Residuos','Manifiestos de Residuos Peligrosos + Certificado de Tratamiento','Operador/Transportista habilitado','Manifiestos + certificados','2025-01-01',null,'Por retiro','Vigente','Verde','Carpeta/filename','Manifiestos 2025 y Certificado de Tratamiento 2024-2025 presentes.',18),
('LUJ-01','LUJAN','Habilitación','Habilitación Comercial (Depósito de mercaderías en tránsito)','GCBA – AGC / DGHP','Certificado Habilitación Ley 449/2000','2011-01-01',null,'Permanente','Vigente','Verde','Leído','EXPTE 2400804/2011. Rubro 560320. Sup 6.234 m2. 5 operarios.',1),
('LUJ-02','LUJAN','Impacto Ambiental','Certificado de Aptitud Ambiental (CAA) – Ciudad','GCABA – APRA / DGEVA','Certificado Ley 123 – SRE','2024-09-06','2028-09-06','Cuatrienal','Vigente','Verde','Leído','Certificado 15251. IF-2024-33851842. Disp 731/24. Vence a los 4 anios.',26),
('LUJ-03','LUJAN','Impacto Ambiental','RAC / Impacto Acústico (Régimen de Adecuación Ambiental)','GCABA – APRA / DGEVA','RAC + IEIA','2023-01-01',null,'Según régimen','No determinado','Amarillo','Carpeta/filename','RAC-5469 / RAC-4676. IEIA 2023 + subsanacion 2024. En adecuacion.',32),
('LUJ-04','LUJAN','Incendio','Instalación Fija Contra Incendio (IFCI) – Oblea anual','GCBA – AGC','Oblea Patente 1.639','2026-01-01','2026-12-31','Oblea anual + mant. mensual','Vigente','Verde','Leído','Oblea AGC Vigencia 2026. Mantenimiento mensual al dia.',60),
('LUJ-05','LUJAN','Incendio','Prueba Hidráulica / Certificado de Mangas (hidrantes)','Empresa especializada matriculada','Certificado prueba hidráulica','2023-12-01',null,'Anual','No determinado','Amarillo','Carpeta/filename','Ultimo certificado completo Dic 2023. Verificar 2024-2025-2026.',0),
('LUJ-06','LUJAN','Seguridad','Matafuegos – Tarjetas + Control trimestral','GCBA – AGC / recargadora habilitada','Tarjeta extintor + control','2024-07-12','2026-07-31','Recarga anual + control trimestral','Próximo a vencer','Naranja','Carpeta/filename','Tarjetas vigentes (28/10/2025). Control trimestral al dia. Programar recarga 2026.',41),
('LUJ-07','LUJAN','Simulacros','Sistema de Autoprotección (SAP) + Simulacros','GCABA – DGDCIV','Reválida trámite abreviado Ley 5920','2025-07-21','2027-07-22','Reválida bianual + simulacros','Vigente','Verde','Leído','IF-2025-30291303 revalida aprobada. Simulacros 29/10/2025 y 04/03/2026.',51),
('LUJ-08','LUJAN','Electricidad','Puesta a Tierra (PAT) – Medición y continuidad','COPIME – Res. SRT 900/15','Certificado medición PAT','2025-01-01','2026-01-01','Anual','No determinado','Amarillo','Carpeta/filename','Ultimo estudio 2025 (fecha no confirmada). Verificar/realizar medicion 2026.',4),
('LUJ-09','LUJAN','Habilitación','Montacarga / Ascensor – Oblea anual + Conservación','GCBA – AGC','Oblea elevador Patente 71.301','2026-01-01','2026-12-31','Oblea anual + mant. mensual','Vigente','Verde','Leído','Oblea AGC Vigencia 2026. Mantenimiento mensual al dia. Seguro Pza 266262.',93),
('LUJ-10','LUJAN','Habilitación','Conservación Edilicia (Ley 257 – Fachadas)','GCBA – AGC','Certificado de Conservación','2022-06-10','2026-06-10','Cuatrienal','Próximo a vencer','Naranja','Leído','CRITICO INMINENTE. Certificado 62902 (Ing. Holm Mat 15464). Vence 10/06/2026.',3),
('LUJ-11','LUJAN','Plagas','Control de Plagas – Oblea','Empresa habilitada – Res. 360/APRA','Oblea control de plagas','2026-06-01','2026-07-01','Mensual','Vigente','Verde','Carpeta/filename','Obleas mayo y junio presentes. Renovar julio 2026.',2),
('LUJ-12','LUJAN','Agua','Limpieza de Tanques + Análisis Bacteriológico','SAKRON Servicio Integral','Certificado limpieza + potabilidad','2026-01-01','2026-07-01','Semestral','Vigente','Verde','Leído','Tratamiento Enero 2026. Agua apta. Proxima ~Julio 2026.',24),
('LUJ-13','LUJAN','Incendio','Carga de Fuego (cálculo por sector)','COPIME – Ley 19.587 / Dec 351/79','Estudio de carga de fuego','2024-04-26',null,'Recalcular ante cambios','Vigente','Verde','Leído','Sectores 1,2,6,8 (abril 2024). Ing. Molinari (Mat 12088).',6),
('LUJ-14','LUJAN','ACUMAR','ACUMAR – Empadronamiento (REAMAR / CURT)','ACUMAR (Nación)','DDJJ Electrónica','2023-01-01',null,'DDJJ anual','No determinado','Amarillo','Leído','REAMAR CURT 97011223860. Actividad 522099. Acta 08-2023. Verificar DDJJ vigente.',8),
('LUJ-15','LUJAN','ANMAT','Proyecto ANMAT (Propuesta de habilitación de depósito)','ANMAT (Nación) – pendiente','Propuesta de proyecto',null,null,'N/A (proyecto)','Faltante / En proyecto','Rojo','Leído','CRITICO. No existe habilitacion ANMAT formal: solo propuesta. Requiere habilitacion de deposito, Director Tecnico y disposiciones.',1),
('LUJ-16','LUJAN','Seguros','Seguro (Póliza 88984)','Compañía aseguradora (SSN)','Póliza',null,null,'Anual','No determinado','Amarillo','Carpeta/filename','Poliza 88984 presente; verificar cobertura y vigencia.',1)
on conflict (id) do nothing;

-- ── FUTURO (arquitectura preparada · NO crear aún) ───────────────────────────
-- compliance_documents : 1 fila por archivo de Drive (storage_path, sha256, item_id FK,
--                        fecha_extraida, organismo_detectado) para ingesta automática.
-- compliance_alerts    : alertas materializadas 30/60/90 (item_id, nivel, due_date,
--                        notificado_mail, notificado_nexus) para el motor de avisos.
-- compliance_ingest_log: trazas de cada corrida de ingesta (Drive → PDF → parse).
