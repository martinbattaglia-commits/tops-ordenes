# Nexus Voice v1 — Diseño

- **Fecha:** 2026-07-09
- **Estado:** Diseño aprobado. Pendiente plan de implementación.
- **Rama:** `feat/nexus-voice`, creada desde `0c361c0` (`fix/f5-2-copilot-context-retrieval`).
- **Worktree:** `~/CODE/tops-ordenes-nexus-voice`
- **Autoriza:** Martín Battaglia.

---

## 1. Qué es Nexus Voice

Una capa universal de captura de voz que convierte habla en texto limpio y lo entrega a
quien la invocó. No es un módulo. No es un componente. Es un **servicio de plataforma**
sin lógica de negocio, consumible desde React y desde código plano.

Su única responsabilidad:

```
Usuario → Micrófono → Reconocimiento → Texto normalizado → Destino
```

El servicio **nunca** sabe si el texto termina en Copilot, en una observación de una
orden de servicio, en Nexus Link o en un workflow. Devuelve texto y se retira.

Internamente la tecnología es *speech-to-text*. De cara al código, la documentación y
el producto, la capacidad se llama **Nexus Voice**, para que la incorporación futura de
síntesis de voz, conversación continua o wake word no obligue a renombrar la
arquitectura.

---

## 2. Realidad del código sobre la que se construye

Cinco hechos verificados en `0c361c0`. El diseño se apoya en ellos, no en supuestos.

1. **No existe un primitivo `<Input>` / `<Textarea>` de React.** `src/components/ui/`
   contiene solo `EmptyState.tsx` y `Skeleton.tsx`. El sistema de diseño vive en CSS
   (`.input`, `.textarea` en `src/app/globals.css:210-223`). Los campos son `<input>` y
   `<textarea>` nativos. Por lo tanto `<TextInput voiceEnabled />` no es viable sin un
   refactor transversal, y ese refactor queda **fuera de alcance**.

2. **El Copilot solo existe en esta línea de commits.** `origin/main` no contiene
   `src/app/(app)/copilot/`. `0c361c0` está 136 commits adelante de `main` y es lo que
   corre en producción. Es la única base posible.

3. **La superficie real de dictado es acotada.** De los `<input>` del sistema, 186 son
   `type="button"`, 35 `submit`, 17 `number`, 16 `date`, 8 `checkbox`. El texto libre
   vive en 14 archivos con `<textarea>`, el input del Copilot, y unos pocos
   `type="text"` / `type="search"`.

4. **No hay jsdom ni testing-library.** Los 92 tests del repo son `.test.ts` en entorno
   `node`; hay cero `.test.tsx`. Como no se admiten dependencias nuevas, toda la lógica
   testeable debe ser pura y vivir fuera de React.

5. **No hay editor enriquecido.** Ni `tiptap`, ni `slate`, ni `lexical`, ni
   `contenteditable`. El requisito original de soportarlo se elimina por inexistente.

---

## 3. Arquitectura

### 3.1 Principio rector: Motor ≠ Sesión

```
                        VoiceSession
             estados · permisos · cancelación · timeout
             medidor · eventos · ciclo de vida · recursos
                              │
                              │ usa
                              ▼
                        VoiceEngine
              habla con el proveedor de reconocimiento
        Web Speech · OpenAI · Google · Azure · Apple · propio
```

El motor solo sabe hablar con su proveedor. La sesión administra todo lo demás. Esta
separación es lo que permite, sin rediseñar el núcleo, incorporar cancelación,
reanudación, transcripción continua o varios micrófonos.

### 3.2 Consumidores: una sola sesión, dos modos

```
                        VoiceSession
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  useVoiceSession    NexusVoice.capture()      Futuras APIs
        │                     │                     │
   VoiceField          Copilot · Link         Workflows · TTS
   (Modo Campo)         (Modo Global)          (wake word)
```

**No hay dos implementaciones.** `NexusVoice.capture()` es un envoltorio `Promise` sobre
una `VoiceSession`; `useVoiceSession` es un binding de React sobre la misma
`VoiceSession`.

