/**
 * T-C2-06 · W22-TER-B/M5 — PRESENTACIÓN TRI-STATE (pura, sin base de datos).
 *
 * Vive en este árbol y no bajo `src/lib/custody/` por una razón verificable:
 * `vitest.config.ts` corre una allowlist explícita que NO incluye
 * `src/lib/custody/**`, así que un test ahí adentro existiría sin ejecutarse
 * nunca — y un test que no corre es peor que no tenerlo. Acá se ejecuta con el
 * comando oficial `npm run test:custody:db`, con exit code real, importando el
 * helper de producción por el alias `@` que ya define `vitest.custody.config.ts`.
 *
 * Se afirman dos cosas que el DB-C4 dejó explícitas:
 *   · UI y PDF distinguen los TRES estados y los nombran igual entre sí;
 *   · una respuesta legacy con `chain_valid: false` NUNCA se muestra como
 *     «Inválida»: `false` significaba dos cosas y acusar de adulteración con
 *     un dato ambiguo es exactamente el defecto que se está corrigiendo.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  presentChain,
  presentChainStatus,
  resolveChainStatus,
  type CustodyChainStatus,
} from "@/lib/custody/chain-presentation";

const ALL: CustodyChainStatus[] = ["verified", "invalid", "unverifiable"];

const REPO_ROOT = resolve(__dirname, "..", "..");
const readRepo = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

/** Vocabulario que acusa de rotura. Sólo `invalid` puede usarlo. */
const ACUSATORIO = /\bROTA\b|\bINVÁLIDA\b|\bInválida\b|\brota\b/;

describe("T-C2-06 · M5 · los tres estados se distinguen", () => {
  it("12 · UI y PDF tienen etiqueta y color propios por estado", () => {
    const ui = ALL.map((s) => presentChainStatus(s).uiLabel);
    const pdf = ALL.map((s) => presentChainStatus(s).pdfLabel);
    const color = ALL.map((s) => presentChainStatus(s).color);

    expect(new Set(ui).size).toBe(3);
    expect(new Set(pdf).size).toBe(3);
    expect(new Set(color).size).toBe(3);
  });

  it("12.b · las etiquetas son exactamente las acordadas", () => {
    expect(presentChainStatus("verified").uiLabel).toBe("Íntegra");
    expect(presentChainStatus("verified").pdfLabel).toBe("CADENA VÁLIDA");

    expect(presentChainStatus("invalid").uiLabel).toBe("Inválida");
    expect(presentChainStatus("invalid").pdfLabel).toBe("CADENA INVÁLIDA");

    expect(presentChainStatus("unverifiable").uiLabel).toBe("Sin evidencia suficiente");
    expect(presentChainStatus("unverifiable").pdfLabel).toBe("SIN EVIDENCIA SUFICIENTE");
  });

  it("12.c · `isValid` es espejo exacto de `chain_valid`: sólo verified", () => {
    expect(presentChainStatus("verified").isValid).toBe(true);
    expect(presentChainStatus("invalid").isValid).toBe(false);
    expect(presentChainStatus("unverifiable").isValid).toBe(false);
  });

  it("12.d · el fondo de la píldora del PDF acompaña al color, sin mezclar estados", () => {
    for (const s of ALL) {
      const p = presentChainStatus(s);
      expect(p.pdfBackground.startsWith(p.color)).toBe(true);
    }
  });
});

describe("T-C2-06 · M5 · resolución desde la respuesta del resumen", () => {
  it("usa `chain_status` cuando la base lo publica", () => {
    for (const s of ALL) {
      expect(resolveChainStatus({ chain_status: s, chain_valid: s === "verified" })).toBe(s);
    }
  });

  it("13 · legacy sin `chain_status` y `chain_valid=false` ⇒ unverifiable, NUNCA invalid", () => {
    const r = presentChain({ chain_valid: false });
    expect(resolveChainStatus({ chain_valid: false })).toBe("unverifiable");
    expect(r.uiLabel).toBe("Sin evidencia suficiente");
    expect(r.pdfLabel).not.toContain("INVÁLIDA");
    expect(r.uiLabel).not.toBe("Inválida");
  });

  it("13.b · legacy con `chain_valid=true` ⇒ verified", () => {
    expect(resolveChainStatus({ chain_valid: true })).toBe("verified");
    expect(presentChain({ chain_valid: true }).pdfLabel).toBe("CADENA VÁLIDA");
  });

  it("13.c · `invalid` sólo se afirma si la base lo afirma", () => {
    // Ninguna combinación SIN `chain_status` puede producir 'invalid'.
    const sinStatus = [
      { chain_valid: false },
      { chain_valid: true },
      { chain_valid: null },
      {},
      null,
      undefined,
    ];
    for (const src of sinStatus) {
      expect(resolveChainStatus(src)).not.toBe("invalid");
    }
    expect(resolveChainStatus({ chain_status: "invalid", chain_valid: false })).toBe("invalid");
  });

  it("un `chain_status` desconocido se trata como ausente y cae al legacy", () => {
    expect(resolveChainStatus({ chain_status: "roto", chain_valid: true })).toBe("verified");
    expect(resolveChainStatus({ chain_status: "roto", chain_valid: false })).toBe("unverifiable");
    expect(resolveChainStatus({ chain_status: "", chain_valid: false })).toBe("unverifiable");
  });

  it("una respuesta ausente no rompe ni miente: unverifiable", () => {
    expect(presentChain(null).uiLabel).toBe("Sin evidencia suficiente");
    expect(presentChain(undefined).isValid).toBe(false);
  });
});

