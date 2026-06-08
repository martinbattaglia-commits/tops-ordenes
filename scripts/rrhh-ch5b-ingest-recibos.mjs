/**
 * CAPITAL HUMANO · CH5-b — Ingesta de recibos de sueldo al legajo digital.
 *
 * Asocia cada página del PDF de recibos (Mayo 2026) al empleado correcto:
 *   detecta CUIL por página → agrupa → parte el PDF → sube al bucket privado
 *   `rrhh-legajo` → inserta fila en `rrhh_documents` (doc_class='recibo_sueldo').
 *
 * ⚠️ ESCRIBE EN PRODUCCIÓN (Storage + rrhh_documents). Por eso:
 *   - DRY-RUN por defecto: NO sube ni inserta nada; solo reporta el plan.
 *   - Para aplicar de verdad: `--apply` Y  CH5B_CONFIRM=APLICAR.
 *   - Requiere que 0062/0063/0064 ya estén aplicadas (empleados + clase doc).
 *
 * Requisitos:
 *   - npm i pdf-lib            (split de PDF; pdfjs-dist y pdf-parse ya están)
 *   - env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   - argv[2]: ruta al PDF de recibos (p.ej. "Recibos sueldos 2026 05.PDF")
 *
 * Uso:
 *   node scripts/rrhh-ch5b-ingest-recibos.mjs "/ruta/Recibos sueldos 2026 05.PDF"            # dry-run
 *   CH5B_CONFIRM=APLICAR node scripts/rrhh-ch5b-ingest-recibos.mjs "/ruta/recibos.pdf" --apply  # aplica
 *
 * Idempotente: omite documentos cuyo storage_path ya exista (unique bucket+path).
 * NO se ejecutó desde la sesión (preparación CH5-b).
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const PDF_PATH = process.argv[2];
const APPLY = process.argv.includes("--apply") && process.env.CH5B_CONFIRM === "APLICAR";
const PERIODO = { anio: 2026, mes: 5, label: "Mayo 2026" };
const BUCKET = "rrhh-legajo";

if (!PDF_PATH) { console.error("Falta ruta del PDF (argv[2])."); process.exit(1); }

const IS_OFFLINE = process.argv.includes("--offline");
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!IS_OFFLINE && (!SB_URL || !SK)) { console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (o usá --offline)."); process.exit(1); }

const onlyDigits = (s) => (s ?? "").replace(/\D/g, "");
const cuilFromText = (t) => {
  // CUIL: 11 dígitos, formato 20-12345678-9 / 20123456789
  const m = (t.match(/\b(\d{2})[-\s.]?(\d{8})[-\s.]?(\d)\b/) || [])[0];
  return m ? onlyDigits(m) : null;
};

async function pageTexts(buf) {
  // pdfjs-dist (legacy build, sin worker) → texto por página
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out.push(tc.items.map((x) => x.str).join(" "));
  }
  return out;
}

async function main() {
  const buf = await readFile(PDF_PATH);
  const texts = await pageTexts(buf);

  // Agrupar páginas por CUIL (1–2 páginas por recibo)
  const groups = new Map(); // cuil -> [pageIndex...]
  let currentCuil = null;
  texts.forEach((t, idx) => {
    const c = cuilFromText(t);
    if (c) currentCuil = c;
    if (!currentCuil) return;
    const g = groups.get(currentCuil) ?? [];
    g.push(idx); groups.set(currentCuil, g);
  });

  console.log(`PDF: ${PDF_PATH} · páginas: ${texts.length} · empleados detectados: ${groups.size}`);
  console.log(`Modo: ${APPLY ? "APLICAR (escribe en prod)" : "DRY-RUN (no escribe)"}`);

  // OFFLINE (dry-run pre-migración): resuelve la nómina desde 0062 sin tocar prod.
  const OFFLINE = process.argv.includes("--offline");
  let sb = null;
  let byCuil = new Map();

  if (OFFLINE) {
    const sql = await readFile(new URL("../supabase/migrations/0062_rrhh_carga_inicial.sql", import.meta.url));
    const re = /\(\s*(\d+)\s*,'([^']+)'\s*,'[^']*','(\d{2}-\d{8}-\d)'/g;
    let m;
    while ((m = re.exec(sql.toString()))) byCuil.set(onlyDigits(m[3]), { id: null, public_id: Number(m[1]), apellido_nombre: m[2], cuil: m[3] });
    console.log(`OFFLINE: nómina resuelta desde 0062 (${byCuil.size} empleados). No se consulta producción.`);
  } else {
    const { createClient } = await import("@supabase/supabase-js");
    sb = createClient(SB_URL, SK, { auth: { persistSession: false } });
    // Mapa CUIL → empleado (id, public_id) desde rrhh_empleados (deben existir: 0062)
    const { data: emps, error: empErr } = await sb.from("rrhh_empleados").select("id,public_id,cuil,apellido_nombre");
    if (empErr) { console.error("Error leyendo rrhh_empleados:", empErr.message); process.exit(1); }
    byCuil = new Map((emps ?? []).map((e) => [onlyDigits(e.cuil), e]));
    if ((emps ?? []).length === 0) { console.error("rrhh_empleados vacío → aplicá 0062 primero (o usá --offline para dry-run)."); process.exit(1); }
  }
  if (OFFLINE && APPLY) { console.error("--offline es incompatible con --apply (offline no escribe)."); process.exit(1); }

  let { PDFDocument } = {};
  if (APPLY) ({ PDFDocument } = await import("pdf-lib")); // solo se necesita al aplicar

  const retentionUntil = `${PERIODO.anio + 10}-${String(PERIODO.mes).padStart(2, "0")}-01`;
  let planeados = 0, escritos = 0, omitidos = 0, sinEmpleado = 0;

  for (const [cuil, pages] of groups) {
    const emp = byCuil.get(cuil);
    if (!emp) { console.warn(`  · CUIL ${cuil}: sin empleado en rrhh_empleados → omitido`); sinEmpleado++; continue; }
    const path = `recibos/${PERIODO.anio}/${String(PERIODO.mes).padStart(2, "0")}/legajo-${String(emp.public_id).padStart(2, "0")}-${cuil}.pdf`;
    planeados++;
    console.log(`  · legajo ${emp.public_id} ${emp.apellido_nombre} ← págs [${pages.map((p) => p + 1).join(",")}] → ${path}`);

    if (!APPLY) continue;

    // Idempotencia: ¿ya existe?
    const { data: existe } = await sb.from("rrhh_documents").select("id").eq("storage_bucket", BUCKET).eq("storage_path", path).maybeSingle();
    if (existe) { omitidos++; continue; }

    // Split: copiar las páginas del empleado a un PDF nuevo
    const src = await PDFDocument.load(buf);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, pages);
    copied.forEach((p) => out.addPage(p));
    const bytes = await out.save();
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: "application/pdf", upsert: false });
    if (up.error) { console.error(`    upload error: ${up.error.message}`); continue; }

    const ins = await sb.from("rrhh_documents").insert({
      empleado_id: emp.id,
      doc_class: "recibo_sueldo",
      storage_bucket: BUCKET,
      storage_path: path,
      sha256,
      mime_type: "application/pdf",
      file_size: bytes.length,
      titulo: `Recibo de sueldo · ${PERIODO.label}`,
      retention_class: "recibo_laboral",
      retention_until: retentionUntil,
    });
    if (ins.error) { console.error(`    insert error: ${ins.error.message}`); continue; }
    escritos++;
  }

  console.log(`\nResumen: planeados=${planeados} · escritos=${escritos} · omitidos(existían)=${omitidos} · sin_empleado=${sinEmpleado}`);
  if (!APPLY) console.log("DRY-RUN: nada fue escrito. Revisá el plan y reejecutá con --apply + CH5B_CONFIRM=APLICAR.");
}

main().catch((e) => { console.error(e); process.exit(1); });
