import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyIssueOutcome } from "./issue-outcome";

// OC-FIRMANTE-POR-PERMISO · 0259.
//
// La migración 0259 abre cuatro rechazos que 0243 no podía producir, porque
// 0243 resolvía al firmante comparando el correo del actor contra un literal:
// quien no era ESE correo moría siempre con «firmante canónico», dijera lo que
// dijera su perfil. Con el firmante resuelto por permiso, el usuario puede
// estar plenamente autorizado y aun así faltarle el DATO con el que se firma.
//
// Estos cuatro casos deben tener mensaje propio. Sin la traducción caen en el
// 42501 genérico —«pasáselo a soporte»— que es exactamente el consejo
// equivocado para alguien que lo resuelve cargando su propio cargo.
const rpcError = (message: string) => ({ message, code: "42501" });

const MENSAJES_DEL_0259 = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0259_purchase_order_signer_by_permission.sql"),
  "utf8",
);

describe("0259 · la traducción de los rechazos del firmante", () => {
  it("el que no tiene NOMBRE en el perfil recibe una instrucción, no un derivador a soporte", () => {
    const o = classifyIssueOutcome({
      issueError: rpcError(
        "El perfil del firmante no tiene nombre cargado: cargá el nombre del usuario antes de emitir",
      ),
      issued: null,
    });
    expect(o.ok).toBe(false);
    if (o.ok) return;
    expect(o.kind).toBe("signer_profile_incomplete");
    expect(o.retryable).toBe(false);
    expect(o.userMessage).toContain("nombre");
    expect(o.userMessage).not.toContain("soporte");
  });

  it("el que no tiene CARGO recibe una instrucción propia y distinta", () => {
    const o = classifyIssueOutcome({
      issueError: rpcError(
        "El perfil del firmante no tiene cargo cargado: cargá el cargo del usuario en su rol antes de emitir",
      ),
      issued: null,
    });
    expect(o.ok).toBe(false);
    if (o.ok) return;
    expect(o.kind).toBe("signer_profile_incomplete");
    expect(o.userMessage).toContain("cargo");
    expect(o.userMessage).not.toContain("soporte");
  });

  it("el cargo AMBIGUO no se confunde con el cargo ausente", () => {
    const ambiguo = classifyIssueOutcome({
      issueError: rpcError(
        "El cargo del firmante es ambiguo: el usuario declara más de un cargo en sus roles",
      ),
      issued: null,
    });
    const ausente = classifyIssueOutcome({
      issueError: rpcError("El perfil del firmante no tiene cargo cargado: cargá el cargo"),
      issued: null,
    });
    expect(ambiguo.ok).toBe(false);
    expect(ausente.ok).toBe(false);
    if (ambiguo.ok || ausente.ok) return;
    expect(ambiguo.kind).toBe("signer_profile_incomplete");
    // Si ambos colapsaran en el mismo texto, el usuario con dos cargos
    // intentaría cargar uno que ya tiene y no saldría nunca del rechazo.
    expect(ambiguo.userMessage).not.toBe(ausente.userMessage);
    expect(ambiguo.userMessage).toContain("más de un cargo");
  });

  it("el perfil no resuelto se lee como perfil inactivo, no como falta de permiso", () => {
    const o = classifyIssueOutcome({
      issueError: rpcError("No se pudo resolver el perfil activo del firmante de la sesión"),
      issued: null,
    });
    expect(o.ok).toBe(false);
    if (o.ok) return;
    expect(o.kind).toBe("inactive_profile");
    expect(o.retryable).toBe(false);
  });

  it("los tres mensajes traducidos son los que el 0259 realmente lanza", () => {
    // Guarda contra la deriva: si alguien reescribe el texto en el SQL y no
    // acá, la traducción deja de enganchar y el usuario vuelve al genérico
    // sin que ningún test se ponga rojo.
    for (const fragmento of [
      "no tiene nombre cargado",
      "no tiene cargo cargado",
      "cargo del firmante es ambiguo",
      "perfil activo del firmante",
    ]) {
      expect(MENSAJES_DEL_0259).toContain(fragmento);
    }
  });

  // El gate directo del firmante, que 0259 agrega para esquivar el bypass de
  // `has_permission`. Su rechazo NO es «te falta un dato» ni «te falta un
  // permiso»: es que la firma se concede por nombre y esta cuenta no está en la
  // lista. Si cayera en cualquiera de los otros dos, el mensaje mandaría a
  // cargar un cargo o a pedir un permiso, y ninguna de las dos cosas
  // habilitaría a firmar.
  it("el que NO está autorizado a firmar recibe un rechazo propio, ni permiso ni perfil", () => {
    const o = classifyIssueOutcome({
      issueError: rpcError(
        "No estás autorizado a firmar órdenes de compra. La firma la concede Dirección por "
        + "nombre; tener un cargo cargado o un perfil de administrador no habilita a firmar.",
      ),
      issued: null,
    });
    expect(o.ok).toBe(false);
    if (o.ok) return;
    expect(o.kind).toBe("signer_not_authorized");
    expect(o.retryable).toBe(false);
    expect(o.userMessage).toMatch(/Dirección/);
    // No manda a cargar nada: cargar un cargo es justamente lo que NO habilita.
    expect(o.userMessage).not.toMatch(/cargá|cargar tu cargo/i);
    expect(o.userMessage).not.toContain("soporte");
  });

  it("el rechazo del gate directo es el texto que 0259 realmente emite", () => {
    expect(MENSAJES_DEL_0259).toContain("No estás autorizado a firmar órdenes de compra.");
  });

  it("el permiso faltante sigue siendo permiso, no perfil incompleto", () => {
    const o = classifyIssueOutcome({
      issueError: rpcError("Sin permisos compras.create/compras.sign"),
      issued: null,
    });
    expect(o.ok).toBe(false);
    if (o.ok) return;
    expect(o.kind).toBe("permission");
  });
});