### 3.3 Frontera de dependencias

**`src/lib/voice/` nunca importa React.** Toca el navegador únicamente en tres archivos
(`engines/`, `meter.ts`, `dom.ts`), cada uno detrás de una detección de capacidad. Esa
frontera es lo que hace que `NexusVoice.capture()` funcione desde un workflow, un modal
o un test de Node sin árbol de React.

```
src/lib/voice/                    ← cero React
  types.ts        VoiceState · VoiceError · VoiceEngine · VoiceSession · Punctuator
  machine.ts      reducer puro de los 4 estados                    ── PURO
  normalize.ts    normalización determinística                     ── PURO
  punctuation/
    index.ts      resolvePunctuator(strategy)
    none.ts       identidad                                        ── PURO
    commands.ts   comandos hablados inequívocos                    ── PURO
    provider.ts   confía en la puntuación del motor                ── PURO
  insert.ts       (valor, selStart, selEnd, texto) → {valor, caret} ── PURO
  meter.ts        getUserMedia + AnalyserNode → nivel 0..1
  dom.ts          aplica texto a un <input>/<textarea> real
  engines/
    web-speech.ts implementación VoiceEngine
    index.ts      resolveEngine() + detección de soporte
  session.ts      VoiceSession
  config.ts       resolver de habilitación por fuentes
  nexus-voice.ts  fachada pública (singleton)

src/components/voice/             ← React delgado, sin lógica
  useVoiceSession.ts   binding React ↔ VoiceSession
  VoiceMicButton.tsx   UI de los 4 estados + barras de nivel
  VoiceField.tsx       Modo Campo
  VoiceOverlay.tsx     Modo Global — montado una sola vez en el shell
```

---

## 4. Contratos

### 4.1 VoiceEngine

El motor **declara sus capacidades** en vez de que la sesión las asuma. Es lo que
permite reemplazarlo sin tocar nada más.

```ts
interface VoiceEngineCapabilities {
  partialResults: boolean;        // ¿emite texto mientras se habla?
  requiresMediaStream: boolean;   // ¿consume el stream que abre la sesión?
  providesPunctuation: boolean;   // ¿devuelve texto ya puntuado?
  locales: string[] | "any";
}

interface VoiceEngineStartContext {
  locale: string;
  stream: MediaStream | null;     // provisto por la sesión
  onPartial(text: string): void;
  onFinal(text: string): void;
  onError(error: VoiceError): void;
}

interface VoiceEngine {
  readonly id: string;
  readonly capabilities: VoiceEngineCapabilities;
  isAvailable(): boolean;
  start(ctx: VoiceEngineStartContext): Promise<void>;
  stop(): Promise<void>;   // corte amable: esperar el resultado final
  abort(): void;           // corte duro: descartar
}
```

`web-speech.ts` v1 declara: `partialResults: true`, `requiresMediaStream: false`,
`providesPunctuation: false`, `locales: ["es-AR", ...]`.

La sesión **siempre** intenta abrir el stream de micrófono, porque lo necesita el
medidor, y se lo pasa al motor por contexto. Web Speech lo ignora (abre el suyo). Un
motor futuro basado en `MediaRecorder` lo consume. El nivel de audio es una propiedad
del **micrófono**, no del transcriptor, y por eso vive en la sesión.

### 4.2 VoiceSession

```ts
type VoiceState = "idle" | "listening" | "processing" | "error";

interface VoiceSessionOptions {
  locale?: string;                 // "es-AR"
  engine?: VoiceEngine;            // resolveEngine()
  createMeter?: VoiceMeterFactory; // inyectable → testeable en node
  punctuationStrategy?: PunctuationStrategy; // "none"
  autoStopOnSilenceMs?: number;    // undefined = desactivado
  maxDurationMs?: number;          // 120_000
  processingGuardMs?: number;      // 3_000
}

interface VoiceSessionEvents {
  state:   (state: VoiceState) => void;
  partial: (text: string) => void;   // crudo, sin normalizar. NUNCA toca el campo.
  level:   (rms: number) => void;    // 0..1
  final:   (text: string) => void;   // puntuado + normalizado
  error:   (error: VoiceError) => void;
}

interface VoiceSession {
  readonly state: VoiceState;
  start(): Promise<void>;
  stop(): Promise<void>;   // FINALIZAR  → conserva el texto → "processing" → "idle"
  cancel(): void;          // CANCELAR   → descarta          → "idle". No es error.
  on<K extends keyof VoiceSessionEvents>(e: K, cb: VoiceSessionEvents[K]): () => void;
  dispose(): void;         // libera stream, AudioContext, timers, listeners
}
```

