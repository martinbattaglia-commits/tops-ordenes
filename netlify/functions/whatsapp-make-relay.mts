// Puente durable Nexus → Make. El webhook intenta entrega inmediata; este cron
// recupera timeouts/caídas desde la outbox sin depender de reintentos de Meta.
export default async () => {
  const base = process.env.URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.error("[whatsapp-make-relay] misconfigured");
    return new Response("misconfigured", { status: 500 });
  }
  const response = await fetch(`${base}/api/whatsapp/relay-queue?limit=1`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
  });
  // La respuesta contiene sólo contadores/códigos saneados.
  const body = (await response.text()).slice(0, 500);
  console.log(`[whatsapp-make-relay] status=${response.status} body=${body}`);
  return new Response(body, { status: response.status });
};

export const config = { schedule: "* * * * *" };
