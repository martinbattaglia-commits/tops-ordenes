#!/usr/bin/env node
/**
 * Smoke test de Resend: verifica API key + lista dominios + envía test email.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "../.env.local"), "utf-8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);

const KEY = env.RESEND_API_KEY;
const FROM = env.RESEND_FROM_EMAIL;
const TO = process.argv[2] ?? "martin.battaglia@logisticatops.com";

if (!KEY) {
  console.error("❌ RESEND_API_KEY no configurada");
  process.exit(1);
}

console.log(`\n🔑 API Key: ${KEY.slice(0, 12)}...${KEY.slice(-6)}`);
console.log(`📧 From: ${FROM}\n`);

// 1. Listar dominios verificados
console.log("📋 Dominios verificados en Resend:\n");
const domRes = await fetch("https://api.resend.com/domains", {
  headers: { Authorization: `Bearer ${KEY}` },
});
if (!domRes.ok) {
  console.error(`❌ ${domRes.status}: ${await domRes.text()}`);
  process.exit(1);
}
const domData = await domRes.json();
const domains = domData.data ?? [];
if (domains.length === 0) {
  console.log("  (ninguno — usás solo el sandbox onboarding@resend.dev)");
} else {
  for (const d of domains) {
    const icon = d.status === "verified" ? "✅" : d.status === "pending" ? "⏳" : "❌";
    console.log(`  ${icon} ${d.name.padEnd(28)} · ${d.status} · region ${d.region}`);
  }
}

console.log(`\n📤 Enviando test email a: ${TO}\n`);

const sendRes = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: FROM,
    to: [TO],
    subject: "TOPS NEXUS · Test de integración Resend",
    html: `<!doctype html>
<html><body style="margin:0;padding:0;background:#f7f8fb;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 6px 18px rgba(5,5,85,0.1);">
  <tr><td style="background:#050555;padding:24px;color:#fff;">
    <div style="font-size:22px;font-weight:900;letter-spacing:-0.5px;">TOPS <span style="color:#C90812;font-size:11px;letter-spacing:3px;">NEXUS</span></div>
    <div style="font-size:11px;opacity:0.7;margin-top:4px;">Logistics Operating System · Verotin S.A.</div>
  </td></tr>
  <tr><td style="padding:28px;">
    <h2 style="color:#050555;margin:0 0 12px;">✅ Integración Resend OK</h2>
    <p style="color:#0b1220;font-size:14px;line-height:1.6;margin:0 0 16px;">
      Este es un email de prueba enviado desde TOPS NEXUS. Si lo recibís, la integración
      transaccional con Resend está funcionando correctamente.
    </p>
    <div style="background:#f7f8fb;padding:14px;border-radius:8px;font-family:'SF Mono',Menlo,monospace;font-size:12px;color:#5a6577;">
      Timestamp: ${new Date().toISOString()}<br>
      From: ${FROM}<br>
      Provider: Resend API v1
    </div>
    <p style="color:#8a94a6;font-size:11px;margin:18px 0 0;">
      Próximo paso: verificar dominio logisticatops.com en Resend para enviar desde ordenes@logisticatops.com.
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`,
    text: `TOPS NEXUS - Test de integración Resend\n\nEste es un email de prueba.\n\nTimestamp: ${new Date().toISOString()}\nFrom: ${FROM}\n`,
  }),
});

const sendData = await sendRes.json();
if (!sendRes.ok) {
  console.error(`❌ Send falló (${sendRes.status}):`, sendData);
  process.exit(1);
}

console.log(`✅ Email enviado · id: ${sendData.id}`);
console.log(`   Dashboard: https://resend.com/emails/${sendData.id}\n`);