**Invariante de propiedad del texto:** quien crea la sesión es dueño del destino de su
texto. La sesión no conoce el destino. Un takeover solo espera que el dueño anterior
termine de recibir el suyo.

### 4.3 Fachada pública

```ts
const NexusVoice: {
  configure(opts: { sources: VoiceConfigSource[] }): void;
  isEnabled(): boolean;
  isSupported(): boolean;

  readonly active: VoiceSession | null;
  subscribe(cb: (session: VoiceSession | null) => void): () => void;

  acquire(opts?: VoiceSessionOptions): VoiceSession;   // ESTRICTO
  releaseActive(): Promise<void>;                      // stop() al activo, si hay

  capture(opts?: VoiceSessionOptions & {
    conflict?: "takeover" | "reject";   // "takeover"
    headless?: boolean;                 // false → lo renderiza VoiceOverlay
    signal?: AbortSignal;
  }): Promise<string | null>;
};
```

### 4.4 `capture()` devuelve `string | null`

- Dictado exitoso → `string`.
- **Cancelación del usuario → `null`.**
- Error real → rechaza con una excepción específica.

La cancelación **nunca** se representa como un error. Devolver `""` al cancelar sería
indistinguible de "el usuario habló y no dijo nada".

```ts
const texto = await NexusVoice.capture();
if (texto === null) return;   // el usuario canceló
```

---

## 5. Sesión única y política de conflicto

**No pueden existir dos sesiones simultáneas.** Un solo micrófono, una sola dueña.

**Núcleo — estricto.** `NexusVoice.acquire()` lanza `VoiceSessionAlreadyRunningError` si
ya hay una sesión activa. Nunca adivina.

**Aplicación — takeover por defecto.** El takeover ejecuta `stop()` sobre la sesión
anterior, **jamás `cancel()`**. Secuencia obligatoria:

1. El usuario inicia una nueva captura.
2. La sesión anterior recibe `stop()`.
3. Se espera su transcripción final.
4. Su texto se inserta **en su campo original**.
5. Se libera el micrófono.
6. Recién entonces arranca la nueva sesión.

Cero pérdida de datos, cero inserciones en el campo equivocado.

`conflict: "reject"` sigue disponible para flujos críticos que no deban ser
interrumpidos: propaga `VoiceSessionAlreadyRunningError` al llamador.

**Por qué no reutilizar la sesión existente:** si el Copilot está escuchando y el usuario
hace clic en el micrófono de "observaciones" de una OS, reutilizar la sesión insertaría
el dictado en el campo equivocado. Es corrupción silenciosa de datos.

---

## 6. Máquina de estados

Exactamente cuatro estados. Ninguno intermedio.

```
idle ──start()──▶ listening ──stop()──▶ processing ──final──▶ idle
                      │                      │
                      ├──cancel()──▶ idle    └──guard 3s──▶ idle
                      └──error────▶ error ──start()/dismiss──▶ idle
```

| Transición | Disparadores | Texto |
|---|---|---|
| `idle → listening` | clic en micrófono, Enter, Espacio | — |
| `listening → processing` | **Finalizar**: clic en micrófono, botón Finalizar, blur del campo, `maxDurationMs` | se conserva |
| `listening → idle` | **Cancelar**: `Escape`, botón Cancelar, `dispose()` | se descarta |
| `processing → idle` | resultado final del motor, o guard de 3 s | se inserta |
| `* → error` | permiso denegado, sin micrófono, falla del reconocedor, silencio prolongado | se descarta |
| `error → idle` | próximo `start()` o descarte del mensaje | — |

