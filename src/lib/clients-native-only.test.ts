/**
 * GUARDA MECÁNICA · aislamiento del registro maestro de clientes.
 *
 * ─── QUÉ AFIRMA ESTA GUARDA, Y NADA MÁS ────────────────────────────────────
 *
 * Demuestra cuatro propiedades DECIDIBLES:
 *
 *   A · AISLAMIENTO ESTRUCTURAL — ningún módulo del registro maestro alcanza
 *       `@/lib/clientify` ni un SDK que lo NOMBRE, por importación directa o
 *       transitiva, en las formas que el AST puede enumerar: import estático,
 *       `import type`, dinámico, `require` no sombreado, `import =` y
 *       re-export, con o sin extensión y con o sin alcance de paquete.
 *   B · AUSENCIA DE EGRESO — los módulos exclusivos del maestro no hacen
 *       llamadas de red, salvo las enumeradas una por una en una allowlist
 *       exacta y justificada.
 *   C · AUSENCIA DE IDENTIFICADORES CONCRETOS — no aparecen los nombres, claves,
 *       hosts, props ni estados del proveedor.
 *   D · CONTRATO DE ESQUEMA — las migraciones del maestro no introducen
 *       identidad externa, estado de sincronización ni procedencia del CRM.
 *
 * La ausencia de elementos concretos de integración EN PANTALLA se prueba por
 * renderizado, en `clients-surfaces-render.test.ts`.
 *
 * ─── LO QUE ESTA GUARDA NO INTENTA HACER ───────────────────────────────────
 *
 * NO interpreta lenguaje natural. No tiene diccionarios de verbos ni de
 * objetos, no juzga si una frase «promete» una integración, y no pretende
 * detectar toda ofuscación arbitraria posible.
 *
 * Se llegó acá por medición, no por comodidad. Tres revisiones adversariales
 * consecutivas midieron el intento anterior —que sí interpretaba frases— y el
 * resultado fue el mismo las tres veces: cada regla ensanchada para atrapar una
 * frase mordía código legítimo («Enviar el remito al proveedor», «Sincronizar
 * el reloj del depósito», «Verificar la integridad del certificado externo»),
 * y cada regla estrechada para callar ese falso positivo apagaba detecciones
 * reales que nadie había enumerado antes de estrechar. En la última ronda, 18
 * de 33 mutantes eran regresiones de la ronda anterior. El control oscilaba en
 * vez de converger, porque «enviar el remito al proveedor» y «enviar los
 * clientes al proveedor» difieren en una palabra y en todo, y ninguna partición
 * de expresiones regulares separa el español bien formado del español bien
 * formado.
 *
 * El invariante que sí es decidible, y el que de verdad importa:
 *
 *   > El CRUD nativo de clientes no importa al proveedor, no hace egreso de red
 *   > hacia ningún CRM, no nombra sus identificadores y no guarda estado de
 *   > sincronización.
 *
 * La revisión del SIGNIFICADO —si una frase promete algo que el código no
 * hace— corresponde al C4, que es humano y adversarial. Esta guarda no la
 * suplanta ni finge suplantarla.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import ts from "typescript";

const RAIZ = resolve(__dirname, "..", "..");

// ============================================================================
// Utilidades
// ============================================================================

const esFuente = (p: string) => /\.tsx?$/.test(p) && !/\.d\.ts$/.test(p);
/** Tests, specs y mocks NO son código productivo: la guarda no se mide a sí misma. */
const esPrueba = (p: string) => /\.(test|spec)\.tsx?$/.test(p) || /__(tests|mocks)__/.test(p);
const normalizar = (p: string) => p.replace(/\\/g, "/");

function archivosDe(dirRelativo: string): string[] {
  const base = join(RAIZ, dirRelativo);
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(base);
  } catch {
    return [];
  }
  if (st.isFile()) return esFuente(base) && !esPrueba(base) ? [normalizar(dirRelativo)] : [];
  const out: string[] = [];
  for (const entrada of readdirSync(base)) {
    const abs = join(base, entrada);
    const rel = join(dirRelativo, entrada);
    if (statSync(abs).isDirectory()) out.push(...archivosDe(rel));
    else if (esFuente(abs) && !esPrueba(abs)) out.push(normalizar(rel));
  }
  return out;
}

const leer = (rel: string): string => readFileSync(join(RAIZ, rel), "utf8");

function parsear(rel: string, fuente: string): ts.SourceFile {
  return ts.createSourceFile(
    rel,
    fuente,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function recorrer(nodo: ts.Node, visita: (n: ts.Node) => void): void {
  visita(nodo);
  nodo.forEachChild((h) => recorrer(h, visita));
}

/**
 * Valor de una expresión de cadena cuando puede conocerse sin ejecutar nada:
 * literales, plantillas y concatenaciones con `+`. Null si depende de algo
 * dinámico. Existe para que partir un literal con `+` no lo esconda.
 */
export function valorEstatico(n: ts.Node): string | null {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isTemplateExpression(n)) {
    let acc = n.head.text;
    for (const span of n.templateSpans) {
      acc += valorEstatico(span.expression) ?? " ";
      acc += span.literal.text;
    }
    return acc;
  }
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = valorEstatico(n.left);
    const b = valorEstatico(n.right);
    return a === null || b === null ? null : a + b;
  }
  if (ts.isParenthesizedExpression(n)) return valorEstatico(n.expression);
  return null;
}

