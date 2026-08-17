# 06 — Plan de validación E2E + SQL read-only + criterios de éxito

## Pruebas E2E (en orden)

### Prueba 1 — Traccar recibe el dispositivo
```txt
☐ FMC130_01 online en Traccar     ☐ FMC130_02 online en Traccar
☐ IMEI correcto (Identifier)      ☐ última posición válida (lat/lng plausibles)
☐ timestamp fresco (fixTime reciente)
```
Herramienta: UI/logs de Traccar Server. **No** seguir a Nexus hasta que esto pase.

### Prueba 2 — Traccar forwardea a Nexus
```txt
☐ POST recibido en /api/tracking/traccar-forward   ☐ Auth OK (no 401)
☐ Payload parseado (no 400)                        ☐ IMEI detectado
☐ Mapping encontrado (no 422)                      ☐ Vehículo resuelto (no 404)
```
Diagnóstico: logs de Netlify Functions (`forward.*`). Test manual con `curl`
(reemplazar `<SECRET>` e IMEI real, ya mapeado y con vehículo creado):
```bash
curl -i -X POST https://nexus.logisticatops.com/api/tracking/traccar-forward \
  -H "Authorization: Bearer <SECRET>" -H "Content-Type: application/json" \
  -d '{"device":{"uniqueId":"<IMEI_REAL>"},"position":{"latitude":-34.6,"longitude":-58.38,"speed":10,"course":90,"fixTime":"2026-06-15T12:00:00.000Z","attributes":{"batteryLevel":88}}}'
# Esperado: 200 {"ok":true,"positionId":...}
```
Chequeos negativos (sin escribir): sin Bearer → 401 · IMEI no mapeado → 422.

### Prueba 3 — Nexus guarda la posición
```txt
☐ fleet_positions recibe la fila (device FMC130-*, no IPHONE-*)
☐ fleet_vehicles.updated_at avanza (última comunicación)
☐ fleet_events: NO aplica en el piloto (motor de eventos/geocercas = fase posterior)
```
> ⚠️ No hay columna `provider`: la diferenciación es por `device_identifier`
> (`FMC130-*`). Ver SQL abajo.

### Prueba 4 — UI muestra la posición
```txt
☐ Mapa/tabla de Tracking muestra ambos camiones (FMC130-MB-01/02)
☐ Última posición fresca                ☐ No se confunde con los iPhone (device_identifier distinto)
☐ Provider "trazable" por el prefijo del device_identifier
```

## SQL read-only de auditoría (adaptado al esquema REAL — sin columna `provider`)

```sql
-- Última posición por dispositivo hardware (FMC130-*)
select v.device_identifier,
       max(p.recorded_at) as last_position,
       now() - max(p.recorded_at) as age
from fleet_positions p
join fleet_vehicles v on v.id = p.vehicle_id
where v.device_identifier like 'FMC130-%'
group by v.device_identifier
order by last_position desc;

-- Conteo de posiciones en las últimas 24 h
select v.device_identifier,
       count(*) as positions_24h,
       min(p.recorded_at) as first_position,
       max(p.recorded_at) as last_position
from fleet_positions p
join fleet_vehicles v on v.id = p.vehicle_id
where v.device_identifier like 'FMC130-%'
  and p.recorded_at > now() - interval '24 hours'
group by v.device_identifier
order by positions_24h desc;

-- Gaps > 10 min (últimos 7 días)
with ordered as (
  select v.device_identifier, p.recorded_at,
         lag(p.recorded_at) over (partition by v.device_identifier order by p.recorded_at) as prev_recorded_at
  from fleet_positions p
  join fleet_vehicles v on v.id = p.vehicle_id
  where v.device_identifier like 'FMC130-%'
    and p.recorded_at > now() - interval '7 days'
)
select device_identifier, prev_recorded_at, recorded_at,
       recorded_at - prev_recorded_at as gap
from ordered
where prev_recorded_at is not null
  and recorded_at - prev_recorded_at > interval '10 minutes'
order by gap desc;

-- Latencia extremo a extremo (created_at recepción vs recorded_at fix GPS)
select v.device_identifier,
       round(avg(extract(epoch from (p.created_at - p.recorded_at)))::numeric, 1) as avg_lag_seg,
       max(extract(epoch from (p.created_at - p.recorded_at)))                    as max_lag_seg
from fleet_positions p
join fleet_vehicles v on v.id = p.vehicle_id
where v.device_identifier like 'FMC130-%'
  and p.created_at > now() - interval '24 hours'
group by v.device_identifier;
```

> La latencia "Traccar → Nexus" pura no se aísla sin `serverTime` de Traccar;
> `created_at - recorded_at` es un proxy de frescura extremo a extremo.

## Criterios de éxito del piloto (7 días)

```txt
☐ Ambos FMC130 reportan a Traccar
☐ Ambos FMC130 forwardean a Nexus (200 en /traccar-forward)
☐ Nexus identifica correctamente cada camión (device_identifier correcto)
☐ La UI muestra posiciones frescas
☐ En movimiento: sin gaps injustificados > 10 min
☐ En reposo: reportes periódicos razonables (heartbeat 3–5 min)
☐ Latencia extremo a extremo < 60 s promedio
☐ Sin mezcla/confusión con los iPhone (device_identifier distinto)
☐ Sin cambios destructivos · sin exposición de secretos
```
