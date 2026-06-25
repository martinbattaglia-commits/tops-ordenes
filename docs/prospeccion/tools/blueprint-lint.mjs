#!/usr/bin/env node
// Blueprint Linter — BB-5. Validación DETERMINÍSTICA sobre los _parts.
// Toda inconsistencia produce error de validación (exit ≠ 0).
//
// Uso: node tools/blueprint-lint.mjs [--json]

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARTS_ORDER, assemble } from './build.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PARTS_DIR = join(__dirname, '..', '_parts');
const OUTPUT = join(__dirname, '..', 'PLATAFORMA-COMERCIAL-NEXUS-ARQUITECTURA.md');

const files = Object.fromEntries(
  readdirSync(PARTS_DIR).filter((f) => f.endsWith('.md')).map((f) => [f, readFileSync(join(PARTS_DIR, f), 'utf8')])
);
const corpus = PARTS_ORDER.map((f) => files[f] || '').join('\n');

const checks = [];
const add = (name, ok, details) => checks.push({ name, ok, details });

// ── 1. Build Verification (BB-4): consolidado == cat(_parts) ─────────────────
{
  let ok = false, details = '';
  try {
    const current = readFileSync(OUTPUT, 'utf8');
    ok = current === assemble();
    details = ok ? 'consolidado == cat(_parts)' : 'consolidado difiere de cat(_parts) → regenerar (node tools/build.mjs)';
  } catch (e) { details = 'no se pudo leer el consolidado: ' + e.message; }
  add('build-verification (BB-4)', ok, details);
}

// ── 2. Referencias de reglas dentro de rango ────────────────────────────────
// max definido por familia (se actualiza al agregar reglas)
const RULE_MAX = { 'INV-PR': 8, 'AP': 17, 'NFB': 8, 'DoD': 11, 'HEX': 10, 'CC': 7, 'BB': 7 };
for (const [fam, max] of Object.entries(RULE_MAX)) {
  const re = new RegExp(`\\b${fam.replace(/[-]/g, '\\-')}-(\\d+)`, 'g');
  const nums = [...corpus.matchAll(re)].map((m) => +m[1]);
  const over = [...new Set(nums.filter((n) => n > max))];
  add(`rule-range ${fam} (≤${max})`, over.length === 0,
    over.length ? `referencias fuera de rango: ${fam}-${over.join(`, ${fam}-`)}` : `máx citado ≤ ${max} (${nums.length} citas)`);
}

// ── 3. ADR: toda cita ADR-NNN resuelve a una definición; numeración única ────
{
  const defRe = /^#{2,4}\s*ADR-(\d{3})\b/gm;
  const defByNum = {};            // num -> [files]
  for (const f of PARTS_ORDER) {
    for (const m of (files[f] || '').matchAll(defRe)) {
      (defByNum[m[1]] ??= []).push(f);
    }
  }
  const defined = new Set(Object.keys(defByNum));
  const cited = new Set([...corpus.matchAll(/\bADR-(\d{3})\b/g)].map((m) => m[1]));
  const unresolved = [...cited].filter((n) => !defined.has(n)).sort();
  add('adr-references-resolve', unresolved.length === 0,
    unresolved.length ? `ADR citados sin definición: ${unresolved.map((n) => 'ADR-' + n).join(', ')}` : `${cited.size} ADR citados, todos definidos`);

  const dups = Object.entries(defByNum).filter(([, fs]) => new Set(fs).size > 1 || fs.length > 1);
  // dup real = mismo número definido en >1 archivo (dos esquemas) o >1 vez en el mismo
  const realDups = Object.entries(defByNum).filter(([, fs]) => fs.length > 1);
  add('adr-no-duplicate-definitions', realDups.length === 0,
    realDups.length ? realDups.map(([n, fs]) => `ADR-${n} definido en ${[...new Set(fs)].join('+')}`).join('; ')
                    : `${defined.size} ADR con definición única`);
}