/** Parte un identificador en palabras: camelCase, snake_case, SCREAMING y kebab. */
export function palabras(nombre: string): string[] {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

// ============================================================================
// A · GRAFO DE DEPENDENCIAS
// ============================================================================

/**
 * Superficies conocidas del registro maestro. Los directorios se expanden
 * completos: un archivo nuevo adentro queda cubierto por existir.
 *
 * Que esta lista esté COMPLETA no se afirma: se COMPRUEBA. Más abajo,
 * `tocanLaTablaClients` enumera mecánicamente todo archivo que lee o escribe
 * `clients` y exige que cada uno esté acá, en la clausura, o declarado ajeno
 * con su motivo. Dos revisiones encontraron esta lista incompleta; esa prueba
 * es lo que impide que vuelva a pasar en silencio.
 */
const ORIGENES = [
  "src/app/(app)/clientes",
  "src/app/(app)/clients",
  "src/app/(app)/orders/new",
  "src/app/(app)/orders/tarifas",
  "src/app/(app)/wms/recepciones/nueva",
  "src/app/(app)/pedidos/nuevo",
  "src/app/(app)/pedidos/[id]",
  "src/lib/data/clients.ts",
  "src/lib/data/orders.ts",
  "src/lib/order-client-identity.ts",
  "src/lib/clients-duplicate-confirmation.ts",
  "src/lib/wms/client-identity.ts",
  "src/lib/wms/receptions.ts",
  "src/lib/legajo/data.ts",
  "src/lib/fiscal/mipyme/data.ts",
  "src/app/(app)/billing/actions.ts",
  "src/components/ClientSelector.tsx",
  "src/components/comercial/ClienteFiscalEditor.tsx",
] as const;

/**
 * Archivos que tocan `clients` y NO pertenecen al registro maestro, cada uno
 * con su motivo. Son módulos comerciales y de tesorería que consumen el maestro
 * como dato; su integración con Clientify sigue viva y es ajena a este alcance.
 */
const AJENOS_DECLARADOS: Readonly<Record<string, string>> = Object.freeze({
  "src/lib/comercial/dashboard-sync-db.ts":
    "tablero comercial: proyecta oportunidades del CRM, no administra el maestro",
  "src/lib/comercial/opportunities-supabase.ts":
    "oportunidades: lee la razón social del cliente para mostrarla, no la administra",
  "src/lib/tesoreria/pdf/build.ts":
    "recibo de tesorería: imprime razón social, CUIT y domicilio en el comprobante",
});

export function superficies(): string[] {
  const out = new Set<string>();
  for (const o of ORIGENES) for (const f of archivosDe(o)) out.add(f);
  return [...out].sort();
}

/**
 * ¿Este `require(...)` concreto está sombreado por un binding VISIBLE desde su
 * sitio de llamada?
 *
 * ─── POR QUÉ SENSIBLE AL ÁMBITO ────────────────────────────────────────────
 *
 * Una versión anterior decidía el sombreado a nivel de ARCHIVO: bastaba un
 * binding llamado `require` en cualquier rincón para dejar de contar TODOS los
 * `require` del archivo. Un C4 lo midió y armó el bypass en dos líneas:
 *
 *   const __crm = require("@/lib/clientify");            // real, ámbito global
 *   export function __fmt(require: (s: string) => string) { … }   // sombra ajena
 *
 * Con eso el bloque A quedaba ciego, y como los bloques B y C sólo miden 63 de
 * los archivos de la clausura, en los 46 restantes el bypass era total. Era una
 * pérdida de precisión en el único bloque que el contrato llama exacto, y encima
 * a cambio de nada: se midió que NINGÚN archivo de la clausura contiene siquiera
 * el token `require`.
 *
 * Acá se sube por la cadena de ámbitos desde la llamada y sólo cuenta un binding
 * que de verdad la alcance.
 */
function requireSombreadoEnElSitio(llamada: ts.Node): boolean {
  const declaraRequire = (ambito: ts.Node): boolean => {
    const declaraciones: ts.Node[] = [];
    if (ts.isSourceFile(ambito) || ts.isBlock(ambito) || ts.isModuleBlock(ambito)) {
      declaraciones.push(...ambito.statements);
    }
    if (ts.isFunctionLike(ambito)) declaraciones.push(...(ambito.parameters ?? []));

    for (const d of declaraciones) {
      if (ts.isParameter(d) && ts.isIdentifier(d.name) && d.name.text === "require") return true;
      if (ts.isFunctionDeclaration(d) && d.name?.text === "require") return true;
      if (ts.isVariableStatement(d)) {
        for (const v of d.declarationList.declarations) {
          if (ts.isIdentifier(v.name) && v.name.text === "require") return true;
        }
      }
    }
    return false;
  };

  for (let n: ts.Node | undefined = llamada; n; n = n.parent) {
    if (declaraRequire(n)) return true;
  }
  return false;
}

/**
 * Especificadores de módulo, en TODAS las formas: import estático, `import
 * type`, `import()` dinámico, `require()` real, `import x = require()`,
 * `export … from` y `export * from`.
 *
 * Los ALIAS no necesitan tratamiento: lo que se devuelve es el especificador, y
 * renombrar lo importado no lo cambia.
 *
 * Un `require` SOMBREADO —un binding local con ese nombre— no es una
 * importación y no se cuenta: es una función cualquiera que se llama igual.
 */
export function especificadoresImportados(fuente: string, nombre = "m.tsx"): string[] {
  const sf = parsear(nombre, fuente);
  const out: string[] = [];
  const push = (n: ts.Node | undefined) => {
    if (n && ts.isStringLiteralLike(n)) out.push(n.text);
  };
  recorrer(sf, (n) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) push(n.moduleSpecifier);
    else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      push(n.moduleReference.expression);
    } else if (ts.isCallExpression(n)) {
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword) push(n.arguments[0]);
      else if (
        ts.isIdentifier(n.expression) &&
        n.expression.text === "require" &&
        !requireSombreadoEnElSitio(n)
      ) {
        push(n.arguments[0]);
      }
    }
  });
  return out;
}

/**
 * ¿El especificador apunta al proveedor?
 *
 * Se normaliza la extensión porque `tsconfig.json` tiene
 * `allowImportingTsExtensions: true`: `"@/lib/clientify.ts"` es un
 * especificador VÁLIDO que resuelve al mismo archivo. Una versión anterior
 * exigía barra o fin de cadena, y el punto de la extensión rompía el match; un
 * C4 construyó con eso una explotación de dos líneas que compilaba limpio y
 * metía el cliente REST del proveedor —con su API key— dentro de la clausura,
 * con la suite entera en verde.
 *
 * Cubre también cualquier paquete cuyo nombre nombre al proveedor, que es la
 * forma que tomaría un SDK publicado.
 */
export function esModuloClientify(spec: string): boolean {
  const limpio = spec.split("?")[0].trim().replace(/\.(tsx?|jsx?|mts|cts|mjs|cjs)$/i, "");
  // La `@` cuenta como frontera: un SDK publicado con alcance —`@clientify/sdk`—
  // es tan importación del proveedor como la ruta interna.
  // El guion también cierra: un SDK publicado como `clientify-node` o
  // `clientify-api` es tan importación del proveedor como la ruta interna.
  return /(^|[@/\\])clientify([-/\\]|$)/i.test(limpio);
}

/** Imports locales que no resolvieron. Un tramo ciego se declara, no se calla. */
const SIN_RESOLVER = new Set<string>();

function resolverLocal(spec: string, desde: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(desde), spec);
  else return null; // paquete de node_modules
  const sinExt = base.replace(/\.(tsx?|jsx?|mts|cts|mjs|cjs)$/i, "");
  for (const c of [
    base,
    `${sinExt}.ts`,
    `${sinExt}.tsx`,
    `${sinExt}.js`,
    `${sinExt}.jsx`,
    `${sinExt}.mjs`,
    `${sinExt}.cjs`,
    join(sinExt, "index.ts"),
    join(sinExt, "index.tsx"),
  ]) {
    try {
      if (statSync(join(RAIZ, c)).isFile()) return normalizar(c);
    } catch {
      /* siguiente */
    }
  }
  SIN_RESOLVER.add(`${desde} → ${spec}`);
  return null;
}

