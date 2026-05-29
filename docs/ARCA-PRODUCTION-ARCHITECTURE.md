# TOPS NEXUS — ARCA PRODUCTION ARCHITECTURE (FASE E2)

> **Estado:** 📐 **Diseño de arquitectura de emisión fiscal real** · **Fecha:** 2026-05-29
> Define cómo `ProductionArcaService` autentica contra **WSAA** y emite contra **WSFEv1** (ARCA, ex-AFIP),
> el manejo de ticket/expiración/certificados/errores/retries/auditoría, y la frontera de seguridad.
> Fuente de verdad del código actual: `src/lib/arca/*`, `src/lib/env.ts`, `src/lib/invoicing/emit.ts`.
> **No habilita producción.** Es el plano que implementa FASE E3.

---

## 0. Principio rector

> Toda decisión responde: **"¿Esto acerca a emitir comprobantes fiscales reales de forma segura y auditada?"**

Tres invariantes no negociables heredadas del charter y de GATE 2:
1. **La clave privada NUNCA vive en la base ni en el repo.** Solo en el host, referenciada por path (`ARCA_KEY_PATH`) / alias (`fiscal_config.cert_alias`).
2. **El cambio SANDBOX↔HOMOLOGACION↔PRODUCCION es un switch de ambiente**, no un cambio de lógica de emisión (`emit.ts` no se toca).
3. **Sin credenciales válidas, el sistema falla con un error claro** — nunca simula un CAE real ni cae en mock silenciosamente en producción.

---

## 1. Contexto y contrato existente (verificado)

`emit.ts` ya orquesta la emisión en 10 pasos y consume **solo** la interfaz `IArcaService`:

```ts
interface IArcaService {
  readonly ambiente: "SANDBOX" | "HOMOLOGACION" | "PRODUCCION";
  ultimoComprobanteAutorizado(ptoVta: number, cbteTipo: CbteTipoCode): Promise<number>; // FECompUltimoAutorizado
  solicitarCAE(req: FECAESolicitarRequest, emisor: ArcaEmisor): Promise<FECAESolicitarResponse>; // FECAESolicitar
}
```

El factory `getArcaService(ambiente)` decide implementación:
- `SANDBOX` → `MockArcaService` (CAE simulado, **se preserva intacto**).
- `HOMOLOGACION` / `PRODUCCION` → `ProductionArcaService` (hoy STUB `NOT_READY`).

Los tipos `FECAESolicitarRequest/Response` ya replican 1:1 el contrato SOAP de WSFEv1. **No hay que
renombrar nada**: la implementación productiva mapea directo. `env.arca` ya expone `certPath`, `keyPath`,
`wsaaUrl`, `wsfev1Url`, `ambiente`, `configured`.

---

## 2. Visión general del flujo productivo

```
                          ┌───────────────────────────────────────────────┐
emit.ts  ── solicitarCAE ─►│  ProductionArcaService (HOMOLOGACION/PRODUCCION) │
                          │                                                 │
                          │  1. asegurarTA('wsfe')  ──► WsaaClient           │
                          │        │  (cache de Token+Sign con expiración)   │
                          │        ▼                                         │
                          │     [TA válido?] ──no──► WSAA LoginCms           │
                          │        │  · arma TRA (XML)                       │
                          │        │  · firma CMS/PKCS#7 (cert+key host)     │
                          │        │  · POST SOAP a wsaaUrl                   │
                          │        │  · parsea <token>,<sign>,<expirationTime>│
                          │        ▼                                         │
                          │  2. WSFEv1.FECompUltimoAutorizado(pv,tipo)       │
                          │  3. WSFEv1.FECAESolicitar(Auth + FeCAEReq)       │
                          │  4. parsea CAE/CAEFchVto/Resultado/Obs/Errors    │
                          │  5. log + auditoría (arca_request_log)           │
                          └───────────────────────────────────────────────┘
```

Si en cualquier punto faltan credenciales o el TA no se puede obtener → **error claro** (no fallback a
mock en PRODUCCION). Fallback a Mock **solo** está permitido bajo flag explícito en entornos no productivos
(ver §8).

---

## 3. WSAA — Web Service de Autenticación y Autorización

WSAA entrega un **Ticket de Acceso (TA)** = `Token` + `Sign`, válido ~12 h, que autoriza a usar WSFEv1.

