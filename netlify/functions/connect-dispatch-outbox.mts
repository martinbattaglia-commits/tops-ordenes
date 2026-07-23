// F4.1A · D-F41-9 — Netlify Scheduled Function: dispara el worker de connect_outbox cada 5 min.
// Viaja con el deploy CLI manual (no depende de GitHub Actions ni de la default branch — el cron
// de GH Actions NO es viable hoy: `main` está divergida y los schedules solo corren desde ella).
// Fuera de tsconfig (extensión .mts fuera del include **/*.ts) — sin dependencias de tipos.
//
// Netlify invoca esta función según `config.schedule`. La función NO procesa nada: delega en el
// route handler interno (auth CRON_SECRET fail-closed), que es también la superficie de ejecución
// manual para smoke/backlog. `URL` la provee Netlify (site URL productiva).

export default async () => {
  const base = process.env.URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.error("[connect-dispatch-outbox] misconfigured: falta URL o CRON_SECRET");
    return new Response("misconfigured", { status: 500 });
  }
  const res = await fetch(`${base}/api/connect/cron/dispatch-outbox`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  console.log(`[connect-dispatch-outbox] status=${res.status} body=${body.slice(0, 500)}`);
  return new Response(body, { status: res.status });
};

export const config = {
  schedule: "*/5 * * * *",
};