// ── 4. Drift anchors (deben ser 0 como uso activo) ──────────────────────────
const driftPats = [
  { name: 'nextId(): ProspectId', re: /nextId\(\):\s*ProspectId/g, allowIf: (l) => /NO existe|ARCH-001|ausencia/.test(l) },
  { name: 'fromImportRow(row, (firma vieja)', re: /fromImportRow\(row,/g, allowIf: () => false },
  { name: 'next_attempt_at (columna activa)', re: /next_attempt_at/g, allowIf: (l) => /inexistente|se descarta|no compilaba|referenciaba|ARB C-2|obsoleto/.test(l) },
  { name: 'cuatro tablas / 4 tablas', re: /\b(cuatro|4) tablas\b/g, allowIf: (l) => /24 tablas/.test(l) },
  { name: 'clientify_contact_id/deal_id como columna DDL', re: /^\s*clientify_(contact|deal)_id\s+text/gm, allowIf: () => false },
  { name: 'clientify_contact_id/deal_id como campo TS', re: /^\s*clientify_(contact|deal)_id:\s/gm, allowIf: () => false },
  { name: 'create table prospeccion_outbox (debe ser _events)', re: /create table[^\n]*prospeccion_outbox/gi, allowIf: () => false },
  { name: 'prospeccion_ai_analysis (debe ser _ai_content)', re: /prospeccion_ai_analysis/g, allowIf: (l) => /renombr|antes |ai_content|ADR-0/.test(l) },
];
for (const p of driftPats) {
  const lines = corpus.split('\n');
  const hits = lines.filter((l) => { p.re.lastIndex = 0; return p.re.test(l) && !p.allowIf(l); });
  add(`drift: ${p.name}`, hits.length === 0,
    hits.length ? `${hits.length} uso(s) activo(s): ${JSON.stringify(hits[0].trim().slice(0, 90))}` : 'sin usos activos');
}

// ── 5. DDL: índices de prospeccion_events referencian columnas existentes ────
{
  const ddl = files['35-persistencia-ddl.md'] || '';
  // columnas del CREATE TABLE prospeccion_events
  const ct = ddl.match(/create table if not exists public\.prospeccion_events \(([\s\S]*?)\n\);/i);
  let ok = false, details = 'no se encontró CREATE TABLE prospeccion_events';
  if (ct) {
    const cols = new Set(
      ct[1].split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('--'))
        .map((l) => l.split(/\s+/)[0]).filter(Boolean)
    );
    const idxRe = /create index[^\n]*\n?\s*on public\.prospeccion_events \(([^)]*)\)/gi;
    const bad = [];
    for (const m of ddl.matchAll(idxRe)) {
      const refCols = m[1].split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean);
      for (const c of refCols) if (!cols.has(c)) bad.push(c);
    }
    ok = bad.length === 0;
    details = ok ? `índices de prospeccion_events referencian solo columnas existentes (${cols.size} cols)` : `columnas inexistentes en índices: ${[...new Set(bad)].join(', ')}`;
  }
  add('ddl-events-index-columns-exist', ok, details);
}

