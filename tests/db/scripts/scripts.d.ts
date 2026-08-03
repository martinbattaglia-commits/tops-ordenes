/**
 * P3-N1A0 · Declaraciones de tipos para los helpers .mjs de los scripts.
 *
 * Los scripts corren con Node puro (.mjs) y no pueden importar TypeScript sin
 * build, pero los tests SÍ los importan y necesitan tipos. Estas firmas fijan
 * el contrato y evitan `any` implícito.
 */

declare module "*/scripts/residual-inspect.mjs" {
  export type InspectResult =
    | { status: "clean"; matches: string[] }
    | { status: "dirty"; matches: string[] }
    | { status: "error"; reason: string };

  export function inspectProcesses(
    runner?: (cmd: string, args: string[]) => {
      status: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
      error?: Error;
    },
  ): InspectResult;

  export function inspectDirectories(tmp: string, readdir?: (dir: string) => string[]): InspectResult;

  export function residualVerdict(
    procs: InspectResult,
    dirs: InspectResult,
  ): { ok: boolean; problems: string[] };
}

declare module "*/scripts/guard.mjs" {
  export const TEST_DB_PREFIX: string;
  export const ONLY_ALLOWED_HOST: string;
  export const FORBIDDEN_ENV_VARS: string[];
  export function assertLocalTestUrl(rawUrl: string): void;
  export function assertLocalMaintenanceUrl(rawUrl: string): void;
  export function assertNoProductionEnv(env?: Record<string, string | undefined>): void;
  export function parseAndCheckServerVersion(raw: unknown): number;
}

declare module "*/scripts/expected-suite.mjs" {
  export const EXPECTED_TEST_FILES: string[];
  export const EXPECTED_TOTAL_TESTS: number;
}
