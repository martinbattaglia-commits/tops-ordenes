// Adapter (driven) · IdGeneratorPort sobre crypto.randomUUID() (Node 22 / Web Crypto).
import type { IdGeneratorPort } from "../../ports/id-generator.port";

export class UuidIdGenerator implements IdGeneratorPort {
  uuid(): string {
    return crypto.randomUUID();
  }
}