// ── 6. Diagramas mermaid balanceados ────────────────────────────────────────
{
  const opens = (corpus.match(/```mermaid/g) || []).length;
  // cierres: contar ``` totales; deben ser pares
  const fences = (corpus.match(/```/g) || []).length;
  const ok = fences % 2 === 0 && opens > 0;
  add('mermaid-fences-balanced', ok, `bloques mermaid=${opens}, fences totales=${fences} (${fences % 2 === 0 ? 'pares' : 'IMPARES → bloque sin cerrar'})`);
}

// ── 7. Conteo F0 = 5 tablas consistente ─────────────────────────────────────
{
  const ddl = files['35-persistencia-ddl.md'] || '';
  const five = (ddl.match(/5 tablas/g) || []).length;
  const four = (ddl.match(/\b(cuatro|4) tablas\b/g) || []).filter((s) => !/24/.test(s)).length;
  add('f0-table-count (5)', five >= 1 && four === 0, `"5 tablas"×${five}, "4 tablas"×${four}`);
}

// ── 8. Las 5 tablas F0 existen como CREATE TABLE ─────────────────────────────
{
  const ddl = files['35-persistencia-ddl.md'] || '';
  const f0 = ['prospeccion_sources', 'prospeccion_prospects', 'prospeccion_events', 'prospeccion_import_jobs', 'prospeccion_crm_refs'];
  const missing = f0.filter((t) => !new RegExp(`create table if not exists public\\.${t}\\b`, 'i').test(ddl));
  add('f0-tables-created', missing.length === 0, missing.length ? `falta CREATE: ${missing.join(', ')}` : 'las 5 tablas F0 tienen CREATE TABLE');
}

// ── 9. Parts del orden canónico presentes ───────────────────────────────────
{
  const missing = PARTS_ORDER.filter((f) => !files[f]);
  add('parts-present', missing.length === 0, missing.length ? `faltan: ${missing.join(', ')}` : `${PARTS_ORDER.length} parts presentes`);
}

// ── 10. Tablas fantasma: todo prospeccion_* citado como tabla física existe ──
// (Catch del drift `prospeccion_dead_letter` que la revisión adversarial encontró.)
{
  // Identificadores legítimos: tablas del catálogo + funciones + secuencia + enum + alias lógico.
  const KNOWN = new Set([
    // 13 tablas del catálogo §1.1
    'prospeccion_sources','prospeccion_prospects','prospeccion_events','prospeccion_import_jobs',
    'prospeccion_crm_refs','prospeccion_enrichment','prospeccion_scores','prospeccion_ai_content',
    'prospeccion_human_decisions','prospeccion_timeline','prospeccion_activities','prospeccion_notes','prospeccion_metrics',
    'prospeccion_event_consumers',
    // funciones / secuencia / enum / trigger
    'prospeccion_ingest','prospeccion_set_short_id','prospeccion_pii_erase','prospeccion_prospect_seq','prospeccion_status_t',
    // alias LÓGICO del Outbox (CC-2) — no es tabla física, se permite como nombre de patrón
    'prospeccion_outbox',
  ]);
  // Excluir nombres de índice/trigger (sufijos _idx / trg_…) — no son tablas.
  const toks = [...new Set([...corpus.matchAll(/\bprospeccion_[a-z_]+\b/g)].map((m) => m[0]))]
    .filter((t) => !t.endsWith('_idx') && !t.startsWith('trg_'));
  const unknown = toks.filter((t) => !KNOWN.has(t));
  add('no-phantom-tables', unknown.length === 0,
    unknown.length ? `identificadores prospeccion_* desconocidos (¿tabla fantasma?): ${unknown.join(', ')}` : `${toks.length} identificadores prospeccion_*, todos conocidos`);
}

// ── 11. Máquina de estados: estados de 15 §15.4 ⊆ conjunto canónico (CC-7) ────
// (Catch del drift `pending_approval` como estado-máquina separado.)
{
  const CANON = new Set([
    'created','imported','enriched','scored','ai_analyzed','approved',
    'crm_sync_requested','crm_sync_completed','customer_created','rejected','duplicado',
  ]);
  const es = files['15-event-storming.md'] || '';
  // Sección §15.4: desde "## 15.4" hasta el próximo "## "
  const m = es.match(/##\s*15\.4[\s\S]*?(?=\n##\s|\n#\s|$)/);
  let bad = [];
  if (m) {
    // primera columna de filas tipo: | `estado` | ...
    for (const r of m[0].matchAll(/^\|\s*`([a-z_]+)`\s*(?:¹|\s)*\|/gm)) {
      if (!CANON.has(r[1])) bad.push(r[1]);
    }
  }
  bad = [...new Set(bad)];
  add('state-machine-subset (15 ⊆ CC-7)', bad.length === 0,
    bad.length ? `estados en 15 §15.4 fuera del conjunto canónico CC-7: ${bad.join(', ')}` : 'estados de 15 §15.4 ⊆ canónico (9 + rejected)');
}

// ── 12. Semántica de cita ADR (acotada y precisa) — regla OB-n ↔ Outbox ──────
// Las reglas OB-n (OB-1..OB-10) son del Outbox; su ADR canónico es ADR-004 (Outbox) o
// ADR-005 (Event Bus operativo). Catch preciso del mis-cite `(ADR-001/OB-4)` sin falsos
// positivos (sólo dispara cuando una cita ADR está pareada con una regla OB- en la misma cita).
// NOTA: la validación semántica GENERAL de citas ADR (¿el ADR significa lo correcto aquí?) es
// responsabilidad de la revisión SEMÁNTICA del ARB (BB-6 pasos 5-6), no del linter determinístico.
{
  const bad = [];
  for (const line of corpus.split('\n')) {
    // patrón: (ADR-NNN/OB-n) o (ADR-NNN / OB-n)
    for (const m of line.matchAll(/ADR-(\d{3})\s*\/\s*OB-\d+/g)) {
      if (m[1] !== '004' && m[1] !== '005') {
        bad.push(`regla OB- pareada con ADR-${m[1]} (Outbox = ADR-004/005): ${JSON.stringify(line.trim().slice(0, 90))}`);
      }
    }
  }
  add('adr-citation-semantics (OB↔Outbox)', bad.length === 0,
    bad.length ? bad.join(' | ') : 'citas ADR pareadas con reglas OB- apuntan a ADR-004/005');
}

// ── Reporte ─────────────────────────────────────────────────────────────────
const failed = checks.filter((c) => !c.ok);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total: checks.length, failed: failed.length, checks }, null, 2));
} else {
  console.log('── Blueprint Linter (BB-5) ──');
  for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name} — ${c.details}`);
  console.log(`\n${failed.length === 0 ? '✓ LINT OK' : '✗ LINT FALLA'}: ${checks.length - failed.length}/${checks.length} checks pasan.`);
}
process.exit(failed.length === 0 ? 0 : 1);
