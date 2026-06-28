// Falla el build si el Core de UDIE importa de cualquier contexto de dominio.
// Regla AP-UDIE-1: src/lib/udie/** no conoce ningún dominio.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/lib/udie";
// Contexts forbidden inside src/lib/udie/**:
//   • @/lib/<ctx>/* where ctx ∈ {prospeccion, clientify, recon, comercial, compliance}
//   • relative imports that leave udie and enter those contexts
//   • any **/domain/* path
const FORBIDDEN = /(from|import)\s+["'](@\/lib\/(prospeccion|clientify|recon|comercial|compliance)|\.\.\/\.\.\/(prospeccion|clientify|recon|comercial|compliance)|[^"']*\/domain\/)/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if ((p.endsWith(".ts") || p.endsWith(".tsx")) && !p.endsWith(".test.ts") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

const offenders = [];
for (const file of walk(ROOT)) {
  const src = readFileSync(file, "utf8");
  if (FORBIDDEN.test(src)) offenders.push(file);
}

if (offenders.length > 0) {
  console.error("AP-UDIE-1 VIOLADO — el Core importa de un dominio:\n" + offenders.join("\n"));
  process.exit(1);
}
console.log(`AP-UDIE-1 OK: ${ROOT} no importa de ningún contexto de dominio.`);
