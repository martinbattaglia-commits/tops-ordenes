import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const PROJECT_REF = "arsksytgdnzukbmfgkju";
const PROJECT_NAME = "tops-ordenes-prod";
const SITE_URL = "https://nexus.logisticatops.com";
const RECOVERY_REDIRECT = `${SITE_URL}/auth/recovery`;
const INVITE_REDIRECT = `${SITE_URL}/auth/invite`;
const API = "https://api.supabase.com/v1";
const token = process.env.SUPABASE_ACCESS_TOKEN;

function stop(reason) {
  console.error(`AUTH RECOVERY CONFIG FAIL — ${reason}`);
  process.exit(1);
}

// R4 — Verificación inmediata de AUTH_TRANSITION_SECRET (presencia y entropía >= 32 chars)
const transitionSecret = process.env.AUTH_TRANSITION_SECRET?.trim();
if (!transitionSecret) {
  stop("AUTH_TRANSITION_SECRET ausente en el entorno");
}
if (transitionSecret.length < 32) {
  stop("AUTH_TRANSITION_SECRET tiene longitud insuficiente (< 32 caracteres)");
}

if (!token) stop("SUPABASE_ACCESS_TOKEN ausente");

async function getJson(path) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
  });
  if (!response.ok) stop(`consulta read-only rechazada (${response.status})`);
  return response.json();
}

const [project, authConfig, localRecoveryTemplate, localInviteTemplate] = await Promise.all([
  getJson(`/projects/${PROJECT_REF}`),
  getJson(`/projects/${PROJECT_REF}/config/auth`),
  readFile(new URL("../supabase/templates/recovery.html", import.meta.url), "utf8"),
  readFile(new URL("../supabase/templates/invite.html", import.meta.url), "utf8"),
]);

if (project?.id !== PROJECT_REF || project?.name !== PROJECT_NAME) {
  stop("identidad del proyecto no coincide");
}
if (authConfig?.site_url !== SITE_URL) stop("Site URL no coincide");

const allowlist = String(authConfig?.uri_allow_list ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (!allowlist.includes(RECOVERY_REDIRECT)) stop("redirect de recovery ausente del allowlist");
if (!allowlist.includes(INVITE_REDIRECT)) stop("redirect de invite ausente del allowlist");

const remoteRecoveryTemplate = authConfig?.mailer_templates_recovery_content;
const remoteInviteTemplate = authConfig?.mailer_templates_invite_content;
if (typeof remoteRecoveryTemplate !== "string") stop("plantilla Recovery hospedada no verificable");
if (typeof remoteInviteTemplate !== "string") stop("plantilla Invite hospedada no verificable");
const digest = (value) => createHash("sha256").update(value).digest("hex");
if (digest(remoteRecoveryTemplate) !== digest(localRecoveryTemplate)) stop("plantilla Recovery hospedada difiere");
if (digest(remoteInviteTemplate) !== digest(localInviteTemplate)) stop("plantilla Invite hospedada difiere");

console.log(`AUTH FLOW CONFIG PASS — project=${PROJECT_REF} site=${SITE_URL} recovery_sha256=${digest(localRecoveryTemplate)} invite_sha256=${digest(localInviteTemplate)}`);
