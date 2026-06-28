import type { ReaderRegistry, ReaderPort } from "../kernel/ports";

export function createReaderRegistry(): ReaderRegistry {
  const readers: ReaderPort[] = [];
  return {
    register(r) {
      if (readers.some((x) => x.id === r.id)) throw new Error(`reader duplicado: ${r.id}`);
      readers.push(r);
    },
    resolve: (file) => readers.find((r) => r.accepts(file)) ?? null,
    list: () => readers.slice(),
  };
}
