import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyIssueOutcome,
  firstMissingIssuedField,
  redactRpcDetail,
  redactRpcText,
} from "./issue-outcome";

const action = readFileSync(
  resolve(process.cwd(), "src/app/(app)/compras/nueva/actions.ts"),
  "utf8",
);
const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0243_purchase_order_price_lifecycle.sql"),
  "utf8",
);

const complete = {
  id: "8f0a1f3c-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
  public_id: "OC-2026-0028",
  price_state: "pending" as const,
  signed_by: "José Luis Rodríguez Silva",
  issued_at: "2026-08-19T03:00:00.000Z",
  signature_hash: "a".repeat(64),
  integrity_hash: "b".repeat(64),
  emisor_name: "José Luis Rodríguez Silva",
  emisor_email: "joseluis@example.test",
  emisor_role: "Director de Operaciones y Apoderado",
  vendor_snapshot: { id: "fa798df0-5410-4322-91aa-d2f14dd560e1", razon: "Proveedor", cuit: "30-00000000-0" },
};

describe("clasificación del resultado de purchase_order_issue", () => {
  it("acepta el resultado completo sin inventar un fallo", () => {
    const outcome = classifyIssueOutcome({ issueError: null, issued: complete });
    expect(outcome.ok).toBe(true);
  });

  // HOTFIX-OC-EMISION-ATOMICA · el caso REPRODUCIDO en producción: un usuario
  // con compras.create y compras.sign que no es el apoderado. La RPC aborta
  // antes del nextval y hoy el operador recibe «reintentá en unos minutos».
  it("nombra al firmante canónico y NUNCA ofrece reintentar", () => {
    const outcome = classifyIssueOutcome({
      issueError: {
        code: "42501",
        message: "No se pudo resolver el firmante canónico de la sesión",
        details: null,
        hint: null,
      },
      issued: null,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.kind).toBe("signer_not_canonical");
    expect(outcome.retryable).toBe(false);
    expect(outcome.userMessage).not.toMatch(/reintent/i);
    expect(outcome.userMessage).toMatch(/apoderado/i);
    expect(outcome.log.sqlstate).toBe("42501");
    expect(outcome.log.message).toContain("firmante canónico");
  });

  it("distingue sesión sin identidad y perfil inactivo del resto de 42501", () => {
    expect(
      classifyIssueOutcome({
        issueError: { code: "28000", message: "PO_ISSUE_SIN_IDENTIDAD" },
        issued: null,
      }),
    ).toMatchObject({ ok: false, kind: "no_session", retryable: false });
    expect(
      classifyIssueOutcome({
        issueError: { code: "42501", message: "PO_ISSUE_SIN_PERFIL_ACTIVO" },
        issued: null,
      }),
    ).toMatchObject({ ok: false, kind: "inactive_profile", retryable: false });
    expect(
      classifyIssueOutcome({
        issueError: { code: "42501", message: "Sin permisos compras.create/compras.sign" },
        issued: null,
      }),
    ).toMatchObject({ ok: false, kind: "permission", retryable: false });
  });

  it("devuelve la validación real del servidor en vez de un mensaje transitorio", () => {
    const outcome = classifyIssueOutcome({
      issueError: { code: "P0001", message: "Una línea pendiente no puede declarar precio ni subtotal" },
      issued: null,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.kind).toBe("validation");
    expect(outcome.retryable).toBe(false);
    expect(outcome.userMessage).toContain("Una línea pendiente no puede declarar precio ni subtotal");
    expect(outcome.userMessage).not.toMatch(/unos minutos/i);
  });

  it("reserva «reintentá» para los sqlstate que sí son transitorios", () => {
    for (const code of ["08006", "40001", "40P01", "57014", "53300"]) {
      const outcome = classifyIssueOutcome({
        issueError: { code, message: "fallo transitorio" },
        issued: null,
      });
      expect(outcome, code).toMatchObject({ ok: false, kind: "transient", retryable: true });
    }
  });

  it("dice QUÉ campo faltó cuando la RPC responde incompleta, sin colapsar 15 condiciones", () => {
    expect(firstMissingIssuedField(complete)).toBeNull();
    expect(firstMissingIssuedField({ ...complete, public_id: undefined })).toBe("public_id");
    expect(firstMissingIssuedField({ ...complete, signature_hash: "no-es-hex" })).toBe("signature_hash");
    expect(firstMissingIssuedField({ ...complete, integrity_hash: "c".repeat(63) })).toBe("integrity_hash");
    expect(firstMissingIssuedField({ ...complete, vendor_snapshot: { id: "x" } })).toBe("vendor_snapshot.razon");
    expect(firstMissingIssuedField(null)).toBe("id");

    const outcome = classifyIssueOutcome({ issueError: null, issued: { ...complete, emisor_email: "" } });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.kind).toBe("incomplete_result");
    expect(outcome.failedCheck).toBe("emisor_email");
    expect(outcome.userMessage).toContain("emisor_email");
    expect(outcome.retryable).toBe(false);
  });


  // C4 1/2 · M-1. Los tres 42501 nombrados de 0243 se interceptan por texto;
  // el residual es pérdida de EXECUTE, no un dato que el operador corrija.
  it("trata un 42501 no nombrado como configuración de permisos, no como dato a corregir", () => {
    const outcome = classifyIssueOutcome({
      issueError: { code: "42501", message: "permission denied for function purchase_order_issue" },
      issued: null,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.kind).toBe("permission");
    expect(outcome.retryable).toBe(false);
    expect(outcome.userMessage).not.toMatch(/corregí ese dato/i);
    expect(outcome.userMessage).not.toMatch(/reintent[aá] en unos minutos/i);
    expect(outcome.userMessage).toMatch(/soporte/i);
  });

  // C4 1/2 · M-2. `details` es donde PostgreSQL vuelca la fila entera.
  it("nunca deja entrar la fila del payload del proveedor al log", () => {
    const detail =
      'Failing row contains (a1, Proveedor Sullivan Camejo SA, Av. Siempreviva 742, Mariela, 30-11111111-9).';
    expect(redactRpcDetail(detail)).toBe("[fila omitida: payload del proveedor]");

    const outcome = classifyIssueOutcome({
      issueError: { code: "23514", message: "new row violates check constraint", details: detail },
      issued: null,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.log.details).toBe("[fila omitida: payload del proveedor]");
    expect(outcome.log.details).not.toContain("Sullivan");
    expect(outcome.log.details).not.toContain("Siempreviva");
  });

  // C4 1/2 · L-7. La distinción firmante/permiso vive en literales en español
  // porque 0243 levanta el mismo 42501 para ambos. Se anclan a la migración.
  it("ancla sus literales discriminantes al texto real de 0243", () => {
    expect(sql).toContain("No se pudo resolver el firmante canónico de la sesión");
    expect(sql).toContain("Sin permisos compras.create/compras.sign");
    expect(sql).toContain("PO_ISSUE_SIN_IDENTIDAD");
    expect(sql).toContain("PO_ISSUE_SIN_PERFIL_ACTIVO");
  });

  it("redacta email y ristras largas de dígitos antes de tocar el log", () => {
    const redacted = redactRpcText("proveedor alguien@dominio.test cuit 30123456789 pos 3");
    expect(redacted).not.toContain("alguien@dominio.test");
    expect(redacted).not.toContain("30123456789");
    expect(redacted).toContain("pos 3");
  });
});

describe("el emisor ya no destruye el error real", () => {
  it("no vuelve a loguear un código fijo sin el error de la RPC", () => {
    expect(action).not.toMatch(/code:\s*"PO_ISSUE_FAILED"/);
    expect(action).toContain("classifyIssueOutcome");
  });

  it("devuelve el mensaje del clasificador y loguea su registro redactado", () => {
    expect(action).toContain('console.error("[compras] purchase_order_issue failed", outcome.log)');
    expect(action).toContain("return { ok: false, error: outcome.userMessage };");
    // El resultado del clasificador no puede ignorarse: el emisor sigue sólo
    // por su rama `ok`, y de ahí sale la forma ya comprobada.
    expect(action).toContain("if (!outcome.ok) {");
    expect(action).toContain("const issued = outcome.issued;");
  });

  it("no ofrece reintentar de forma incondicional", () => {
    expect(action).not.toContain(
      "No pudimos emitir la orden de compra de forma atómica. Reintentá en unos minutos.",
    );
  });
});