### 3.1 Pasos
1. **Armar el TRA** (Ticket de Requerimiento de Acceso), XML:
   ```xml
   <loginTicketRequest version="1.0">
     <header>
       <uniqueId>{epoch}</uniqueId>
       <generationTime>{now-10min ISO8601}</generationTime>
       <expirationTime>{now+10min ISO8601}</expirationTime>
     </header>
     <service>wsfe</service>
   </loginTicketRequest>
   ```
   - `generationTime`/`expirationTime` con offset (±10 min) para tolerar desfasaje de reloj.
   - `service` = `wsfe` (servicio de facturación).
2. **Firmar el TRA como CMS/PKCS#7** (firma + certificado embebidos), salida DER → base64.
   - Insumos: certificado X.509 (`ARCA_CERT_PATH`) + clave privada (`ARCA_KEY_PATH`), **solo en host**.
3. **Invocar `LoginCms`** (SOAP 1.1/1.2) en `wsaaUrl` con el CMS base64 en `<in0>`.
4. **Parsear la respuesta** (un XML embebido en el SOAP body):
   - `<credentials><token>…</token><sign>…</sign></credentials>`
   - `<header><expirationTime>…</expirationTime></header>`
5. **Cachear el TA** por `(cuit, service)` hasta `expirationTime` (menos un margen de seguridad).

### 3.2 Firma CMS — decisión de implementación
Node `crypto` **no** firma CMS/PKCS#7 detached de forma nativa. Dos caminos:

| Opción | Pros | Contras | Decisión |
|--------|------|---------|----------|
| **A. `openssl smime -sign` (child_process)** | Estándar de facto para WSAA en Node; cero deps npm; robusto | Requiere binario `openssl` en el host (no garantizado en Netlify Functions) | ✅ **Default** (`signTraOpenssl`), detrás de una interfaz `CmsSigner` |
| **B. Lib JS (pkijs/@peculiar/asn1)** | Pure-JS, corre en cualquier runtime serverless | Dependencia extra + superficie de auditoría | Alternativa pluggable (`CmsSigner` permite inyectarla sin tocar el resto) |

> **Implicación de runtime (importante):** la emisión productiva debe correr en un contexto Node con
> acceso a `openssl` y a los archivos de cert/clave (p. ej. un host dedicado / worker / función con
> filesystem). **No** se asume que Netlify Functions tenga `openssl` ni los certs montados; eso se
> decide en el gate de despliegue. La arquitectura abstrae el firmador (`CmsSigner`) para no acoplarse.

### 3.3 Ciclo de vida del Ticket (TA)
- **Cache en memoria por proceso**, clave `${cuit}:${service}`.
- **Validez:** se considera vencido `margen` segundos antes de `expirationTime` (default 600 s) para
  evitar usar un TA que expira mid-request.
- **Renovación:** perezosa (lazy) — al primer `solicitarCAE`/`ultimoComprobante` se asegura un TA válido;
  si está vencido, se re-login.
- **Concurrencia:** un único login en vuelo por clave (promise de-dup) para no disparar N logins paralelos
  (WSAA penaliza logins repetidos: error `coe.alreadyAuthenticated`).
- **Persistencia (opcional, gate futuro):** se puede persistir el TA cifrado para compartir entre instancias;
  en E3 se implementa **solo memoria** (suficiente y sin nueva superficie de secreto).

---

## 4. WSFEv1 — Facturación Electrónica (FECAE)

Una vez con TA válido, se invoca el SOAP `service.asmx` en `wsfev1Url`.

### 4.1 Operaciones usadas
| Operación | Mapea a `IArcaService` | Propósito |
|-----------|------------------------|-----------|
| `FECompUltimoAutorizado` | `ultimoComprobanteAutorizado(ptoVta, cbteTipo)` | número del último comprobante → el próximo es +1 |
| `FECAESolicitar` | `solicitarCAE(req, emisor)` | solicita CAE para 1..N comprobantes |
| `FEDummy` (auxiliar) | (health check) | verifica disponibilidad de AppServer/DbServer/Auth |

### 4.2 Estructura `Auth`
Todas las operaciones llevan el bloque de autenticación:
```xml
<Auth><Token>…</Token><Sign>…</Sign><Cuit>{cuitEmisorSinGuiones}</Cuit></Auth>
```

