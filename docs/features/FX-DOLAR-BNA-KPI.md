# KPI Dólar Banco Nación (venta) — Cockpit

Card de cotización que reemplaza la fecha duplicada del banner de bienvenida en
`/ejecutivo`. Muestra **exclusivamente** el dólar **Banco Nación, tipo VENTA,
par USD/ARS**. No muestra blue / MEP / CCL / tarjeta / promedio de mercado.

## Piezas

| Capa | Archivo |
|------|---------|
| Núcleo puro (parseo + orquestación) | `src/lib/fx/parse.ts` |
| Helpers puros de UI (formato + estado) | `src/lib/fx/format.ts` |
| Provider server-side (fetch + caché) | `src/lib/fx/bna-dollar.ts` |
| API route interna | `src/app/api/fx/bna/route.ts` → `GET /api/fx/bna` |
| Componente presentacional | `src/components/dashboard/DollarQuoteCard.tsx` |
| Config env | `src/lib/env.ts` (`env.fx.bna`) · `.env.example` |
| Tests | `src/lib/fx/parse.test.ts` · `src/lib/fx/format.test.ts` |

El navbar superior (`src/components/shell/Topbar.tsx`) conserva su fecha: **sólo**
se reemplazó la fecha duplicada de adentro del banner.

## Fuente de datos

- **Primaria:** criptoya `https://criptoya.com/api/bancostodos` → clave `bna`
  (Banco Nación **exacto**, no un promedio). `ask` = venta, `bid` = compra,
  `time` = epoch en segundos.
- **Fallback:** dolarapi `https://dolarapi.com/v1/dolares/oficial` — el dólar
  oficial minorista, que es la referencia del Banco Nación (`venta`, `compra`,
  `fechaActualizacion`). Al 2026-07-07 ambas fuentes coinciden en venta 1515,
  lo que valida el mapeo.

Ambas son JSON público, solo-lectura. **La cotización numérica nunca es
generativa** (Gemini no interviene en el número; "Fuente BNA" es sólo un badge).

## Frecuencia / performance

- Caché a nivel de módulo en el provider: no golpea la fuente externa en cada
  render (el Cockpit es `force-dynamic`). Refresco cada `FX_BNA_REVALIDATE_SECONDS`
  (default **600 s = 10 min**), reforzado con el Data Cache de Next
  (`next.revalidate`).
- Timeout por request: `FX_BNA_TIMEOUT_MS` (default **4000 ms**) vía `AbortController`.
- El fetch se hace server-side dentro del `Promise.all` de la página.

## Fallback / estados

`getBnaDollar()` **nunca lanza**. Estrategia: primaria → fallback → último dato
conocido (caché) → no disponible. La card refleja 4 estados:

| Estado | Cuándo | UI |
|--------|--------|----|
| `loaded` | dato fresco | valor + "Actualizado HH:mm", punto verde |
| `stale` | ambas fuentes fallaron pero hay caché | valor + "Último dato · HH:mm", punto ámbar |
| `unavailable` | sin dato ni caché | "Sin dato / No disponible · Reintentando", punto rojo |
| `loading` | skeleton (para uso client futuro) | barra shimmer (respeta reduced-motion) |

La UI nunca muestra un error crudo; siempre queda la card elegante.

## Variables de entorno

Todas **opcionales** (ver `.env.example`). Sólo van a `.env.example`, nunca a
`.env.local`:

```
FX_BNA_PRIMARY_URL=https://criptoya.com/api/bancostodos
FX_BNA_FALLBACK_URL=https://dolarapi.com/v1/dolares/oficial
FX_BNA_REVALIDATE_SECONDS=600
FX_BNA_TIMEOUT_MS=4000
```

## Cómo cambiar de proveedor

Si Banco Nación (o las fuentes actuales) publican otro endpoint:

1. Si la respuesta tiene la **misma forma**, basta cambiar la URL por env
   (`FX_BNA_PRIMARY_URL` / `FX_BNA_FALLBACK_URL`). Sin redeploy de código.
2. Si cambia la **forma del JSON**, agregar/ajustar un parser en `parse.ts`
   (`parseCriptoyaBna` / `parseDolarApiOficial` → nuevo `parseX`) que devuelva
   `FxParsed { sell, buy, updatedAt }`, y enchufarlo en `bna-dollar.ts`. Los
   parsers son puros y están cubiertos por tests.

## Limitaciones conocidas

- Banco Nación **no expone un endpoint JSON oficial estable**; se usan fuentes
  validadas de terceros que publican la cotización BNA. Por eso el adapter es
  configurable por env y el sistema degrada a "No disponible" si ambas caen.
- La card se muestra en `md+` (igual que la fecha que reemplazó); en mobile el
  banner queda como estaba, sin la card, para no alterar el layout.
- No se muestra variación %/día: las fuentes no exponen un delta confiable y
  **no se inventa**.
