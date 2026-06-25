// Port (driven) · IdGeneratorPort — identidad fuera de la base, determinista/inyectable en tests (AP-15).
export interface IdGeneratorPort {
  uuid(): string;
}
