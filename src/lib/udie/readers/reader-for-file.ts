import type { ReaderPort, ReaderRegistry } from "../kernel/ports";
import { ok, err, domainError, type Result } from "../kernel/result";

export function resolveReader(registry: ReaderRegistry, file: { name: string; type: string }): Result<ReaderPort> {
  if (file.name.toLowerCase().endsWith(".xls")) {
    return err(domainError("UNSUPPORTED_FORMAT", "El formato .xls legacy no está soportado. Exportá como .xlsx o .csv."));
  }
  const reader = registry.resolve(file);
  if (!reader) return err(domainError("UNSUPPORTED_FORMAT", `No hay lector para "${file.name}". Use CSV o XLSX.`));
  return ok(reader);
}
