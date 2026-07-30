// LINK-WA-002 · E1.1 — remediación H2 de la revisión adversarial independiente.
//
// La regla de Dirección es «no cortar mensajes silenciosamente». Había un
// `.slice(0, 1500)` en el render de evidencia que partía mensajes largos sin
// registrarlo, contradiciendo lo que la ventana declaraba. Estos tests fijan
// que el cuerpo viaja COMPLETO y que el tamaño lo gobierna sólo la ventana.

import { describe, expect, it } from "vitest";
import { renderMessage, buildAnalysisPrompt } from "./prompt";


describe("H2 · el cuerpo del mensaje va COMPLETO (nunca cortado en silencio)", () => {
  it("un mensaje de 4.000 caracteres se renderiza entero", () => {
    const body = "a".repeat(4000);
    const line = renderMessage({ id: "m1", author: "Cliente", createdAt: "2026-01-01T00:00:00.000Z", body });
    expect(line).toContain(body);
    expect(line.length).toBeGreaterThan(4000);
  });

  it("el prompt no pierde texto: el tamaño lo gobierna la ventana, no un slice oculto", () => {
    const largo = "b".repeat(3000);
    const p = buildAnalysisPrompt([
      { id: "m1", author: "Cliente", createdAt: "2026-01-01T00:00:00.000Z", body: largo },
    ]);
    expect(p).toContain(largo);
  });
});