**Guard de `processing` (3 s).** Un motor puede no emitir nunca su evento final. Sin el
guard, el spinner queda colgado para siempre. Al vencer: se inserta el texto disponible,
se vuelve a `idle`, y **si el motor sigue vivo se registra un warning interno**
(`console.warn` con el `engine.id`) para diagnosticar motores que no entregan el evento
final. **Ese warning nunca se muestra al usuario.**

### 6.1 Finalizar vs Cancelar

Esta distinción se mantiene **en toda la arquitectura**, sin excepción de contexto.

| Acción | Método | Texto | Micrófono | Estado final |
|---|---|---|---|---|
| **Finalizar** | `stop()` | se conserva e inserta | se libera | `idle` |
| **Cancelar** | `cancel()` | se descarta | se libera | `idle` |

**`Escape` = Cancelar. Siempre. En todo Nexus.**

> Esta regla **deroga** la definición previa del pedido original, que asignaba a `Escape`
> el rol de finalizar. Una tecla universalmente asociada a "cancelar" nunca debe
> confirmar información.

El texto se preserva **exclusivamente** mediante: botón Finalizar, clic sobre el
micrófono, blur del campo, o el timeout amable (`maxDurationMs` → `stop()`).

---

## 7. Puntuación: estrategia, no booleano

```ts
type PunctuationStrategy = "none" | "provider" | "commands" | "ai";

interface Punctuator {
  readonly id: PunctuationStrategy;
  apply(text: string): Promise<string>;
}
```

El pipeline es siempre: `texto crudo → Punctuator → normalize() → insert()`.
`normalize()` corre **siempre**, es puro y síncrono.

### `"none"` — por defecto en v1

Solo normalización determinística, en `normalize.ts`:

- Unicode NFC
- `trim`
- colapso de espacios consecutivos
- mayúscula inicial
- mayúscula después de `.`, `!`, `?`
- corrección del espacio previo a un signo de puntuación

### `"provider"`

Confía en la puntuación que entregue el motor, cuando `capabilities.providesPunctuation`
es `true`. Web Speech declara `false`, así que con este motor la estrategia degrada a
`"none"` y registra un warning interno.

### `"commands"` — opt-in en v1

Interpreta **únicamente comandos inequívocos multi-palabra**:

- `"nueva línea"` → `\n`
- `"nuevo párrafo"` → `\n\n`
- `"punto y aparte"` → `.\n`
- `"signo de interrogación"` → `?`
- `"signo de exclamación"` → `!`

**Nunca** se mapean palabras aisladas como `"punto"` o `"coma"`: romperían *"el **punto**
de encuentro"* y *"que **coma** tranquilo"*. En un ERP donde se dictan observaciones
operativas, eso corrompe datos en silencio.

### `"ai"` — preparada, no implementada en v1

Envía **únicamente el texto ya transcripto** a un LLM (Gemini / Copilot) para mejorar
puntuación, capitalización y formato. **Jamás envía audio.** La ranura existe en el tipo
y en `resolvePunctuator()`; solicitarla en v1 lanza un `Error` común de configuración
—no un `VoiceError`—, porque es un error del programador, no del usuario, y nunca debe
llegar a la interfaz.

### 7.1 La ausencia de puntuación automática es una decisión de producto

**Esto no es una limitación accidental de la implementación. Es una decisión deliberada,
tomada con conocimiento de la alternativa y de su costo.**

Con Web Speech API y sin pasar por un LLM, la puntuación automática real no existe.
`"ai"` es el único camino hacia ella. Se evaluó y se descartó para v1: incorporar un LLM
únicamente para puntuar agregaría complejidad, latencia y costo por dictado a un servicio
cuyo objetivo es ser confiable, reutilizable y desacoplado.

**El objetivo de Nexus Voice v1 es resolver la captura de voz.** La mejora lingüística del
texto es una capacidad distinta, y se considerará en versiones posteriores.

En consecuencia:

