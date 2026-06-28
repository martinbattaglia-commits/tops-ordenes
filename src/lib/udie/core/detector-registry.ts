import type { DetectorRegistry, FormatDetectorPort } from "../kernel/ports";
import type { RawTable, DetectedFormat } from "../kernel/types";

export function createDetectorRegistry(): DetectorRegistry {
  const detectors: FormatDetectorPort[] = [];
  return {
    register(d) {
      if (detectors.some((x) => x.id === d.id)) throw new Error(`detector duplicado: ${d.id}`);
      detectors.push(d);
    },
    detect(table: RawTable) {
      let best: { format: DetectedFormat; confidence: number; id: string } | null = null;
      for (const d of detectors) {
        const hit = d.detect(table);
        if (!hit || hit.confidence <= 0) continue;
        if (
          best === null ||
          hit.confidence > best.confidence ||
          (hit.confidence === best.confidence && d.id < best.id)
        ) {
          best = { ...hit, id: d.id };
        }
      }
      return best ? { format: best.format, confidence: best.confidence } : null;
    },
    list: () => detectors.slice(),
  };
}
