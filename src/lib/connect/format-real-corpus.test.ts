import { describe, expect, it } from "vitest";
import { isNewDay, dayLabel } from "@/lib/connect/format";

// Timestamps REALES del hilo «Gabriel Electricista» (wa:+5491162799590),
// los 12 primeros mensajes: 6 del mismo día, luego cambio de día, de mes y otro día.
const REAL = [
  "2021-09-07T15:37:00Z", "2021-09-07T15:37:00Z", "2021-09-07T15:37:00Z",
  "2021-09-07T15:37:00Z", "2021-09-07T15:51:00Z", "2021-09-07T15:51:00Z",
  "2021-09-15T15:36:00Z", "2021-09-15T15:36:00Z", "2021-09-15T15:36:00Z",
  "2021-10-12T14:26:00Z", "2021-10-12T14:26:00Z",
  "2021-10-28T17:36:00Z",
];
const NOW = new Date("2026-07-29T15:00:00Z");

describe("LINK-WA-UX-001 · corpus REAL (hilo de 5 años)", () => {
  it("inserta separador sólo cuando cambia el día", () => {
    const flags = REAL.map((iso, i) => isNewDay(iso, REAL[i - 1]));
    // 1º sí · los 5 siguientes del mismo día no · cambio de día en el 7º ·
    // cambio de mes en el 10º · nuevo día en el 12º
    expect(flags).toEqual([
      true, false, false, false, false, false,
      true, false, false,
      true, false,
      true,
    ]);
    expect(flags.filter(Boolean)).toHaveLength(4); // 4 separadores en 12 mensajes
  });

  it("las etiquetas muestran el AÑO porque el corpus es de 2021", () => {
    const labels = REAL.filter((iso, i) => isNewDay(iso, REAL[i - 1])).map((iso) => dayLabel(iso, NOW));
    expect(labels).toEqual([
      "7 de septiembre de 2021",
      "15 de septiembre de 2021",
      "12 de octubre de 2021",
      "28 de octubre de 2021",
    ]);
  });
});
