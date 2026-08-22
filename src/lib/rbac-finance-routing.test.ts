import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("finance routing and executive privacy boundaries", () => {
  it("guards the complete finance subtree with the exact boot permission", () => {
    const layout = read("src/app/(app)/finanzas/layout.tsx");
    expect(layout).toContain("getBootContext()");
    expect(layout).toContain("perms.finanzas");
    expect(layout).toContain("notFound()");
  });

  it("redirects every legacy finance entry to its canonical destination", () => {
    expect(read("src/app/(app)/analytics/page.tsx")).toContain(
      'redirect("/finanzas/analytics")',
    );
    expect(read("src/app/(app)/tesoreria/flujo-fondos/page.tsx")).toContain(
      'redirect("/finanzas/flujo-fondos")',
    );
    expect(read("src/app/(app)/finanzas/ingesta/page.tsx")).toContain(
      'redirect("/tesoreria/inbox")',
    );
  });

  it("keeps the executive cockpit operational and free of monetary KPIs", () => {
    const commandCenter = read("src/lib/ejecutivo/command-center.ts");
    expect(commandCenter).toContain('label: "Sistemas operativos"');
    expect(commandCenter).toContain("`${operativeCount}/${totalSystems}`");
    expect(commandCenter).not.toContain("fmtCurrency");
    expect(commandCenter).not.toContain('label: "Cash Flow Proyectado"');
  });

  it("enforces the exact director identity inside every finance Server Action", () => {
    const actions = read("src/lib/finanzas/actions.ts");
    expect(actions).toContain('import { isFinanceDirectorEmail }');
    expect(actions.match(/await isAuthorizedFinanceDirector\(supabase\)/g)).toHaveLength(4);
    expect(actions).toContain('message: "Acceso no autorizado."');
  });

  it("closes RLS and legacy finance permissions around the two exact identities", () => {
    const migration = read(
      "supabase/migrations/20260822190000_finance_director_exclusive_boundary.sql",
    );
    expect(migration).toContain("create or replace function public.is_finance_director()");
    expect(migration).toContain("'martin@logisticatops.com'");
    expect(migration).toContain("'martin.battaglia@logisticatops.com'");
    expect(migration).toContain("delete from public.role_permissions");
    expect(migration).toContain("r.slug = 'finance_director'");
    expect(migration).toContain("c.relname like 'finance\\_%' escape '\\'");
    expect(migration).toContain("for all to authenticated using (public.is_finance_director())");
    expect(migration).toContain("with check (public.is_finance_director())");
    expect(migration).toContain("if p_slug like 'finanzas.%' then");
    expect(migration).toContain("return public.is_finance_director();");

    const financeBranch = migration.slice(
      migration.indexOf("if p_slug like 'finanzas.%' then"),
      migration.indexOf("if public.nexus_is_depot_manager_principal() then"),
    );
    expect(financeBranch).not.toContain("role = 'admin'");
    expect(financeBranch).not.toContain("public.has_permission");

    const reconciliation = read(
      "supabase/migrations/0300_finance_treasury_atomic_reconciliation.sql",
    );
    expect(reconciliation).toContain("create or replace function public.finance_void_forecast");
    expect(reconciliation.match(/public\.has_permission\('finanzas\.(?:plan|admin)'\)/g)).toHaveLength(8);
  });
});