/**
 * Clausura transitiva de importaciones desde las superficies.
 *
 * Responde la única pregunta del bloque A: ¿existe ALGÚN camino de importación
 * desde una pantalla de clientes hasta el proveedor? Un archivo intermedio
 * inocente que lo importe reintroduce la dependencia igual que si la importara
 * la pantalla.
 */
export function clausura(desde: string[] = superficies()): string[] {
  const vistos = new Set<string>();
  const pila = [...desde];
  while (pila.length) {
    const actual = pila.pop()!;
    if (vistos.has(actual) || esPrueba(actual)) continue;
    vistos.add(actual);
    let specs: string[];
    try {
      specs = especificadoresImportados(leer(actual), actual);
    } catch {
      continue;
    }
    for (const s of specs) {
      const r = resolverLocal(s, actual);
      if (r && !vistos.has(r)) pila.push(r);
    }
  }
  return [...vistos].sort();
}

/**
 * Módulos de la clausura que NADIE fuera de ella importa: existen sólo para
 * este flujo. Son los que, además del bloque A, cargan con el bloque B.
 *
 * El corte es derivado, no una lista. Su debilidad conocida y declarada: basta
 * que un módulo cualquiera fuera de la clausura importe uno de éstos para que
 * salga del conjunto, y con él del alcance de los bloques B y C. Sigue bajo el
 * bloque A, que es el más preciso de los cuatro pero tampoco infalible: ver la
 * enumeración de límites al pie.
 */
export function exclusivasDelMaestro(): string[] {
  const dentro = new Set(clausura());
  const sup = new Set(superficies());
  const importadoDesdeAfuera = new Set<string>();
  for (const f of archivosDe("src")) {
    if (dentro.has(f)) continue;
    for (const s of especificadoresImportados(leer(f), f)) {
      const r = resolverLocal(s, f);
      if (r && dentro.has(r)) importadoDesdeAfuera.add(r);
    }
  }
  return [...dentro].filter((f) => !sup.has(f) && !importadoDesdeAfuera.has(f)).sort();
}

/** Archivos productivos que importan al proveedor: los consumidores comerciales. */
export function consumidoresAjenos(): string[] {
  const dentro = new Set(clausura());
  return archivosDe("src")
    .filter((f) => !/^src\/lib\/clientify/.test(f))
    .filter((f) => !dentro.has(f))
    .filter((f) => especificadoresImportados(leer(f), f).some(esModuloClientify))
    .sort();
}

