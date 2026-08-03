/**
 * P3-N1A0 · Prepara la corrida (H-04): elimina el reporte previo y sella un
 * stamp con el instante de arranque.
 *
 * `assert-clean-run.mjs` exige después que el reporte exista, sea POSTERIOR al
 * stamp (mtime y startTime del JSON) y describa el universo exacto. Un reporte
 * obsoleto reutilizado de una corrida anterior queda así fuera de juego: fue
 * borrado acá, y aunque alguien lo restaurara, su tiempo lo delata.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { REPORT_PATH, STAMP_PATH } from "./report-path.mjs";

mkdirSync(dirname(REPORT_PATH), { recursive: true });

// 1) El reporte anterior se ELIMINA: si Vitest no corre, no habrá reporte.
rmSync(REPORT_PATH, { force: true });

// 2) Stamp de esta corrida: nonce + instante de arranque.
const stamp = {
  nonce: randomBytes(16).toString("hex"),
  t0: Date.now(),
};
writeFileSync(STAMP_PATH, JSON.stringify(stamp));

console.log(`P3_N1A0_RUN_PREPARED (nonce ${stamp.nonce.slice(0, 8)}…)`);
