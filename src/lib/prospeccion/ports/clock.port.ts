// Port (driven) · ClockPort — tiempo inyectable (AP-15); el dominio nunca usa Date.now() directo.
export interface ClockPort {
  now(): string; // ISO-8601
}