- `"none"` es el **comportamiento oficial de v1**.
- `"commands"` se implementa **solo** para comandos inequívocos multi-palabra.
- `"provider"` queda preparada para motores con puntuación nativa.
- `"ai"` queda **modelada como extensión futura y fuera del criterio de aceptación de
  v1**.

Quien lea este documento dentro de un año no debe concluir que la puntuación "quedó
pendiente por falta de tiempo". Se decidió no hacerla, y esta sección es el registro de
esa decisión.

---

## 8. Tres trampas del navegador que el diseño absorbe

No son detalles de implementación. Son la razón por la que el código funciona o no.

**1. Chrome corta el reconocimiento por su cuenta.** `SpeechRecognition` emite `end` tras
unos segundos de silencio aunque `continuous = true`. Sin reinicio, el dictado muere a
los pocos segundos y parece un bug de Nexus. `web-speech.ts` mantiene un flag
`wantsToListen` y **reinicia el reconocedor en `end`** hasta recibir `stop()` o
`abort()`. La sesión permanece en `listening` mientras el motor, por debajo, se reinicia
varias veces. Este es exactamente el motivo por el que motor y sesión están separados.

**2. Hacer clic en el micrófono le roba el foco al campo.** Con el foco se va el cursor,
y "insertar exactamente en el cursor" falla. `VoiceMicButton` ejecuta `preventDefault()`
en `mousedown`: el campo **nunca pierde el foco**, `selectionStart` sobrevive, y el texto
entra donde el usuario lo dejó.

**3. Los resultados parciales nunca tocan el campo.** Escribir parciales y reescribirlos
destruye el historial de deshacer y bombardea a Copilot con eventos `onChange`. Los
parciales se muestran **junto** al campo como texto en vivo. **La inserción ocurre
exactamente una vez, solo con el resultado final.** "Tiempo real" es la retroalimentación
—barras de nivel y texto en vivo—, no la inserción progresiva.

---

## 9. Inserción: garantía técnica, no convención

```ts
// src/lib/voice/dom.ts
// El prototipo se elige según el tipo de elemento: un setter tomado de
// HTMLTextAreaElement no funciona sobre un <input>, y viceversa.
const proto = el instanceof HTMLTextAreaElement
  ? HTMLTextAreaElement.prototype
  : HTMLInputElement.prototype;

const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
setter.call(el, nextValue);
el.dispatchEvent(new Event("input", { bubbles: true }));
```

React escucha `input` en la raíz del árbol. Al despachar un evento `input` nativo sobre
el elemento real, React ejecuta el `onChange` del componente **sin poder distinguirlo de
una pulsación de tecla**.

Copilot no "acepta" texto de voz: **es incapaz de notar la diferencia**. Esa incapacidad
*es* la garantía. No hay rama de código que auditar, ni convención que respetar, ni
lógica específica dentro de Copilot, Nexus Link ni ningún otro consumidor.

### Reglas de `insert.ts` (puro)

Dado `(valor, selStart, selEnd, texto)`:

- Si `selStart !== selEnd`, el texto **reemplaza la selección**.
- Si no, se **inserta en el caret**.
- Se antepone un espacio si el texto previo no termina en espacio, salto de línea o
  carácter de apertura (`(`, `¿`, `¡`, `"`).
- **No** se antepone espacio si el texto insertado empieza con `,` `.` `;` `:`.
- Se agrega un espacio posterior si lo que sigue no es espacio ni puntuación.
- El caret queda al final del fragmento insertado.

---

## 10. Permisos, medidor y degradación

La **sesión** pide los permisos, no el motor. Primero `getUserMedia`; solo si concede,
arranca el reconocedor. Así, si el usuario deniega, el error es limpio y el reconocedor
nunca llegó a existir. Una sola solicitud de permiso: Web Speech reutiliza la concedida.

| Situación | Resultado |
|---|---|
| `NotAllowedError` / `SecurityError` | `VoicePermissionDeniedError` — fatal |
| Otra falla, y `requiresMediaStream: true` | `VoiceRecognitionError("no-microphone")` — fatal |
| Otra falla, y `requiresMediaStream: false` | warning interno, **medidor apagado, transcripción continúa** |
| `AudioContext` / `AnalyserNode` no disponibles | **medidor apagado, transcripción continúa** |