### 4.3 Mapeo de request (ya tipado en `types.ts`)
`FECAESolicitarRequest` → `FeCAEReq` con `FeCabReq` (CantReg, PtoVta, CbteTipo) y `FeDetReq[]`
(Concepto, DocTipo, DocNro, CbteDesde/Hasta, CbteFch, ImpTotal, ImpTotConc, ImpNeto, ImpOpEx, ImpIVA,
ImpTrib, MonId, MonCotiz, [Fch* si Concepto≠1], `Iva[]`, `Tributos[]`, `CbtesAsoc[]`). **Idéntico al
que ya arma `emit.ts`.**

### 4.4 Mapeo de response
`FECAESolicitarResponse.FeDetResp[].Resultado ∈ {A,P,R}`, `CAE`, `CAEFchVto`, `Observaciones[]`;
`FeCabResp.Resultado`; `Errors[]`, `Events[]`. `emit.ts` ya distingue `A` (autorizado) de rechazo/error
y persiste `AUTORIZADO_ARCA` / `RECHAZADO_ARCA` / `ERROR_ARCA`. **No cambia.**

---

## 5. Manejo de errores (taxonomía)

| Clase | Origen | Ejemplos | Estrategia |
|-------|--------|----------|------------|
| **AuthError** | WSAA | cert vencido, CMS inválido, `coe.alreadyAuthenticated`, TA expirado | invalidar cache TA; 1 reintento de login; si persiste → error claro, **no** emite |
| **SoapFault** | WSFEv1 transporte | HTTP 500 SOAP Fault, XML malformado | clasificar como técnico → `ERROR_ARCA`; reintento con backoff si es transitorio |
| **FEError** (`Errors[]`) | WSFEv1 negocio | datos inválidos, CUIT no habilitado, pto vta inexistente | **no reintentar** (es determinístico); `RECHAZADO_ARCA` con el detalle |
| **FEObservacion** (`Resultado=R/P`) | WSFEv1 negocio | observaciones que rechazan | `RECHAZADO_ARCA` con `Code: Msg` |
| **NetworkError** | transporte | timeout, DNS, TLS | reintento con backoff; si agota → `ERROR_ARCA` |
| **ConfigError** | local | falta cert/key, ambiente mal seteado | error claro inmediato; **no** llama a ARCA |

> **Idempotencia:** `FECompUltimoAutorizado` antes de cada `FECAESolicitar` permite re-sincronizar la
> numeración tras un fallo, evitando duplicar o saltear números. `Reproceso='S'` en la respuesta indica
> que ARCA reconoció un comprobante ya enviado (no duplica CAE).

---

## 6. Retries y timeouts

| Parámetro | Default | Razón |
|-----------|---------|-------|
| Timeout por request SOAP | 15 s | WSFEv1 suele responder < 3 s; corta colgados |
| Reintentos (errores transitorios) | 2 (total 3 intentos) | red/timeout/SOAP Fault transitorio |
| Backoff | exponencial 500ms→1s→2s + jitter | evita tormenta de reintentos |
| Reintentos en **FEError de negocio** | 0 | determinístico, reintentar no ayuda |
| Reintentos de login WSAA | 1 (tras invalidar TA) | `coe.alreadyAuthenticated` se resuelve esperando/reusando |

---

## 7. Estrategia de certificados

| Aspecto | Decisión |
|---------|----------|
| Ubicación | **Solo host**, vía `ARCA_CERT_PATH` (X.509 PEM) y `ARCA_KEY_PATH` (clave privada PEM). Jamás en DB/repo. |
| Referencia en DB | `fiscal_config.cert_alias` = alias **lógico** (p. ej. `verotin-homolog-2026`), no el material. |
| Homologación vs Producción | Dos certs distintos (AFIP los emite por ambiente). Se selecciona por `ambiente` + envs apuntando al cert correcto. |
| Rotación | Cambiar el archivo en host + actualizar `cert_alias`; invalidar cache TA al rotar. |
| Validación al boot | `env.arca.configured = Boolean(certPath && keyPath)`. Si `ambiente≠SANDBOX` y `!configured` → ConfigError claro. |
| Permisos archivo | `0400` propietario del proceso; nunca world-readable. |

---

## 8. Feature flag y fallback (preserva Sandbox)

