# CRM360-PREFILL-ARCHITECTURE

**Fecha:** 2026-06-08 · P2 — cómo CRM360 consume la precarga del deep link y abre Capacidad con la unidad seleccionada.

## Cadena de precarga (server → client)
```
[id]/page.tsx  (server, force-dynamic)
  searchParams { resSite, resUnit, resCat, resM2 }
        │  valida resSite + resUnit
        ▼
  prefill = { site, unit, category, m2:Number|null } | null
        │  prop
        ▼
Opportunity360View  (client)
  validPrefill = prefill && site ∈ KNOWN_SITES ? prefill : null
  tab inicial = validPrefill ? "capacidad" : "resumen"
        │  prop
        ▼
CapacidadTab  (client)
  initialSite = prefill.site  (prioridad sobre o.assignedSite)
  prefillAvailable = prefill.unit ∈ bySite[site].available
  sel inicial = prefillAvailable ? [prefill.unit] : []
  + banner "Precargada desde el mapa: <unit>"
```

## Reglas de resolución
1. **Validación de sede:** `prefill` se descarta si `resSite` no está en `KNOWN_SITES` (`MAGALDI_1765`, `PEDRO_LUJAN_3159`). Defensa ante params manipulados.
2. **Tab inicial:** con `validPrefill` la ficha abre directamente en **Capacidad** (no en Resumen). Sin prefill, comportamiento previo intacto (Resumen).
3. **Sede inicial:** la precarga **tiene prioridad** sobre `o.assignedSite`. Si no hay prefill, se conserva la lógica anterior (sede asignada de la oportunidad).
4. **Preselección de unidad:** solo se preselecciona si la unidad **sigue disponible** en `crm_units` (`state='disponible'`) en esa sede. Si ya no lo está (otro la reservó entre que se abrió el mapa y se entró a CRM360), no se preselecciona y el banner avisa: _"Ya no figura disponible en crm_units; elegí otra unidad disponible abajo."_ — esto evita prometer una reserva que `crm_reserve_units` rechazaría.

## Fuente de la disponibilidad
`unitData.bySite[site].available` proviene de `getAvailableUnits(site)` (E3, lee `crm_units` con `state='disponible'`). La preselección **no** confía en el `resM2`/`resCat` del query string para decidir disponibilidad: confía en `crm_units`. Los params del mapa son solo contexto visual.

## Qué NO hace la precarga
- **No reserva.** Solo selecciona en el selector. La reserva real es una acción explícita del comercial (botón "Reservar unidad" → `reserveCapacity` → `crm_reserve_units`).
- **No crea la oportunidad.** El deep link lleva a la lista; el comercial elige sobre qué oportunidad precargar (o crea una). El contexto se propaga por query string a los 3 links de ficha.
- **No escribe estado de servidor** hasta la confirmación.

## Componentes / props nuevas
| Componente | Prop nueva | Tipo |
|---|---|---|
| `Opportunity360View` | `prefill` | `CapacityPrefill \| null` |
| `CapacidadTab` | `prefill` | `CapacityPrefill \| null` |

`CapacityPrefill = { site: string; unit: string; category: string \| null; m2: number \| null }` (exportada desde `Opportunity360View.tsx`).