**El medidor es real.** `getUserMedia` + `AnalyserNode` → RMS normalizado a `0..1`, que
alimenta las barras. **Nunca una animación simulada:** un medidor falso le confirmaría al
usuario que el micrófono capta su voz incluso cuando no capta nada, que es exactamente el
problema que el medidor existe para resolver. Cuando el medidor no está disponible, el
micrófono degrada a un **pulso simple** y el dictado sigue funcionando.

---

## 11. Errores

```ts
class VoiceError extends Error { readonly code: VoiceErrorCode }

class VoicePermissionDeniedError      extends VoiceError  // "permission-denied"
class VoiceEngineUnavailableError     extends VoiceError  // "engine-unavailable"
class VoiceRecognitionError           extends VoiceError  // "recognition" | "no-speech"
                                                          // | "network" | "no-microphone"
class VoiceSessionAlreadyRunningError extends VoiceError  // "session-already-running"
```

La cancelación no aparece en esta taxonomía, por definición.

Dos casos que deliberadamente **no** son errores visibles:

- **Navegador incompatible** (Firefox): `isSupported()` es `false` y `VoiceField` **no
  renderiza el micrófono**. No se muestra un botón roto para después explicar por qué no
  anda. El campo es un campo normal.
- **`maxDurationMs` agotado**: dispara `stop()` amable, no `cancel()`. El texto se
  conserva. Un timeout jamás debe destruir lo que el usuario dijo.

Todo error se traduce a un mensaje amable en español antes de llegar a la interfaz.
Ninguna excepción cruda es visible para el usuario.

---

## 12. Interfaz de usuario

```
┌──────────────────────────────────────────┐
│ Escribir mensaje...                 🎤   │
└──────────────────────────────────────────┘
```

| Estado | Micrófono | Texto |
|---|---|---|
| **Idle** | gris, estático | — |
| **Listening** | color corporativo, pulso + barras de nivel reales | "Escuchando…" + parcial en vivo |
| **Processing** | spinner, botón deshabilitado | "Transcribiendo…" |
| **Error** | ícono de alerta | mensaje amable, se descarta al próximo clic |

### Modo Campo

- **Iniciar:** clic en el micrófono, `Enter` o `Espacio`.
- **Finalizar** (conserva): clic en el micrófono, blur del campo, `maxDurationMs`.
- **Cancelar** (descarta): `Escape`.

### Modo Global

`VoiceOverlay` se monta **una sola vez** en el shell de la aplicación y se suscribe a
`NexusVoice.subscribe()`. Cuando `capture()` publica una sesión, el overlay la renderiza.
Con `headless: true`, `capture()` no publica y el llamador dibuja su propia interfaz.

- **Finalizar** (conserva): botón **Finalizar**.
- **Cancelar** (descarta): `Escape`, botón **Cancelar**, clic en el backdrop.

### Accesibilidad

`<button type="button">` real, con `aria-pressed` y un `aria-label` que cambia con el
estado. Una región `aria-live="polite"` anuncia "Escuchando", "Transcribiendo", "Listo".
`Enter` y `Espacio` alternan. La animación de pulso respeta `prefers-reduced-motion`.

---

## 13. Habilitación: resolver por fuentes

No se lee `process.env` de forma directa y dispersa.

```ts
interface VoiceConfigSource {
  readonly id: string;
  isEnabled(): boolean;
}

class BuildFlagSource implements VoiceConfigSource {}  // NEXT_PUBLIC_VOICE_ENABLED
```

**Regla de composición: `AND`.** Nexus Voice está habilitado solo si **todas** las fuentes
lo habilitan. El flag de build es un interruptor maestro; una fuente futura solo puede
restringir, nunca sobrescribirlo.

- **Nivel 1 — v1:** `BuildFlagSource` leyendo `NEXT_PUBLIC_VOICE_ENABLED`.
- **Nivel 2 — futuro:** una `AppConfigSource` que habilite por organización, rol o
  usuario. **No se implementa ahora.** La arquitectura queda preparada: basta agregarla a
  `NexusVoice.configure({ sources })` sin tocar el servicio.

