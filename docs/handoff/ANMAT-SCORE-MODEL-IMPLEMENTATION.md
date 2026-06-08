# ANMAT-SCORE-MODEL-IMPLEMENTATION

**Fecha:** 2026-06-08 · **tsc PASS · build PASS** (`/anmat` 3.52 kB · 0 errores).
Reemplazo de la fórmula punitiva `100 − críticos×20 − warnings×5` por el modelo de doble score aprobado.

## Cambios
- **Eliminado** `scoreOf` / `scoreColor` (fórmula vieja, 0 referencias residuales).
- **Nuevo en `src/lib/compliance/data.ts`** (constantes parametrizables):
  - `COMPLIANCE_WEIGHTS = { Verde:1.0, Naranja:0.8, Amarillo:0.5, Rojo:0.0 }`
  - `RISK_SEVERITY = { Rojo:20, Naranja:8, Amarillo:3, Verde:0 }`
  - `RISK_K = 100`
  - `complianceScore()` = `round(Σpeso / N × 100)` (0–100, ↑ mejor)
  - `riskScore()` = `round(100·R/(R+K))` (0–100, ↑ peor)
  - `riskBand()` → Bajo ≤20 · Medio ≤40 · Alto ≤70 · Crítico >70
  - `complianceColor()` (≥90 Verde · ≥75 Amarillo · ≥60 Naranja · <60 Rojo), `riskBandColor()`, `criticalCount()`

## UI actualizada
- **Gauge principal (Sección 1):** 3 indicadores visualmente separados → **Compliance Score**, **Risk Score** (+ badge de banda), **Hallazgos Críticos** (contador + flag "ESTADO CRÍTICO" independiente). `ScoreGauge` generalizado (recibe `hex` + `caption` + `size`).
- **KPIs ejecutivos:** "Compliance Magaldi / Luján" usan `complianceScore` + `complianceColor`.
- **SedeTabs:** gauge de Compliance por sede + badges Risk/críticos/a-resolver.

## Valores actuales (33 ítems · verificados)
| Métrica | Global | Magaldi | Luján |
|---|--:|--:|--:|
| **Compliance Score** | **78** | 81 | 76 |
| **Risk Score** | **48 (Alto)** | 29 (Medio) | 34 (Medio) |
| Hallazgos críticos | 2 | 1 | 1 |

Anti-ocultamiento: el contador de críticos y el flag son independientes de los scores → un vencido nunca queda enterrado aunque CS sea 78.

Parámetros ajustables sin tocar lógica (constantes en `data.ts`). Sin escritura en prod. Sin commit/push.
