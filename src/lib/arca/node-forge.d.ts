/**
 * Declaración ambiente mínima para `node-forge` (no hay @types instalado).
 * Tipado laxo a propósito: solo se usa la superficie pkcs7/pki/asn1/util desde
 * `cms-forge.ts`. Si en el futuro se agrega `@types/node-forge`, borrar este
 * archivo para usar los tipos oficiales.
 */
declare module "node-forge" {
  const forge: any;
  export = forge;
}