```
ambiente (fiscal_config / ARCA_AMBIENTE)
  ├─ SANDBOX      → MockArcaService            (siempre disponible, sin red)
  ├─ HOMOLOGACION → ProductionArcaService(wswhomo)  [requiere cert homolog]
  └─ PRODUCCION   → ProductionArcaService(prod)      [requiere cert prod + gate ejecutivo]

Flags:
  ARCA_AMBIENTE            : override de ambiente (la verdad la manda fiscal_config)
  ARCA_ALLOW_MOCK_FALLBACK : "1" ⇒ si falta cert en HOMOLOGACION, usar Mock (SOLO no-prod, dev)
```
- En **PRODUCCION**, el fallback a mock está **prohibido**: si falta credencial, error.
- `MockArcaService` queda 100% intacto y es el default seguro.
- El switch de ambiente no requiere redeploy de lógica: cambia `fiscal_config.ambiente`.

---

## 9. Logging y auditoría

| Capa | Qué registra | Dónde |
|------|--------------|-------|
| **App (ya existe)** | `invoice_audit`: emitir/autorizado/rechazado/error + request/response ARCA + CAE + user + ip | tabla `invoice_audit` (0011) |
| **Servicio ARCA (E3)** | log estructurado por llamada: operación, ambiente, cuit, ptoVta, cbteTipo, latencia, resultado, códigos de error/obs — **sin** datos sensibles del cert | logger inyectable (`ArcaLogger`); default `console` estructurado |
| **TA / WSAA** | evento de login (sin token/sign en claro: solo hash/expiración) | logger |

> **Regla:** nunca loguear `Token`, `Sign`, la clave privada ni el CMS firmado en claro. Se loguea
> metadata (expiración, longitud, hash truncado) para diagnóstico.
> **AUDIT-DEF** (endurecer `invoice_audit` a trigger `SECURITY DEFINER`) queda fuera de FASE E (es `0012+`).

---

## 10. Módulos a implementar (FASE E3)

| Archivo | Responsabilidad |
|---------|-----------------|
| `src/lib/arca/wsaa.ts` | `WsaaClient`: TRA build, firma CMS (interfaz `CmsSigner` + `opensslSigner`), `LoginCms`, cache TA, renovación, de-dup de login |
| `src/lib/arca/soap.ts` | helper SOAP: arma envelope, POST con timeout/retries, extrae body, detecta SOAP Fault, util de extracción XML (zero-dep) |
| `src/lib/arca/wsfev1.ts` | `Wsfev1Client`: `FECompUltimoAutorizado`, `FECAESolicitar`, `FEDummy`; mapeo request/response tipado |
| `src/lib/arca/production-service.ts` | **reescrito**: orquesta WSAA+WSFEv1; implementa `IArcaService`; ConfigError si falta cert; logging/audit |
| `src/lib/arca/logger.ts` | `ArcaLogger` estructurado (sin secretos) |
| `src/lib/env.ts` | (extensión menor) `ARCA_ALLOW_MOCK_FALLBACK`, margen de TA |

> Ningún cambio en `emit.ts`, `mock-service.ts`, `qr.ts`, `types.ts`, `calc.ts`, ni en el Billing Schema.

---

## 11. Definición de "READY"

`ProductionArcaService = READY` significa, de forma verificable:
1. **No** lanza `NOT_READY` incondicional: el camino WSAA+WSFEv1 está **implementado y compila**.
2. Con cert/clave presentes y ambiente `HOMOLOGACION`, ejecuta el handshake real (login→TA→FECAESolicitar).
3. Sin credenciales, falla con **ConfigError claro** (no simula, no rompe el build).
4. `MockArcaService` (SANDBOX) intacto.
5. Feature flag + fallback controlado + logging + auditoría presentes.

> **READY ≠ EMITIENDO EN PRODUCCIÓN.** READY es "código completo y operable con credenciales"; la emisión
> productiva real exige cert de AFIP, homologación exitosa y gate ejecutivo (FASE E4/E5 y posterior).

---

## 12. ¿Acerca a emitir comprobantes fiscales reales de forma segura y auditada?

**SÍ — es el plano que lo habilita.** Define exactamente cómo TOPS Nexus pasa de un STUB a un cliente
fiscal real, sin comprometer las invariantes de seguridad (clave solo en host), preservando el sandbox,
y con observabilidad/auditoría desde el día uno. La implementación (E3) materializa este diseño.