/** Todo archivo productivo que lee o escribe la tabla `clients`. */
export function tocanLaTablaClients(): string[] {
  return archivosDe("src")
    .filter((f) => {
      const s = leer(f);
      return (
        /\.from\(\s*["'`]clients["'`]\s*\)/.test(s) ||
        /\brpc\(\s*["'`]client[_a-z]*["'`]/.test(s) ||
        /^\s*clients\s*\(/m.test(s)
      );
    })
    .sort();
}

// ============================================================================
// B · AUSENCIA DE EGRESO DE RED
// ============================================================================

/**
 * Egreso de red LEGÍTIMO, enumerado uno por uno con su motivo.
 *
 * No es un patrón amplio: es una lista exacta de rutas. Agregar una entrada es
 * una decisión visible en el diff, que es exactamente el punto. Ninguna de las
 * tres es un CRM ni un proveedor comercial.
 */
const EGRESO_PERMITIDO: Readonly<Record<string, string>> = Object.freeze({
  "src/lib/email.ts": "Resend · envío de comprobantes por email al cliente",
  "src/lib/arca/wsaa.ts": "ARCA/AFIP · autenticación WSAA para facturación electrónica",
  "src/lib/arca/wsfev1.ts": "ARCA/AFIP · emisión de comprobantes WSFEv1",
});

/** Paquetes que son clientes HTTP: importarlos ES egreso. */
const CLIENTES_HTTP = new Set(["axios", "got", "node-fetch", "undici", "superagent", "ky"]);

/** Módulos de red del runtime: importarlos ES egreso, sin ofuscación alguna. */
const MODULOS_DE_RED = new Set([
  "http", "https", "node:http", "node:https", "net", "node:net", "tls", "node:tls", "dgram", "node:dgram",
]);

export type Egreso =
  | "FETCH"
  | "CLIENTE_HTTP"
  | "SEND_BEACON"
  | "WEBSOCKET"
  | "IFRAME_EXTERNO"
  | "FORM_ACTION_EXTERNO"
  | "URL_ABSOLUTA";

const esUrlAbsoluta = (v: string | null): boolean => v !== null && /https?:\/\/\S/i.test(v);

/**
 * URLs que NO son egreso: espacios de nombres XML/SVG y contextos JSON-LD.
 *
 * `xmlns="http://www.w3.org/2000/svg"` es un identificador de espacio de
 * nombres, no una dirección a la que nadie se conecte. Sin esta excepción,
 * agregar un ícono SVG en línea a una pantalla de clientes pondría la guarda en
 * rojo sin motivo, y una guarda que muerde código correcto se borra sola.
 */
/**
 * Se compara el HOST COMPLETO, no un prefijo. Una versión anterior usaba
 * `/^https?:\/\/(www\.)?(w3\.org|…)/`, sin anclar por la derecha: un C4 midió
 * que `https://w3.org.atacante.example/exfiltrar` quedaba exento, y con él el
 * `<iframe src>` y el `<form action>` al mismo destino. La excepción pensada
 * para no morder un SVG en línea terminaba habilitando el egreso a cualquier
 * host que empezara igual.
 */
const HOSTS_DE_NAMESPACE = new Set([
  "w3.org",
  "www.w3.org",
  "schema.org",
  "www.schema.org",
  "purl.org",
  "www.purl.org",
  "schemas.xmlsoap.org",
  "ar.gov.afip.dif.fev1",
]);

const hostDe = (u: string): string => {
  const m = u.trim().match(/^https?:\/\/([^/?#\s]+)/i);
  return m ? m[1].toLowerCase() : "";
};
const ATRIBUTOS_SIN_EGRESO = new Set(["xmlns", "xmlnsXlink", "xmlns:xlink", "xlinkHref", "@context"]);
const esUrlDeEgreso = (v: string | null): boolean =>
  esUrlAbsoluta(v) && !HOSTS_DE_NAMESPACE.has(hostDe(v ?? ""));

/** Nombre de lo invocado, siguiendo `.bind()` y el acceso por punto. */
function nombreInvocado(e: ts.Expression, sf: ts.SourceFile): string {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) {
    if (e.name.text === "bind" || e.name.text === "call" || e.name.text === "apply") {
      return nombreInvocado(e.expression, sf);
    }
    return e.name.text;
  }
  if (ts.isElementAccessExpression(e)) return valorEstatico(e.argumentExpression) ?? "";
  return "";
}

/** Nombre de la etiqueta que lleva este atributo: `attr → JsxAttributes → elemento`. */
function etiquetaDe(attr: ts.JsxAttribute, sf: ts.SourceFile): string {
  const el = attr.parent?.parent;
  if (el && (ts.isJsxSelfClosingElement(el) || ts.isJsxOpeningElement(el))) {
    return el.tagName.getText(sf);
  }
  return "";
}

/**
 * Formas de egreso de red presentes en un archivo.
 *
 * Es un control de PRESENCIA, no de destino: no se intenta adivinar a dónde
 * apunta una URL construida en runtime. En un módulo del CRUD de clientes no
 * hay egreso legítimo, así que la propiedad correcta es la ausencia de las
 * FORMAS CONOCIDAS de egresar, enumeradas acá una por una. No es «ausencia
 * total de egreso»: un canal armado enteramente en runtime —`Reflect.get`, un
 * `eval`, un destino que llega por parámetro— no deja rastro estático. Lo que
 * cubre ese hueco es el bloque A, que impide traer el módulo del proveedor.
 */
export function egresoDeRed(fuente: string, nombre = "m.tsx"): Egreso[] {
  const sf = parsear(nombre, fuente);
  const out = new Set<Egreso>();

  for (const spec of especificadoresImportados(fuente, nombre)) {
    if (CLIENTES_HTTP.has(spec.split("/")[0])) out.add("CLIENTE_HTTP");
    if (MODULOS_DE_RED.has(spec)) out.add("CLIENTE_HTTP");
  }

  recorrer(sf, (n) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      // Acceso por punto, por índice computado o por `bind`: las tres formas
      // nombran lo mismo y las tres egresan.
      const nom = nombreInvocado(e, sf);
      if (nom === "fetch") out.add("FETCH");
      if (nom === "sendBeacon") out.add("SEND_BEACON");
    }
    if (ts.isElementAccessExpression(n)) {
      const clave = valorEstatico(n.argumentExpression);
      if (clave === "fetch") out.add("FETCH");
      if (clave === "sendBeacon") out.add("SEND_BEACON");
    }
    if (ts.isNewExpression(n)) {
      const nom = n.expression.getText(sf);
      if (/(^|\.)(WebSocket|EventSource)$/.test(nom)) out.add("WEBSOCKET");
      // XMLHttpRequest y Request son APIs canónicas de red, sin ofuscación.
      if (/(^|\.)(XMLHttpRequest|Request)$/.test(nom)) out.add("FETCH");
    }
    if (ts.isJsxAttribute(n) && n.initializer) {
      const etiqueta = etiquetaDe(n, sf);
      const valor = ts.isStringLiteral(n.initializer)
        ? n.initializer.text
        : ts.isJsxExpression(n.initializer) && n.initializer.expression
          ? valorEstatico(n.initializer.expression)
          : null;
      const attr = n.name.getText(sf);
      if (ATRIBUTOS_SIN_EGRESO.has(attr)) return;
      if (etiqueta === "iframe" && attr === "src" && esUrlDeEgreso(valor)) out.add("IFRAME_EXTERNO");
      if (etiqueta === "form" && attr === "action" && esUrlDeEgreso(valor)) {
        out.add("FORM_ACTION_EXTERNO");
      }
    }
    if (ts.isStringLiteralLike(n) || ts.isTemplateExpression(n) || ts.isBinaryExpression(n)) {
      if (esUrlDeEgreso(valorEstatico(n))) out.add("URL_ABSOLUTA");
    }
  });
  return [...out].sort() as Egreso[];
}

// ============================================================================
// C · IDENTIFICADORES CONCRETOS
// ============================================================================

/**
 * Identificadores EXACTOS de configuración de un CRM externo.
 *
 * Es una lista cerrada de nombres concretos, no una familia semántica. Se
 * eligió así a propósito: la versión anterior derivaba «hay CRM y hay algo de
 * configuración» cruzando dos diccionarios, y terminó marcando `accessToken` y
 * `apiKey` legítimos. Un nombre exacto se puede afirmar; una familia, no.
 */
const IDENTIFICADORES_PROHIBIDOS = new Set([
  "clientifyConfigured",
  "crmConfigured",
  "crmEnabled",
  "crmLinked",
  "isCrmLinked",
  "crmToken",
  "crmApiKey",
  "crmBaseUrl",
  "sync_state",
  "sync_attempt",
  "sync_conflict",
  "syncState",
  "syncAttempt",
  "syncConflict",
]);

/** Las mismas entradas, en forma canónica: minúsculas y separadas por `_`. */
const PROHIBIDOS_NORMALIZADOS = new Set(
  [...IDENTIFICADORES_PROHIBIDOS].map((x) => palabras(x).join("_")),
);

export type Identificador = "NOMBRE_PROVEEDOR" | "CADENA_PROVEEDOR" | "CONFIG_CRM_EXTERNO";

/**
 * Identificadores y cadenas concretas del proveedor.
 *
 * El token `clientify` no tiene uso legítimo en el registro maestro: eso es una
 * afirmación verificable, no una heurística. Un solo control cubre la clave de
 * entorno, el host `new.clientify.com`, las props `clientify*` y las ramas
 * `source/origen === "clientify"`, con o sin normalización previa.
 *
 * Los comentarios NO participan: no están en el AST, así que documentar el
 * desacople no puede hacer fallar la guarda.
 */
export function identificadoresProhibidos(fuente: string, nombre = "m.tsx"): Identificador[] {
  const sf = parsear(nombre, fuente);
  const out = new Set<Identificador>();

  const agregar = (id: ts.Node | undefined) => {
    if (!id) return;
    const texto = ts.isIdentifier(id) ? id.text : ts.isStringLiteral(id) ? id.text : "";
    if (!texto) return;
    const w = palabras(texto);
    if (w.includes("clientify")) out.add("NOMBRE_PROVEEDOR");
    // Se compara la forma NORMALIZADA, así `crmConfigured`, `crm_configured` y
    // `CRM_CONFIGURED` son el mismo nombre. Enumerar sólo una de las grafías
    // dejaba pasar las otras dos por una asimetría sin sentido.
    if (PROHIBIDOS_NORMALIZADOS.has(w.join("_"))) out.add("CONFIG_CRM_EXTERNO");
  };

  recorrer(sf, (n) => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateExpression(n) || ts.isBinaryExpression(n)) {
      const v = valorEstatico(n);
      if (v && /clientify/i.test(v)) out.add("CADENA_PROVEEDOR");
    }
    // El TEXTO de un elemento JSX no es un literal de cadena: es su propio tipo
    // de nodo. Sin esta rama, «Datos tomados de Clientify.» escrito como texto
    // de pantalla era invisible para este bloque —un C4 lo midió en siete
    // regiones distintas— y la suite entera pasaba en verde sobre el token
    // exacto del proveedor.
    if (ts.isJsxText(n) && /clientify/i.test(n.text)) out.add("CADENA_PROVEEDOR");
    const nom = (n as { name?: ts.Node }).name;
    if (
      ts.isVariableDeclaration(n) ||
      ts.isParameter(n) ||
      ts.isBindingElement(n) ||
      ts.isPropertyDeclaration(n) ||
      ts.isPropertySignature(n) ||
      ts.isPropertyAssignment(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isMethodSignature(n) ||
      ts.isFunctionDeclaration(n) ||
      ts.isEnumMember(n)
    ) {
      if (nom && !ts.isObjectBindingPattern(nom) && !ts.isArrayBindingPattern(nom)) agregar(nom);
    } else if (ts.isShorthandPropertyAssignment(n)) agregar(n.name);
    else if (ts.isJsxAttribute(n)) agregar(n.name as unknown as ts.Node);
    else if (ts.isPropertyAccessExpression(n)) agregar(n.name);
  });
  return [...out].sort() as Identificador[];
}

// ============================================================================
// D · CONTRATO DE ESQUEMA
// ============================================================================

const MIGRACIONES_DEL_MAESTRO = [
  "0240_clientes_permission_module.sql",
  "0241_clients_native_master.sql",
  "0242_clients_atomic_mutations.sql",
  "ROLLBACK_0240_clientes_permission_module.sql",
  "ROLLBACK_0241_clients_native_master.sql",
  "ROLLBACK_0242_clients_atomic_mutations.sql",
] as const;

/** Quita comentarios SQL: se mide el DDL, no la prosa que lo explica. */
function sqlSinComentarios(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
}

/**
 * Identificadores de esquema prohibidos por el contrato: identidad externa,
 * estado de sincronización, procedencia del CRM, reintentos y auditoría de
 * sincronización.
 */
export function violacionesDeEsquema(sql: string): string[] {
  const codigo = sqlSinComentarios(sql);
  const out = new Set<string>();
  const reglas: Array<[RegExp, string]> = [
    [/\bclientify\w*/i, "identificador del proveedor"],
    [/\bexternal_(id|source|ref|key)\b/i, "identidad externa"],
    [/\bsync_\w+/i, "estado o auditoría de sincronización"],
    [/\blast_sync\w*/i, "marca de sincronización"],
    [/\bretry_count\b/i, "reintentos de CRM"],
  ];
  for (const [re, motivo] of reglas) {
    const m = codigo.match(re);
    if (m) out.add(`${motivo}: ${m[0]}`);
  }
  return [...out].sort();
}

// ============================================================================
// PRUEBAS
// ============================================================================

describe("A · aislamiento estructural del registro maestro", () => {
  const SUP = superficies();
  const CIERRE = clausura();

  it("las superficies se derivan por directorio y cubren el CRUD completo", () => {
    expect(SUP.length).toBeGreaterThanOrEqual(16);
    for (const esperado of [
      "src/app/(app)/clientes/[id]/page.tsx",
      "src/app/(app)/clients/ClientsView.tsx",
      "src/app/(app)/clients/actions.ts",
      "src/lib/data/clients.ts",
      "src/lib/clients-duplicate-confirmation.ts",
      "src/components/ClientSelector.tsx",
      "src/components/comercial/ClienteFiscalEditor.tsx",
    ]) {
      expect(SUP).toContain(esperado);
    }
  });

  it("no hay NINGÚN camino de importación desde el maestro hasta el proveedor", () => {
    const alcanzan = CIERRE.filter((f) =>
      especificadoresImportados(leer(f), f).some(esModuloClientify),
    );
    expect(alcanzan).toEqual([]);
  });

  it("la clausura es transitiva de verdad, no sólo los orígenes", () => {
    expect(CIERRE.length).toBeGreaterThan(SUP.length);
  });

  it("la clausura no tiene tramos ciegos: todo import local resolvió", () => {
    // Un import local que no resuelve es un tramo de grafo que la clausura no
    // recorre. Se declara como fallo en vez de descartarse en silencio.
    expect([...SIN_RESOLVER]).toEqual([]);
  });

  it("TODO archivo que toca la tabla `clients` está clasificado", () => {
    // Cierra el modo de falla que dos revisiones encontraron: la lista de
    // superficies quedaba corta y nadie se enteraba. Un archivo nuevo que toque
    // el maestro rompe esta prueba hasta que alguien decida qué es.
    const dentro = new Set([...SUP, ...CIERRE]);
    const sinClasificar = tocanLaTablaClients().filter(
      (f) => !dentro.has(f) && !(f in AJENOS_DECLARADOS),
    );
    expect(sinClasificar).toEqual([]);
  });

  it("la integración comercial ajena SIGUE EXISTIENDO y fuera de la clausura", () => {
    // Desacoplar el maestro no es borrar la integración: si esta prueba se
    // pusiera verde porque alguien borró el proveedor, estaría certificando un
    // daño mayor que el que vigila. No se fija una cantidad, que es una
    // decisión ajena a este expediente.
    expect(archivosDe("src/lib/clientify").length).toBeGreaterThan(0);
    const ajenos = consumidoresAjenos();
    expect(ajenos.length).toBeGreaterThan(0);
    expect(ajenos.filter((f) => CIERRE.includes(f))).toEqual([]);
  });
});

describe("B · ausencia de egreso de red", () => {
  const MEDIDOS = [...superficies(), ...exclusivasDelMaestro()];

  it("ningún módulo exclusivo del maestro hace egreso fuera de la allowlist", () => {
    const sucios = MEDIDOS.filter((f) => !(f in EGRESO_PERMITIDO))
      .map((f) => [f, egresoDeRed(leer(f), f)] as const)
      .filter(([, e]) => e.length > 0);
    expect(sucios).toEqual([]);
  });

  it("la allowlist de egreso es exacta: cada entrada existe y de verdad egresa", () => {
    // Una allowlist con entradas muertas se convierte en un permiso latente.
    for (const [ruta, motivo] of Object.entries(EGRESO_PERMITIDO)) {
      expect(motivo.length, `${ruta} sin motivo`).toBeGreaterThan(10);
      expect(() => leer(ruta)).not.toThrow();
      expect(egresoDeRed(leer(ruta), ruta).length, `${ruta} ya no egresa`).toBeGreaterThan(0);
    }
  });

  it("el conjunto medido es sustancialmente mayor que las superficies", () => {
    expect(MEDIDOS.length).toBeGreaterThan(superficies().length);
  });
});

describe("C · ausencia de identificadores del proveedor", () => {
  it("ninguna superficie ni módulo exclusivo nombra al proveedor", () => {
    const sucios = [...superficies(), ...exclusivasDelMaestro()]
      .map((f) => [f, identificadoresProhibidos(leer(f), f)] as const)
      .filter(([, v]) => v.length > 0);
    expect(sucios).toEqual([]);
  });
});

describe("D · contrato de esquema del registro maestro", () => {
  it("las seis migraciones del maestro existen: la lista no puede vaciarse sola", () => {
    // Si una se renombrara, `leer` fallaría; si la lista quedara corta, este
    // control pasaría a medir menos sin que nadie lo note.
    expect(MIGRACIONES_DEL_MAESTRO).toHaveLength(6);
    for (const m of MIGRACIONES_DEL_MAESTRO) {
      expect(() => leer(`supabase/migrations/${m}`), m).not.toThrow();
    }
  });

  it("las migraciones no introducen identidad externa ni sincronización", () => {
    const sucias = MIGRACIONES_DEL_MAESTRO.map(
      (m) => [m, violacionesDeEsquema(leer(`supabase/migrations/${m}`))] as const,
    ).filter(([, v]) => v.length > 0);
    expect(sucias).toEqual([]);
  });

  it("`client_events` no admite el vocabulario de sincronización", () => {
    // El CHECK ejecutable se prueba contra Postgres real en
    // tests/db/t-cli-a1-01. Acá se fija el texto del contrato, que es lo que un
    // rollback o un rebase podrían revertir en silencio.
    const ddl = sqlSinComentarios(leer("supabase/migrations/0241_clients_native_master.sql"));
    const check = ddl.match(/kind\s+text\s+not null\s+check\s*\(([^)]*)\)/i);
    expect(check, "no se encontró el CHECK de kind").not.toBeNull();
    expect(check![1]).not.toMatch(/sync/i);
    expect(ddl).not.toMatch(/origin[^)]*'sync'/i);
  });
});

// ============================================================================
// CALIBRACIÓN · mutantes MECÁNICOS OBLIGATORIOS
// ============================================================================

type Mutante = {
  id: string;
  fuente: string;
  esperado: string;
  medir: (f: string, n: string) => string[];
};

const importaProveedor = (f: string, n: string): string[] =>
  especificadoresImportados(f, n).some(esModuloClientify) ? ["IMPORTA_PROVEEDOR"] : [];

/**
 * Cada uno es una forma verificable de romper el aislamiento. Todos deben
 * morir, siempre. No hay frases acá: sólo estructura, egreso e identificadores.
 */
const MUTANTES_MECANICOS: Mutante[] = [
  ...(
    [
      ["import estático", `import { push } from "@/lib/clientify";\nexport const x = push;`],
      ["import type", `import type { E } from "@/lib/clientify/types";\nexport type T = E;`],
      ["import con espacio de nombres", `import * as p from "@/lib/clientify";\nexport const x = p;`],
      ["import nombrado con alias", `import { d as z } from "@/lib/clientify/data";\nexport const x = z;`],
      ["import dinámico", `export const f = () => import("@/lib/clientify");`],
      ["require real", `const m = require("@/lib/clientify");\nexport default m;`],
      ["import x = require()", `import m = require("@/lib/clientify");\nexport default m;`],
      ["re-export nombrado", `export { mapear } from "@/lib/clientify";`],
      ["re-export estrella", `export * from "@/lib/clientify/data";`],
      ["re-export con espacio de nombres", `export * as p from "@/lib/clientify";`],
      ["ruta relativa", `import { x } from "../../lib/clientify/data";\nexport const y = x;`],
      ["extensión .ts explícita", `import { c } from "@/lib/clientify.ts";\nexport const x = c;`],
      ["extensión .tsx", `import { c } from "@/lib/clientify.tsx";\nexport const x = c;`],
      ["extensión .js", `import { c } from "@/lib/clientify.js";\nexport const x = c;`],
      ["extensión .mjs", `import { c } from "@/lib/clientify.mjs";\nexport const x = c;`],
      ["re-export con extensión", `export * from "@/lib/clientify.ts";`],
      ["import dinámico con extensión", `export const f = () => import("@/lib/clientify.ts");`],
      ["SDK publicado del proveedor", `import { Api } from "clientify";\nexport const x = Api;`],
      ["SDK con espacio de nombres", `import { Api } from "@clientify/sdk";\nexport const x = Api;`],
      ["SDK publicado con guion", `import { Api } from "clientify-node";\nexport const x = Api;`],
      ["require real con sombra en OTRO ámbito", `const m = require("@/lib/clientify");\nexport function f(require: (s: string) => string) { return require("x"); }\nexport default m;`],
    ] as const
  ).map(([id, fuente]) => ({
    id: `A · ${id}`,
    fuente,
    esperado: "IMPORTA_PROVEEDOR",
    medir: importaProveedor,
  })),

  ...(
    [
      ["fetch", `export const f = () => fetch("/api/x");`, "FETCH"],
      ["fetch calificado", `export const f = () => window.fetch("/api/x");`, "FETCH"],
      ["axios", `import axios from "axios";\nexport const f = () => axios.get("/x");`, "CLIENTE_HTTP"],
      ["node-fetch", `import f from "node-fetch";\nexport const g = f;`, "CLIENTE_HTTP"],
      ["sendBeacon", `export const f = () => navigator.sendBeacon("/x", "1");`, "SEND_BEACON"],
      ["WebSocket", `export const f = () => new WebSocket("wss://x.example");`, "WEBSOCKET"],
      ["EventSource", `export const f = () => new EventSource("/x");`, "WEBSOCKET"],
      ["iframe externo", `export const V = () => <iframe src="https://x.example/a" />;`, "IFRAME_EXTERNO"],
      ["form con action externo", `export const V = () => <form action="https://x.example/p" />;`, "FORM_ACTION_EXTERNO"],
      ["URL absoluta literal", `export const U = "https://api.example.com/v1";`, "URL_ABSOLUTA"],
      ["URL partida con +", `export const U = "https://api." + "example" + ".com";`, "URL_ABSOLUTA"],
      ["XMLHttpRequest", `export const f = () => new XMLHttpRequest();`, "FETCH"],
      ["new Request", `export const f = () => new Request("/x");`, "FETCH"],
      ["módulo node:https", `import https from "node:https";\nexport const x = https;`, "CLIENTE_HTTP"],
      ["módulo https del runtime", `import https from "https";\nexport const x = https;`, "CLIENTE_HTTP"],
      ["fetch por índice computado", `export const f = () => (globalThis as never)["fetch"]("/x");`, "FETCH"],
      ["sendBeacon por índice", `export const f = () => (navigator as never)["sendBeacon"]("/x");`, "SEND_BEACON"],
      ["sendBeacon por bind", `export const f = navigator.sendBeacon.bind(navigator);`, "SEND_BEACON"],
      ["host que sólo PREFIJA un espacio de nombres", `export const U = "https://w3.org.atacante.example/exfiltrar";`, "URL_ABSOLUTA"],
      ["iframe a un host que prefija un namespace", `export const V = () => <iframe src="https://schema.org.atacante.example/x" />;`, "IFRAME_EXTERNO"],
      ["form action a un host que prefija un namespace", `export const V = () => <form action="https://purl.org.atacante.example/p" />;`, "FORM_ACTION_EXTERNO"],
    ] as const
  ).map(([id, fuente, esperado]) => ({
    id: `B · ${id}`,
    fuente,
    esperado,
    medir: (f: string, n: string) => egresoDeRed(f, n) as string[],
  })),

  ...(
    [
      ["variable de entorno", `export const K = process.env.CLIENTIFY_API_KEY;`, "NOMBRE_PROVEEDOR"],
      ["host del proveedor", `export const U = "https://new.clientify.com/contacts";`, "CADENA_PROVEEDOR"],
      ["host partido con +", `export const U = "https://new." + "clientify" + ".com";`, "CADENA_PROVEEDOR"],
      ["prop clientifyConfigured", `export const V = ({ clientifyConfigured }: { clientifyConfigured: boolean }) => <b>{String(clientifyConfigured)}</b>;`, "NOMBRE_PROVEEDOR"],
      ["prop crmConfigured", `export const V = ({ crmConfigured }: { crmConfigured: boolean }) => <b>{String(crmConfigured)}</b>;`, "CONFIG_CRM_EXTERNO"],
      ["prop isCrmLinked", `export const V = ({ isCrmLinked }: { isCrmLinked: boolean }) => <b>{String(isCrmLinked)}</b>;`, "CONFIG_CRM_EXTERNO"],
      ["crmToken", `export const c = { crmToken: "x" };`, "CONFIG_CRM_EXTERNO"],
      ["rama por procedencia", `export const f = (origen: string) => origen === "clientify";`, "CADENA_PROVEEDOR"],
      ["rama con normalización previa", `export const f = (s?: string) => s?.toLowerCase() === "clientify";`, "CADENA_PROVEEDOR"],
      ["literal dentro de includes", `export const f = (s: string) => ["clientify"].includes(s);`, "CADENA_PROVEEDOR"],
      ["case por procedencia", `export const f = (s: string) => { switch (s) { case "clientify": return 1; default: return 0; } };`, "CADENA_PROVEEDOR"],
      ["token en TEXTO de un elemento JSX", `export const V = () => <p>Datos tomados de Clientify.</p>;`, "CADENA_PROVEEDOR"],
      ["token en texto JSX partido por una interpolación", `export const V = ({ n }: { n: number }) => <p>Buscá en Client{n}ify y en Clientify.</p>;`, "CADENA_PROVEEDOR"],
      ["token en un fragmento", `export const V = () => <>Sincronizado con Clientify</>;`, "CADENA_PROVEEDOR"],
      ["sync_state", `export const s = { sync_state: "pending" };`, "CONFIG_CRM_EXTERNO"],
      ["syncConflict", `export const syncConflict = false;`, "CONFIG_CRM_EXTERNO"],
      ["crm_configured en snake_case", `export const s = { crm_configured: true };`, "CONFIG_CRM_EXTERNO"],
      ["CRM_CONFIGURED en mayúsculas", `export const CRM_CONFIGURED = true;`, "CONFIG_CRM_EXTERNO"],
      ["SYNC_STATE", `export const SYNC_STATE = "x";`, "CONFIG_CRM_EXTERNO"],
      ["especificador guardado en variable", `const MOD = "@/lib/clientify";\nexport const f = () => import(MOD);`, "CADENA_PROVEEDOR"],
    ] as const
  ).map(([id, fuente, esperado]) => ({
    id: `C · ${id}`,
    fuente,
    esperado,
    medir: (f: string, n: string) => identificadoresProhibidos(f, n) as string[],
  })),
];

/**
 * Fuentes LEGÍTIMAS. Ninguna puede disparar ninguno de los tres controles.
 *
 * Sin esta mitad, la forma más fácil de «pasar» sería endurecer hasta morder
 * código correcto, y la guarda quedaría inservible: la primera vez que rompiera
 * por un `const asyncResult = …`, alguien la borraría. Todas éstas rompían
 * alguna versión anterior del control, y están acá para que no vuelva a pasar.
 */
const LEGITIMAS: Array<{ id: string; fuente: string }> = [
  { id: "asyncResult — `sync` es subcadena de `async`", fuente: `export const f = async () => { const asyncResult = await Promise.resolve(1); return asyncResult; };` },
  { id: "propiedad `async: true`", fuente: `export const opts = { async: true };` },
  { id: "iterador asíncrono", fuente: `export const asyncIterator = Symbol.asyncIterator;` },
  { id: "tokens de sesión propios", fuente: `export const s = { accessToken: "", refreshToken: "", idempotencyKey: "", apiKey: "" };` },
  { id: "identificador externo de AFIP", fuente: `export const p = { external_id: "20304050607", fuente: "afip" };` },
  { id: "import de tipos del CRM propio de Nexus", fuente: `import type { CrmLead } from "@/lib/comercial/crm-types";\nexport type T = CrmLead;` },
  { id: "ruta interna que menciona crm", fuente: `export const R = "/comercial/crm/leads";` },
  { id: "clase CSS crm-panel", fuente: `export const V = () => <div className="crm-panel" />;` },
  { id: "conectar un dispositivo nuestro", fuente: `export const V = () => <button>Conectar el lector de códigos</button>;` },
  { id: "enviar un remito al proveedor (compras)", fuente: `export const V = () => <button>Enviar el remito al proveedor</button>;` },
  { id: "exportar proveedores a Excel", fuente: `export const V = () => <button>Exportar proveedores a Excel</button>;` },
  { id: "sincronizar el reloj del depósito", fuente: `export const V = () => <button>Sincronizar el reloj del depósito</button>;` },
  { id: "integridad de un certificado externo", fuente: `export const V = () => <span>Verificar la integridad del certificado externo</span>;` },
  { id: "decodeURIComponent legítimo", fuente: `export const f = (s: string) => decodeURIComponent(s);` },
  { id: "require sombreado no es una importación", fuente: `const require = (s: string) => s;\nexport const V = () => <span>{require("hola")}</span>;` },
  { id: "ruta relativa interna", fuente: `import { x } from "./utils";\nexport const y = x;` },
  { id: "enlace interno de Next", fuente: `export const V = () => <a href="/clientes/1">Ficha</a>;` },
  { id: "iframe interno", fuente: `export const V = () => <iframe src="/preview/1" />;` },
  { id: "comentario que documenta el desacople", fuente: `// Clientify quedó fuera del maestro: no se importa desde acá.\n/* Ni por import("@/lib/clientify"). */\nexport const x = 1;` },
  { id: "clave de React llamada key", fuente: `export const V = ({ xs }: { xs: string[] }) => <ul>{xs.map((x) => <li key={x}>{x}</li>)}</ul>;` },
  { id: "espacio de nombres SVG en línea", fuente: `export const V = () => <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" />;` },
  { id: "contexto JSON-LD", fuente: `export const ld = { "@context": "https://schema.org", "@type": "Organization" };` },
  { id: "reintentos propios", fuente: `export const p = { retryCount: 0, maxAttempts: 3 };` },
  { id: "enlace mailto", fuente: `export const V = () => <a href="mailto:hola@ejemplo.test">Escribir</a>;` },
];

describe("calibración mecánica", () => {
  it.each(MUTANTES_MECANICOS)("mata el mutante: $id", ({ fuente, esperado, medir }) => {
    expect(medir(fuente, "mutante.tsx")).toContain(esperado);
  });

  it.each(LEGITIMAS)("no muerde código legítimo: $id", ({ fuente }) => {
    expect(identificadoresProhibidos(fuente, "legitima.tsx")).toEqual([]);
    expect(egresoDeRed(fuente, "legitima.tsx")).toEqual([]);
    expect(especificadoresImportados(fuente, "legitima.tsx").some(esModuloClientify)).toBe(false);
  });

  it("`async` no es `sync`: la partición en palabras lo demuestra", () => {
    expect(palabras("asyncResult")).toEqual(["async", "result"]);
    expect(palabras("CLIENTIFY_API_KEY")).toEqual(["clientify", "api", "key"]);
  });

  it("un `require` sombreado no cuenta como importación", () => {
    const conSombra = `const require = (s: string) => s;\nexport const x = require("@/lib/clientify");`;
    const sinSombra = `export const x = require("@/lib/clientify");`;
    expect(especificadoresImportados(conSombra).some(esModuloClientify)).toBe(false);
    expect(especificadoresImportados(sinSombra).some(esModuloClientify)).toBe(true);
  });

  it("el esquema se mide sobre DDL, no sobre los comentarios que lo explican", () => {
    expect(violacionesDeEsquema("-- sync_state y clientify quedaron afuera\ncreate table t (id int);")).toEqual([]);
    expect(violacionesDeEsquema("create table t (sync_state text);")).not.toEqual([]);
    expect(violacionesDeEsquema("create table t (external_id text);")).not.toEqual([]);
    expect(violacionesDeEsquema("create table t (clientify_id text);")).not.toEqual([]);
  });
});

// ============================================================================
// LO QUE ESTA GUARDA NO DECIDE
// ============================================================================

/**
 * Casos que las revisiones adversariales construyeron y que esta guarda NO
 * clasifica.
 *
 * No son PASS: son `NOT APPLICABLE` para un control mecánico. Quedan acá
 * enumerados, sin aserción sobre su detección, porque son el material de la
 * revisión humana del C4 — y porque enumerarlos impide que alguien los dé por
 * cubiertos leyendo una suite en verde.
 */
export const NO_DECIDIBLE_MECANICAMENTE: ReadonlyArray<{ caso: string; porque: string }> =
  Object.freeze([
    {
      caso: "«Enviar los clientes al proveedor» frente a «Enviar el remito al proveedor»",
      porque:
        "difieren en una palabra y en todo; ninguna partición de verbos y objetos separa el español bien formado del español bien formado",
    },
    {
      caso: "«Vincular con el sistema comercial», «Enlazar con la plataforma», «Subir la cartera»",
      porque:
        "vocabulario abierto: cada frase nueva exige un término nuevo y el diccionario no cierra nunca",
    },
    {
      caso: "Nombre del proveedor armado con join, replace, base64 o fromCharCode",
      porque:
        "la ofuscación arbitraria no es decidible estáticamente; lo que sí la cubre es la prohibición de importar el módulo, que es exacta",
    },
    {
      caso: "Egreso cuyo destino se arma en tiempo de ejecución",
      porque:
        "no se puede afirmar a dónde apunta, y por eso el bloque B prohíbe TODO egreso en el CRUD en vez de intentar adivinar el destino",
    },
    {
      caso: "Texto de interfaz que llega por i18n remoto o por una prop opaca",
      porque: "no hay literal que leer en el árbol",
    },
    {
      caso: "Los bloques B y C no cubren toda la clausura",
      porque:
        "se miden sobre superficies y módulos exclusivos; los módulos COMPARTIDOS de la clausura quedan sólo bajo el bloque A, porque aplicarles la semántica rompía sobre código legítimo de otros dominios",
    },
    {
      caso: "El bloque D mide una lista fija de seis migraciones del expediente",
      porque:
        "una migración futura del maestro no queda medida hasta que se la agregue; el control ejecutable del CHECK vive en la suite DB contra Postgres real",
    },
    {
      caso: "Un módulo con egreso permitido puede ser importado por una superficie",
      porque:
        "`@/lib/email` está en la allowlist y lo importa el alta de Órdenes: el canal existe y es legítimo, pero lo que viaje por él no lo observa el bloque B",
    },
    {
      caso: "Las pruebas de render montan estados concretos, no pantallas enteras",
      porque:
        "cada superficie tiene regiones que dependen del estado —un cartel de advertencia, un vacío de búsqueda, un paso posterior del wizard— y sólo se montan las que la prueba acciona; el token del proveedor en cualquiera de ellas lo atrapa el bloque C, que sí lee todo el árbol",
    },
    {
      caso: "Egreso o especificador armados enteramente en tiempo de ejecución",
      porque:
        "`Reflect.get(window,\"fetch\")`, un destino que llega por parámetro o un nombre reconstruido con `join`/base64 no dejan rastro estático que leer",
    },
  ]);

describe("límites declarados", () => {
  it("los casos no decidibles están enumerados y son materia del C4", () => {
    // Esta prueba NO afirma que los casos estén cubiertos: afirma que están
    // DECLARADOS. Es la diferencia entre un límite honesto y un agujero.
    expect(NO_DECIDIBLE_MECANICAMENTE.length).toBeGreaterThanOrEqual(5);
    for (const { caso, porque } of NO_DECIDIBLE_MECANICAMENTE) {
      expect(caso.length).toBeGreaterThan(20);
      expect(porque.length).toBeGreaterThan(30);
    }
  });
});