describe("T-C2-06 · M5 · `unverifiable` no se acusa de rota", () => {
  it("13 · ni la etiqueta de UI ni la del PDF usan vocabulario acusatorio", () => {
    const u = presentChainStatus("unverifiable");
    expect(u.uiLabel).not.toMatch(ACUSATORIO);
    expect(u.pdfLabel).not.toMatch(ACUSATORIO);
    // …y el estado que SÍ acusa lo hace explícitamente, para que la afirmación
    // anterior no sea vacía.
    expect(presentChainStatus("invalid").pdfLabel).toMatch(ACUSATORIO);
  });

  it("13.b · `unverifiable` NO se muestra en rojo", () => {
    const u = presentChainStatus("unverifiable");
    const bad = presentChainStatus("invalid");
    expect(u.color).not.toBe(bad.color);
    expect(u.color.toLowerCase()).not.toMatch(/^#(c9|dc|ef|f4|e1)[0-9a-f]{4}$/);
    // Ámbar: canal rojo alto, pero con verde sustancial — no es un rojo puro.
    const [r, g] = [u.color.slice(1, 3), u.color.slice(3, 5)].map((h) => parseInt(h, 16));
    expect(g).toBeGreaterThan(60);
    expect(r - g).toBeLessThan(140);
  });

  it("13.c · el fallback legacy tampoco acusa", () => {
    const legacy = presentChain({ chain_valid: false });
    expect(legacy.uiLabel).not.toMatch(ACUSATORIO);
    expect(legacy.pdfLabel).not.toMatch(ACUSATORIO);
    // Ninguna afirmación de rotura: el enunciado sólo puede NEGAR que acredita,
    // y además desmiente explícitamente la lectura acusatoria.
    expect(legacy.podStatement).not.toMatch(/\b(fue|está|ha sido)\s+(vulnerad|rot|adulterad)/i);
    expect(legacy.podStatement).toMatch(/tampoco afirma/i);
  });
});

describe("T-C2-06 · M5 · el POD no certifica favorablemente lo que no puede", () => {
  it("14 · sólo `verified` acredita integridad", () => {
    expect(presentChainStatus("verified").certifiesIntegrity).toBe(true);
    expect(presentChainStatus("invalid").certifiesIntegrity).toBe(false);
    expect(presentChainStatus("unverifiable").certifiesIntegrity).toBe(false);
    // `certifiesIntegrity` no puede divergir de `isValid` sin una decisión
    // explícita: si algún día lo hace, esta prueba lo hace visible.
    for (const s of ALL) {
      const p = presentChainStatus(s);
      expect(p.certifiesIntegrity).toBe(p.isValid);
    }
  });

  it("14.b · el enunciado del POD niega la acreditación cuando corresponde", () => {
    expect(presentChainStatus("verified").podStatement).toMatch(/acredita la integridad/i);
    expect(presentChainStatus("verified").podStatement).not.toMatch(/NO acredita/);
    for (const s of ["invalid", "unverifiable"] as const) {
      expect(presentChainStatus(s).podStatement).toMatch(/NO acredita la integridad/);
    }
  });

  it("14.c · sólo `verified` llama «verificados» a los eventos", () => {
    expect(presentChainStatus("verified").eventsCountLabel).toBe("eventos verificados");
    expect(presentChainStatus("invalid").eventsCountLabel).toBe("eventos recorridos");
    expect(presentChainStatus("unverifiable").eventsCountLabel).toBe("eventos recorridos");
  });

  it("12 · el POD consume la presentación canónica y no reimplementa la suya", () => {
    const pod = readRepo("src/lib/custody/PodPdfDocument.tsx");
    expect(pod).toContain("presentChainStatus");
    expect(pod).toContain("chain.pdfLabel");
    expect(pod).toContain("chain.podStatement");
    expect(pod).toContain("chain.eventsCountLabel");
    // Ninguna etiqueta literal suelta: el ternario `chainValid ? … : …` era
    // exactamente el binario que M5 elimina.
    expect(pod).not.toMatch(/"CADENA VÁLIDA"|"CADENA INVÁLIDA"/);
    expect(pod).not.toContain("d.chainValid");
    expect(pod).not.toMatch(/eventos verificados/);
  });

  it("11 · la UI consume la misma presentación canónica", () => {
    const ui = readRepo("src/app/(app)/wms/custody/_components/CustodyShipmentSection.tsx");
    expect(ui).toContain("presentChain");
    expect(ui).toContain("chain.uiLabel");
    expect(ui).toContain("chain.color");
    // El binario anterior: «Íntegra» / «ROTA» con rojo fijo.
    expect(ui).not.toContain('"ROTA"');
    expect(ui).not.toContain("summary.chain_valid ?");
  });
});