> `NEXT_PUBLIC_*` queda horneada en el build. Encenderla exige rebuild, no un redeploy
> de variables de entorno.

---

## 14. Testing

`vitest` corre en entorno `node` y no hay jsdom. No es una limitación, porque la sesión
no depende de React ni del DOM **cuando el medidor se inyecta**:

```ts
createVoiceSession({ engine: new FakeVoiceEngine(), createMeter: () => fakeMeter });
```

| Se testea (puro, entorno `node`) | No se testea (verificación en navegador) |
|---|---|
| `normalize.ts`, `insert.ts`, `machine.ts` | `engines/web-speech.ts` |
| `punctuation/none.ts`, `commands.ts`, `provider.ts` | `meter.ts`, `dom.ts` |
| `session.ts` con `FakeVoiceEngine` | `VoiceMicButton`, `VoiceField`, `VoiceOverlay` |
| `config.ts` (composición `AND`) | |

`session.test.ts` cubre lo que de verdad puede romperse: transiciones de estado,
`cancel()` ≠ error, el takeover que preserva el texto, `maxDurationMs` que llama `stop()`
y no `cancel()`, el guard de `processing`, y la propagación de errores.

Se agrega `"src/lib/voice/**/*.test.ts"` al `include` de `vitest.config.ts`.
**Cero dependencias nuevas.**

Verificación manual en navegador (Chrome, `npm run dev` en `:3030`): dictado en el
Copilot, dictado en una observación de OS, denegación de permiso, takeover entre dos
campos, `Escape` durante `listening`, y Firefox (el micrófono no debe aparecer).

---

## 15. Alcance

### Incluido en v1

- Núcleo puro, `VoiceEngine` (Web Speech), `VoiceSession`, fachada `NexusVoice`.
- Modo Campo: input del Copilot + los 14 `<textarea>` de texto libre + los `type="text"` /
  `type="search"` donde el dictado tenga sentido.
- Modo Global: `NexusVoice.capture()` + `VoiceOverlay`.
- Medidor de audio real con degradación a pulso.
- `punctuationStrategy`: `"none"` (por defecto), `"commands"`, `"provider"`.
- Feature flag Nivel 1.

### Explícitamente excluido de v1

| Fuera de alcance | Motivo |
|---|---|
| `number`, `date`, `checkbox`, `button`, `submit` | Dictar por voz no tiene sentido |
| Primitivo React `<Input>` / `<Textarea>` y migración de ~30 campos | Refactor transversal; multiplica el riesgo de regresión sin servir al objetivo |
| Editor enriquecido | No existe en el sistema |
| `punctuationStrategy: "ai"` | **Decisión deliberada de producto**, no limitación técnica — ver §7.1 |
| Feature flag Nivel 2 (org / rol / usuario) | Arquitectura preparada; sin implementar |
| Text-to-Speech, wake word, conversación continua, streaming parcial insertado, multi-idioma, comandos de voz de acción | Habilitados por el diseño; fuera de v1 |
| Auto-corte por silencio como mecanismo principal | `autoStopOnSilenceMs` existe, **desactivado por defecto** |

**Semántica de `autoStopOnSilenceMs`:** cuando se activa, el temporizador se reinicia con
cada evento `partial` o `level` por encima del umbral de ruido, y al vencer ejecuta
`stop()` —**nunca `cancel()`**—, de modo que el texto dictado se conserva. Un silencio
jamás destruye lo que el usuario dijo. Permanece apagado por defecto porque en un
depósito con ruido de fondo el silencio no se detecta nunca, y en una pausa de duda corta
al usuario a mitad de frase.

No se hará una migración artificial de decenas de archivos únicamente para satisfacer la
frase "cualquier campo editable del sistema". El criterio de aceptación se redefinió
según la superficie real del sistema.

---

## 16. Etapas de entrega

Cada etapa es verificable por separado. Solo la 3 y la 4 tocan código existente.

