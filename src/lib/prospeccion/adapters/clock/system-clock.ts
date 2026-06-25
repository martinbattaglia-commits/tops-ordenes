// Adapter (driven) · ClockPort sobre el reloj del sistema.
import type { ClockPort } from "../../ports/clock.port";

export class SystemClock implements ClockPort {
  now(): string {
    return new Date().toISOString();
  }
}
