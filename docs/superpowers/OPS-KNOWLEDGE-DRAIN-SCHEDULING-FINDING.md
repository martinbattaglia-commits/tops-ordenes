# OPS · Hallazgo operativo — Knowledge drain SIN scheduling activo en producción

> **Read-only.** Detectado durante la planificación/verificación de F4.1 (2026-07-01).
> **Fuera del alcance de F4.1 por decisión de Dirección (D-F41-9): NO se arregla acá.**
> Requiere ventana/autorización separada.

## Hallazgo

El worker de Knowledge (E2.1, mig `0133` + route `/api/knowledge/drain` + workflow
`.github/workflows/knowledge-drain.yml`, cron */5) **no está corriendo programado en prod**:

1. **El workflow no existe en GitHub**: `gh api repos/{owner}/{repo}/actions/workflows` lista solo
   5 workflows activos (caja-chica, clientify, compliance, contratos, supabase-backup).
   `knowledge-drain.yml` vive en el árbol local (ramas no pusheadas) pero **no en `origin/main`**
   (default branch, detenida en `3ea0de1`) — y los `schedule` de GH Actions **solo corren desde la
   default branch**. El deploy por Netlify CLI no publica workflows.
2. **El secret `APP_URL` no existe** en GitHub (secrets reales: `CRON_SECRET`, `GCP_SA_KEY`,
   `GCS_BUCKET`, `SUPABASE_DB_URL`); el workflow caería al default `https://tops-ordenes.netlify.app`.

## Impacto

- La cola `knowledge_events` **puede estar acumulando `pending`** desde el apply de E2.1
  (la capa DB emite eventos en prod; el drenaje programado nunca corrió). El route manual con
  `CRON_SECRET` sí funciona (probado en su momento), pero nadie lo invoca periódicamente.
- El precedente "worker probado en prod" que asumía F4.1 aplica al **route+secret**, no al
  scheduling — por eso F4.1 usa Netlify Scheduled Function (D-F41-9) en lugar de GH Actions.

## Verificación sugerida (read-only, sin ventana)

```sql
select status, count(*) from knowledge_events group by 1;         -- ¿pending acumulados?
select max(started_at) from knowledge_worker_runs;                 -- ¿última corrida real?
```

## Opciones de remediación (para decisión de Dirección, FUERA de F4.1)

- (a) **Netlify Scheduled Function** para `/api/knowledge/drain` (mismo mecanismo que F4.1A;
  viaja con el deploy CLI; no depende de `main`). Recomendada por consistencia.
- (b) Push del workflow a `main` (bloqueado hoy por la divergencia de `main` y la regla de no-push).
- (c) Cron externo invocando el route con `CRON_SECRET`.
- En cualquier caso: primera corrida con `?dry=1` para dimensionar el backlog acumulado.

**Ninguna acción ejecutada.** Este documento es el único entregable sobre el tema en F4.1.