| # | Etapa | Entrega | Verificación |
|---|---|---|---|
| 1 | **Núcleo puro** | `types`, `machine`, `normalize`, `punctuation/*`, `insert` | `vitest` verde. No toca código existente. |
| 2 | **Motor y sesión** | `engines/web-speech`, `meter`, `dom`, `session`, `config`, `nexus-voice` | `session.test.ts` con `FakeVoiceEngine`. No toca código existente. |
| 3 | **Modo Campo** | `useVoiceSession`, `VoiceMicButton`, `VoiceField`; cableado **solo en el Copilot** | Primer punto donde se ve funcionando en el navegador. |
| 4 | **Cobertura** | Los 14 `<textarea>` + los `text` / `search` que correspondan | Dictado en observaciones de OS y notas del tablero comercial. |
| 5 | **Modo Global** | `NexusVoice.capture()` + `VoiceOverlay` en el shell | `await NexusVoice.capture()` desde la consola devuelve texto. |

**Nota sobre la Etapa 3.** El input del Copilot vive dentro de un `<form>` con un botón de
submit al lado (`flex gap-2`, el input con `flex-1 min-w-0`). Envolverlo con `VoiceField`
exige que el contenedor tome el `flex-1 min-w-0` y el input pase a `w-full`. Es el único
sitio donde el wrapper puede pelear con el layout; si `cloneElement` resulta frágil ahí,
`VoiceField` expone una variante *render-prop* como escape.

---

## 17. Riesgos

| Riesgo | Mitigación |
|---|---|
| Web Speech envía el audio a los servidores de Google | Decisión tomada y aceptada. No se almacena audio. Un motor futuro (servidor propio) se cambia sin tocar el resto. |
| Dos streams de micrófono simultáneos (reconocedor + medidor) | Chrome lo permite. Si el medidor falla, degrada a pulso y el dictado continúa. |
| Calidad del reconocimiento en depósito con ruido | Corte manual por defecto: el usuario decide cuándo parar. Sin auto-corte por silencio. |
| `cloneElement` frágil en el `<form>` del Copilot | Variante render-prop como escape (Etapa 3). |
| Un motor futuro no emite evento final | Guard de `processing` + warning interno con `engine.id`. |
| Rama divergida de `main` (136 commits) | Deliberado: `0c361c0` es producción. Se prohíbe merge a `main` sin autorización explícita. |

---

## 18. Registro de decisiones

| # | Decisión | Alternativa descartada |
|---|---|---|
| 1 | Motor: **Web Speech API** | Servidor + Gemini (consume presupuesto AI); híbrido (doble superficie) |
| 2 | Alcance: **servicio + Copilot + textareas** | Solo Copilot (no prueba reutilización); primitivo `<Input>` (refactor transversal) |
| 3 | Base: **`0c361c0`** | `main` (no tiene Copilot); rama actual (no tiene Copilot) |
| 4 | **Corte manual**, `autoStopOnSilenceMs` opt-in | Auto-corte por silencio (falla en ruido); push-to-talk (incómodo en párrafos) |
| 5 | Arquitectura **A**: núcleo puro + hook headless + wrapper | Render-prop (verboso); solo hook (duplica el micrófono en cada sitio) |
| 6 | `VoiceSession` separada de `VoiceEngine` | Motor con estado (impide cancelar, reanudar, multi-micrófono) |
| 7 | `capture(): Promise<string \| null>` | `Promise<string>` (cancelación indistinguible de silencio) |
| 8 | `punctuationStrategy` (4 estrategias) | `spokenPunctuation: boolean` (booleano insuficiente) |
| 9 | Conflicto: **núcleo estricto + takeover con `stop()`** | Reutilizar sesión (texto al campo equivocado); solo rechazar (callejón sin salida) |
| 10 | **`Escape` = Cancelar, siempre** | `Escape` = Finalizar en Modo Campo (una tecla de cancelar no debe confirmar) |
| 11 | Habilitación por **resolver de fuentes**, composición `AND` | Lectura directa de `process.env` (bloquea el Nivel 2) |
