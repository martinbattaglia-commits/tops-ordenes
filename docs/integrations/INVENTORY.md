# NEXUS ERP — Inventario de Integraciones

`[PROPUESTA]` Metadatos declarados de este documento.
| Campo | Valor |
|---|---|
| Clasificacion | NO NORMATIVO · inventario operativo |
| Expediente | NEXUS-INT-MGR-001 — Fase 0 |
| Producto | `tops-ordenes` |
| Base de evidencia | `64a9f9fb9d3c36560fda8fb0fc7bae2b62288303` |
| Tree | `56ef8aa86152cfa6a3d6cad318f2985ee4c49cbf` |
| Fecha y hora de corte | 2026-08-06T16:19:09Z · 2026-08-06T13:19:09-03:00 |
| Version | FINAL-DOCUMENTAL |

Todas las referencias `archivo:linea` de este documento fueron leidas desde el SHA declarado
arriba mediante `git show "${BASE}:<ruta>"`. No se utilizaron ramas de trabajo, arboles de
trabajo, copias historicas ni informes previos. `[EVIDENCIA-CODIGO]`

---

## 1. Proposito

Establecer el inventario unico de integraciones externas, credenciales logicas y consumidores
de Nexus ERP, con trazabilidad de evidencia y vocabulario de estado preciso. `[PROPUESTA]`

Este documento no es normativo y no autoriza acciones. `[PROPUESTA]`

## 2. Metodo y trazabilidad

### 2.1 Fuentes, separadas por naturaleza

    Evidencia de codigo      repositorio tops-ordenes en la base declarada
    Evidencia de plataforma  API de Make y API de Netlify, en modo lectura, con fecha
    Evidencia historica      expedientes cerrados, identificados por nombre

### 2.2 Etiquetas

Definiciones nominales del vocabulario de naturaleza:

    EVIDENCIA-CODIGO · EVIDENCIA-PLATAFORMA · EVIDENCIA-HISTORICA
    INFERENCIA · PROPUESTA · NO VERIFICABLE

`[PROPUESTA]` Grafia unica y sin tildes en los cuatro documentos, conforme a la resolucion vigente de
Direccion. Toda afirmacion material lleva etiqueta.

### 2.3 Vocabulario de estado

`[PROPUESTA]` Definido por `ADR-NIM-002` y reproducido en `README.md §6`.

### 2.4 Que NO se verifico

`[PROPUESTA]` En esta fase no se ejecuto ningun health check autenticado, no se consulto el
contenido del secret store de Netlify Environment Variables y no se consulto el contenido del
store de Netlify Blobs. En consecuencia **ninguna integracion se declara OPERATIVA en este
inventario**. Una ejecucion exitosa, un deploy, una respuesta puntual o cualquier otra evidencia
de plataforma no sustituyen el health check vigente que ese estado exige. Detalle en §21.

---

## 3. Taxonomia de integraciones — 20 confirmadas y 1 candidato

Taxonomia unica. No existe ninguna otra clasificacion vigente. `[PROPUESTA]`

### 3.1 A · Integraciones de negocio — 14 confirmadas y 1 candidato

`[EVIDENCIA-CODIGO]` Catorce integraciones de negocio con anclaje en la base: cada una tiene al
menos una ruta, variable o identificador presente en el arbol declarado.

| ID | Integracion | Proveedor | Proposito |
|---|---|---|---|
| A1 | `clientify-commercial` | Clientify | CRM: contactos, deals, pipeline |
| A2 | `clientify-webhook` | Clientify | Recepcion de eventos |
| A3 | `google-drive-corp` | Google Cloud | Contratos, Compliance, Caja Chica, Compras |
| A4 | `meta-whatsapp-nexus` | Meta | Envio directo desde Nexus |
| A6 | `meta-webhook` | Meta | Recepcion y verificacion de webhook |
| A7 | `arca-wsfev1` | ARCA | Facturacion electronica |
| A8 | `resend-email` | Resend | Email transaccional |
| A9 | `openai-ocr` | OpenAI | OCR de facturas de proveedor |
| A10 | `traccar-ingest` | Traccar (propio) | Ingesta de posiciones de flota |
| A11 | `mapbox-gl` | Mapbox | Mapa en vivo |
| A12 | `hikvision-nvr` | Hikvision | CCTV |
| A13 | `fx-bna` | sin proveedor conectado en la base | Cotizacion del dolar Banco Nacion — declarada como follow-up, no conectada |
| A14 | `gemini-ai` | Google | Copilot — proveedor de modelo principal previsto |
| A15 | `anthropic-ai` | Anthropic | Copilot — proveedor de modelo secundario, no preferido |

`[EVIDENCIA-PLATAFORMA]` Lo unico que la evidencia preservada demuestra sobre la decimoquinta
integracion de negocio, segun `08-MAKE-EVIDENCE-SANITIZED.md` §3:

| ID | Hecho observable |
|---|---|
| A5 | Existe un escenario de Make denominado «WhatsApp Bot Max», activo, con ejecuciones registradas y tres modulos `MakeRequest (http)` |

`[NO VERIFICABLE]` De ese escenario no se demuestra el proveedor, el destino de sus modulos ni
su proposito funcional. El nombre del escenario no es evidencia de con que servicio dialoga. Por
eso A5 no se cuenta entre las integraciones confirmadas: es un **candidato de integracion**.

`[EVIDENCIA-CODIGO]` A14 y A15: `src/lib/env.ts:97-101` define el conjunto cerrado de
proveedores `mock | gemini | anthropic | openai`, con `mock` por defecto.

`[EVIDENCIA-CODIGO]` A13: lo unico que existe en la base es el nombre `fx_bna_quote` dentro de
una cadena de texto en `src/lib/ai/general-source.ts:30`, que declara literalmente «follow-up
de este release, aun no conectado». Esa cadena forma parte del mensaje de LIMITACION que el
Copilot devuelve cuando se le pide una cotizacion, precisamente para no inventar un valor. En
la base no existen ruta de API, cliente, provider, workflow ni dependencia de red asociados, y
los identificadores `criptoya`, `dolarapi`, `bcra` y `bna.gov` no aparecen en `src/`, `netlify/`
ni `package.json`. Por eso A13 figura como NO CONFIGURADA.

### 3.2 B · Integraciones de plataforma — 4 confirmadas

`[EVIDENCIA-CODIGO]` Tres integraciones de plataforma con anclaje en la base.

| ID | Integracion | Rol |
|---|---|---|
| B1 | `supabase-prod` | Base de datos, Auth, RLS, Realtime |
| B3 | `github-actions` | Planificador de workflows |
| B4 | `netlify-hosting` | Build, hosting, functions y **dos** secret stores: Environment Variables y Blobs |

`[EVIDENCIA-PLATAFORMA]` La cuarta integracion de plataforma no tiene anclaje en la base. Lo
que la evidencia preservada demuestra, segun `08-MAKE-EVIDENCE-SANITIZED.md` §1-§4:

| ID | Integracion | Hecho observable |
|---|---|---|
| B2 | `make-automation` | Existe la organizacion 7052028 / team 2061037, con 5 escenarios, 10 webhooks y 6 modulos HTTP |

`[NO VERIFICABLE]` No se demuestra que esos modulos alojen credenciales de este inventario, de
modo que el rol de la plataforma como store de copias ajenas queda sin confirmar (§10).

`[EVIDENCIA-CODIGO]` B4 aloja dos stores distintos; ver §7.

### 3.3 C · Infraestructura interna — 1

`[EVIDENCIA-CODIGO]` Infraestructura interna identificada en la base.

| ID | Integracion | Rol |
|---|---|---|
| C1 | `cron-internal` | Autenticacion compartida de jobs programados |

### 3.4 D · Procesos de soporte — 1

`[EVIDENCIA-CODIGO]` Procesos de soporte identificados en la base.
| ID | Proceso | Rol |
|---|---|---|
| D1 | `supabase-backup` | Backup diario de la base de produccion hacia **Google Drive** |

`[EVIDENCIA-CODIGO]` `.github/workflows/supabase-backup.yml:3-8`: el destino es Google Drive.
El workflow documenta expresamente que en la migracion del 2026-06-04 **se reemplazo Google
Cloud Storage por Google Drive**, sin buckets ni billing de GCP, y que la subida usa una
Service Account dedicada de Drive. Toda referencia a Google Cloud Storage como destino vigente
queda retirada de este inventario.

### 3.5 Relacion entre integraciones, credenciales y conexiones de plataforma

`[EVIDENCIA-CODIGO]` Magnitudes derivadas del repositorio en la base declarada.

    19 integraciones con anclaje en el arbol
        ↔  20 credenciales gobernadas confirmadas

`[EVIDENCIA-PLATAFORMA]` Magnitudes derivadas de la consulta de plataforma del 2026-08-05.

    1 integracion confirmada sin anclaje en el arbol  (B2)
    2 conexiones de plataforma externas al alcance inicial

`[NO VERIFICABLE]` Magnitudes que no se apoyan en ninguna de las dos fuentes.

    1 candidato de integracion  (A5, §3.1)
    1 candidato de credencial   (S15, §4.7)

`[PROPUESTA]` La relacion es N:M.

`[EVIDENCIA-CODIGO]` Los cinco hechos que lo demuestran:
- No toda integracion declarada tiene credencial en el inventario. `fx-bna` no tiene ninguna:
  en la base existe una referencia conceptual a `fx_bna_quote`, pero no hay integracion externa
  conectada ni configuracion de credencial demostrada (§3.1). `github-actions`,
  `netlify-hosting` y `make-automation` son plataformas cuyo acceso no se gobierna mediante una
  credencial logica de este inventario.
- No toda credencial corresponde a una unica integracion. `GOOGLE_SERVICE_ACCOUNT_JSON` sirve
  a cuatro dominios de negocio; `CRON_SECRET` sirve a siete emisores y ocho validadores.
- Una misma integracion puede requerir mas de una credencial. `supabase-prod` utiliza una
  credencial privada y una publica restringible; `meta-webhook` utiliza dos secretos.
- Un secret store no es una credencial ni una integracion. Netlify Blobs es un store dentro de
  B4, no una integracion adicional.
- No toda conexion de plataforma pertenece al dominio inicial de Nexus (§4.6).

`[PROPUESTA]` Afirmar una correspondencia uno a uno entre integraciones y credenciales es incorrecto.

---

## 4. Credenciales logicas — 20 confirmadas y 1 candidato

De **84** variables `process.env` distintas utilizadas en `src/` con nombre literal (excluidos
archivos de prueba), mas **2** que solo aparecen en workflows y **1** de nombre construido
dinamicamente, resultan **20 credenciales logicas gobernadas confirmadas**: 18 secretos
privados y 2 credenciales publicas restringibles. `[EVIDENCIA-CODIGO]`

`[EVIDENCIA-CODIGO]` Se entiende por confirmada la credencial que tiene al menos un anclaje
textual de su nombre en el arbol de la base. Las veinte lo tienen.

`[NO VERIFICABLE]` Existe ademas **un candidato** que no cumple ese criterio y que por eso no
integra el conjunto confirmado ni se utiliza para cerrar aritmetica alguna: S15, la supuesta
credencial de Meta embebida en un modulo de Make (§4.7).

### 4.1 Dieciocho secretos privados confirmados

`[EVIDENCIA-CODIGO]` Cada fila cita un anclaje existente en el arbol declarado.

| ID | Credencial logica | Integracion | Evidencia (base declarada) |
|---|---|---|---|
| S1 | `SUPABASE_SERVICE_ROLE_KEY` | B1 | `src/lib/env.ts:41` · `src/lib/supabase/server.ts` |
| S2 | `SUPABASE_DB_URL` | D1 | `.github/workflows/supabase-backup.yml:11` |
| S3 | `GCP_SA_KEY` | D1 | `.github/workflows/supabase-backup.yml:12` |
| S4 | `CLIENTIFY_API_KEY` | A1 | `src/lib/env.ts:77,79` · `src/lib/clientify/client.ts` |
| S5 | `CLIENTIFY_WEBHOOK_SECRET` | A2 | `src/lib/env.ts:81` |
| S6 | `GOOGLE_SERVICE_ACCOUNT_JSON` | A3 | `src/lib/env.ts:235,243` · `src/lib/credentials/index.ts:28` |
| S7 | `META_WA_TOKEN` | A4 | `src/lib/env.ts:139,143` |
| S8 | `META_WA_WEBHOOK_VERIFY_TOKEN` | A6 | `src/app/api/whatsapp/webhook/route.ts` |
| S9 | `ARCA_PRIVATE_KEY` (compuesta) | A7 | `src/lib/env.ts:33,35,182,218-219` |
| S10 | `RESEND_API_KEY` | A8 | `src/lib/env.ts:65` |
| S11 | `OPENAI_API_KEY` | A9 | `src/lib/env.ts:224,227` |
| S12 | `TRACKING_INGEST_TOKEN` | A10 | `src/lib/env.ts:149,159` |
| S13 | `HIKVISION_CREDENTIAL` (compuesta) | A12 | `src/lib/env.ts:323-324,326` |
| S14 | `CRON_SECRET` | C1 | `src/lib/env.ts:314-315` · `src/lib/cron-auth.ts` |
| S16 | `AI_GEMINI_API_KEY` / `GEMINI_API_KEY` (alias) | A14 | `src/lib/env.ts:117-120` |
| S17 | `AI_ANTHROPIC_API_KEY` | A15 | `src/lib/env.ts:122` |
| S18 | `META_WA_APP_SECRET` | A6 | `src/app/api/whatsapp/webhook/route.ts:56` |
| S19 | `WHATSAPP_SEND_SECRET` | A4 | `src/app/api/whatsapp/send/route.ts:31` |

`[NO VERIFICABLE]` S3 y S6 podrian corresponder a la misma Service Account de Google en dos
stores distintos. El workflow de backup nombra una Service Account dedicada de Drive; Nexus
consume su propia credencial de Service Account por otra via. Determinar si son el mismo
principal exigiria comparar valores, lo que no esta autorizado. Se mantienen como credenciales
logicas separadas: distintos stores, distintos consumidores y distinto ciclo de vida.

### 4.2 Dos credenciales publicas restringibles

`[EVIDENCIA-CODIGO]` Credenciales publicas restringibles.
| ID | Credencial | Integracion | Por que no es secreto privado |
|---|---|---|---|
| P1 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | B1 | JWT anonimo; viaja al navegador por diseno. Su gobierno es RLS, no confidencialidad |
| P2 | `NEXT_PUBLIC_MAPBOX_TOKEN` | A11 | Token publico de cliente. Su gobierno es la restriccion por dominio |

`[EVIDENCIA-CODIGO]`

### 4.3 Credenciales compuestas y con alias

    S9  ARCA_PRIVATE_KEY   = ARCA_KEY_PEM | ARCA_KEY_PATH
                             Dos vias de entrega, un unico secreto. El certificado
                             (ARCA_CERT_PEM | ARCA_CERT_PATH) es artefacto PUBLICO:
                             componente del par, no secreto privado, no cuenta como
                             credencial logica separada.
    S13 HIKVISION_CREDENTIAL = HIKVISION_USER + HIKVISION_PASSWORD  (par indivisible)
    S16 credencial Gemini    = AI_GEMINI_API_KEY (primaria) || GEMINI_API_KEY (fallback)
                             Una unica credencial logica con dos nombres. Ver §17.

`[EVIDENCIA-CODIGO]`

### 4.4 Clasificacion de las variables

`[EVIDENCIA-CODIGO]` Clasificacion de las variables con nombre literal en `src/`.
| Clase | Cantidad |
|---|---|
| Portadoras del valor de una credencial gobernada | **20** |
| Certificado publico (`ARCA_CERT_PEM`) | **1** |
| No portadoras: identificadores, rutas, URLs, flags, parametros, direcciones de correo y configuracion | **63** |
| **Total con nombre literal en `src/`** | **84** |

Las 20 portadoras: `AI_ANTHROPIC_API_KEY`, `AI_GEMINI_API_KEY`, `GEMINI_API_KEY`,
`ARCA_KEY_PEM`, `CLIENTIFY_API_KEY`, `CLIENTIFY_WEBHOOK_SECRET`, `CRON_SECRET`,
`GOOGLE_SERVICE_ACCOUNT_JSON`, `HIKVISION_PASSWORD`, `HIKVISION_USER`, `META_WA_APP_SECRET`,
`META_WA_TOKEN`, `META_WA_WEBHOOK_VERIFY_TOKEN`, `NEXT_PUBLIC_MAPBOX_TOKEN`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `TRACKING_INGEST_TOKEN`, `WHATSAPP_SEND_SECRET`.
`[EVIDENCIA-CODIGO]`

`[EVIDENCIA-CODIGO]` Nombres adicionales fuera de las 84:

    SUPABASE_DB_URL                      solo en .github/workflows/supabase-backup.yml
    GCP_SA_KEY                           solo en .github/workflows/supabase-backup.yml
    <ENV>_SHA256                         nombre CONSTRUIDO dinamicamente en
                                         src/lib/credentials/providers/environment.ts:31.
                                         Para S6 se materializa como
                                         GOOGLE_SERVICE_ACCOUNT_JSON_SHA256. Es un checksum
                                         de integridad opcional, NO una credencial.

Universo de nombres inventariados: **87**. `[EVIDENCIA-CODIGO]`

### 4.5 Elementos explicitamente NO contados como credencial privada

`[PROPUESTA]` Certificados publicos, URLs, identificadores, rutas de sistema de archivos, flags, parametros
numericos, direcciones de correo, checksums de integridad, configuracion de build y de
ambiente. Tampoco se cuenta como credencial ningun provider ni ningun secret store.

Entre ellos: `ARCA_CERT_PEM`, `ARCA_CERT_PATH`, `ARCA_KEY_PATH`, `ARCA_CUIT`, `ARCA_AMBIENTE`,
`ARCA_CMS_SIGNER`, `ARCA_WSAA_URL`, `ARCA_WSFEV1_URL`, `ARCA_TA_MARGIN_SECONDS`,
`ARCA_ALLOW_MOCK_FALLBACK`, `CLIENTIFY_BASE_URL`, `CLIENTIFY_TIMEOUT_MS`,
`CLIENTIFY_MAX_RETRIES`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`, `GOOGLE_SA_EMAIL`,
`GOOGLE_SERVICE_ACCOUNT_JSON_SHA256`, `CONTRATOS_DRIVE_FOLDER_ID`, `CONTRATOS_DRIVE_PATH`,
`CONTRATOS_SYNC_EXTRACT_TEXT`, `COMPLIANCE_DRIVE_FOLDER_ID`, `COMPLIANCE_DRIVE_PATH`,
`COMPLIANCE_SYNC_EXTRACT_TEXT`, `CAJA_CHICA_DRIVE_FILE_ID`, `CAJA_CHICA_PERIODOS`,
`CAJA_CHICA_SYNC_ENABLED`, `META_WA_PHONE_NUMBER_ID`, `META_WA_BUSINESS_ACCOUNT_ID`,
`WHATSAPP_PROVIDER`, `WHATSAPP_NOTIFY_DEFAULT`, `WHATSAPP_SANDBOX`,
`WHATSAPP_SANDBOX_ALLOWLIST`, `HIKVISION_HOST`, `HIKVISION_HTTP_PORT`,
`HIKVISION_HTTPS_PORT`, `HIKVISION_RTSP_PORT`, `HIKVISION_USE_HTTPS`, `HIKVISION_CHANNELS`,
`OPENAI_OCR_MODEL`, `RESEND_FROM_EMAIL`, `EMAIL_ADMIN_RUTH`, `EMAIL_ADMIN_JOSELUIS`,
`EMAIL_DEPOT_MAGALDI`, `EMAIL_DEPOT_LUJAN`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_DEMO_MODE`,
`NEXT_PUBLIC_VOICE_ENABLED`, `NODE_ENV`, `RBAC_ENFORCE`, `BUILD_ID`, `BUILD_DATE`,
`BUILD_COMMIT_SHA`, `BUILD_BRANCH`, `BUILD_CONTEXT`, `AI_ENABLED`, `AI_PROVIDER`, `AI_MODEL`,
`AI_DAILY_LIMIT`, `AI_MONTHLY_BUDGET_USD`, `AI_LIMIT_REQUESTS_PER_DAY`, `AI_LIMIT_TOOL_ROUNDS`,
`AI_LIMIT_OUTPUT_TOKENS`, `AI_LIMIT_CONTEXT_CHARS`, `AI_LIMIT_TURNS`. `[EVIDENCIA-CODIGO]`

### 4.6 Credenciales de plataforma fuera del alcance inicial de rotacion

El conteo de 20 confirmadas comprende las credenciales sometidas al dominio inicial de gobierno
de Nexus. Make administra ademas **dos conexiones gestionadas** que se inventarian por separado
y quedan fuera del alcance inicial de rotacion, porque: `[PROPUESTA]`

`[PROPUESTA]` Los cuatro motivos:
1. no son credenciales declaradas ni consumidas directamente por Nexus;
2. viven exclusivamente dentro de la plataforma Make;
3. su ciclo de vida es gestionado por Make;
4. todavia no forman parte del alcance de rotacion del Integration Manager.

`[PROPUESTA]` **«Fuera del alcance inicial» no significa «fuera de gobierno para siempre».** Su incorporacion
se tratara en MAKE-HYGIENE-001 o en una fase posterior. Siguen siendo activos sensibles.

`[EVIDENCIA-PLATAFORMA]` Conexiones gestionadas por Make al corte.
| Credencial de plataforma | Store | Consumidor | Estado |
|---|---|---|---|
| Conexion OAuth de Gmail | Make Connections | Escenario Formulario Web (uso registrado al corte) | Gestionada por Make |
| Conexion basic de Netlify | Make Connections | 0 usos registrados al corte | Gestionada por Make |

Metadato operativo de la conexion de Gmail: expiracion declarada 2026-12-16, 5 scopes.
`[EVIDENCIA-PLATAFORMA]` · consulta del 2026-08-05.

`[PROPUESTA]` No se registran tokens, valores, detalles de autenticacion exportados ni identificadores que
funcionen como credencial.

### 4.7 S15 · candidato de credencial no verificable

`[NO VERIFICABLE]` **S15 — candidato de credencial Meta/Make.** No integra el conjunto de
credenciales confirmadas y no se utiliza para cerrar ninguna aritmetica del inventario. No se
afirma su identidad, ni su store, ni su consumidor especifico.

`[EVIDENCIA-PLATAFORMA]` Lo unico que la evidencia sanitizada preserva es lo siguiente, y nada
mas: el 2026-08-03 una ejecucion del escenario Bot Max fallo con
`InvalidConfigurationError: Unauthorized` cuyo `causeModule` era un `MakeRequest (http)`; el
2026-08-05 hubo una modificacion por el titular de la cuenta; y a continuacion el escenario
volvio a ejecutar correctamente. La propia evidencia declara que la cantidad de modulos con
credencial embebida no es reproducible.

`[NO VERIFICABLE]` De esos hechos no se sigue la existencia demostrada de una credencial de
Meta diferenciada. Un `Unauthorized` puede originarse tambien en ausencia de credencial o en
configuracion incorrecta, tal como advierte §10. S15 se conserva unicamente como registro
historico, para que una fase posterior sepa que este extremo quedo abierto.

`[PROPUESTA]` Su esclarecimiento se traslada a MAKE-HYGIENE-001. Este inventario no propone
accion operativa sobre el.

---

## 5. Fuente originaria · secret store operativo · consumidor

Tres conceptos distintos. Nunca deben fusionarse. `[PROPUESTA]`

    A. FUENTE ORIGINARIA   proveedor que genera o gobierna la credencial
    B. SECRET STORE        lugar donde cada runtime guarda su copia
    C. CONSUMIDOR LOGICO   componente que la utiliza

`[EVIDENCIA-CODIGO]` Separacion de los tres conceptos por credencial.
| Cred. | A · Fuente originaria | B · Secret store operativo | C · Consumidor logico |
|---|---|---|---|
| S1 | Supabase | Netlify Env Vars | Nexus server runtime |
| S2 | Supabase | GitHub Actions Secrets | `supabase-backup.yml` |
| S3 | Google Cloud IAM | GitHub Actions Secrets | `supabase-backup.yml` |
| S4 | Clientify UI | Netlify Env Vars | Nexus server runtime |
| S5 | Nexus | Netlify Env Vars | Nexus (receptor de webhook) |
| S6 | Google Cloud IAM | **Netlify Env Vars → Netlify Blobs (store `secrets`)**, resueltos por cadena de providers (§7) | Nexus server runtime, via `src/lib/drive/client.ts` |
| S7 | Meta Business | Netlify Env Vars | Nexus server runtime |
| S8 | Nexus | Netlify Env Vars | Nexus (verificador de webhook) |
| S9 | ARCA | Netlify Env Vars (PEM base64) o secreto montado en host | Nexus facturacion |
| S10 | Resend | Netlify Env Vars | Nexus server runtime |
| S11 | OpenAI | Netlify Env Vars | Nexus server runtime |
| S12 | Nexus | Netlify Env Vars · configuracion del dispositivo | Nexus · dispositivos Traccar |
| S13 | NVR Hikvision | Netlify Env Vars | Nexus server runtime |
| S14 | Nexus | Netlify Env Vars · GitHub Actions Secrets | 7 emisores · 8 validadores |
| S16 | Google AI Studio | Netlify Env Vars (dos nombres) | Nexus server runtime (Copilot) |
| S17 | Anthropic | Netlify Env Vars | Nexus server runtime (Copilot) |
| S18 | Meta Business | Netlify Env Vars | Nexus (verificacion HMAC del webhook) |
| S19 | Nexus | Netlify Env Vars | `/api/whatsapp/send` |
| P1 | Supabase | Netlify Env Vars | Navegador y servidor |
| P2 | Mapbox | Netlify Env Vars → bundle del cliente | Navegador |

`[EVIDENCIA-CODIGO]`

`[EVIDENCIA-CODIGO]` **Correccion registrada sobre S6:** `GOOGLE_SERVICE_ACCOUNT_JSON` **no aparece en ningun
workflow** de la base. Su atribucion previa a GitHub Actions Secrets queda retirada. Sus stores
reales son los dos de la cadena de providers descrita en §7.

`[PROPUESTA]` **Make nunca seria fuente originaria.** Si alojara una copia, seria secret store
operativo, y la fuente originaria seguiria siendo el proveedor correspondiente. Que hoy aloje
alguna copia no esta demostrado por ninguna fuente del paquete.

`[EVIDENCIA-CODIGO]` **Lugares verificables desde el repositorio donde el producto localiza
credenciales: tres.** Netlify Environment Variables · Netlify Blobs, store `secrets`, **por
lectura** (§7.9) · GitHub Actions Secrets. A ellos se suma, para S9, la alternativa de secreto
montado en el host, y para S12 la configuracion del dispositivo.

`[NO VERIFICABLE]` **Un cuarto lugar, no confirmado:** la configuracion embebida de modulos de
Make. Ninguna fuente preservada en el paquete demuestra que una credencial de este inventario
resida alli. Se registra como candidato de store, no como store confirmado, y no se cuenta
entre los stores del producto.

`[PROPUESTA]` Los tres primeros y la configuracion de Make son stores donde consta que hay o
puede haber una copia. Netlify Blobs se registra como store previsto y cableado para lectura.

`[NO VERIFICABLE]` El contenido actual del store `secrets` de Netlify Blobs (§21, NV-8).

---

## 6. Matriz maestra

`[EVIDENCIA-CODIGO]` Matriz derivada del repositorio en la base declarada. Comprende las
diecinueve integraciones con anclaje en el arbol; A5 y B2 se tratan aparte porque su unica
fuente es la plataforma.

| ID | Integracion | Recarga | Health check | Crit. | Estado |
|---|---|---|---|---|---|
| A1 | `clientify-commercial` | rebuild + manual en Make | `/api/clientify/ping` existe | N2 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| A2 | `clientify-webhook` | rebuild | por crear | N1 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| A3 | `google-drive-corp` | rebuild (ver §7.9) | `/api/drive/ping` existe | N2 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| A4 | `meta-whatsapp-nexus` | rebuild | `/api/whatsapp/ping` existe; no detecta expiracion | N1 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| A6 | `meta-webhook` | rebuild | por crear | N1 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| A7 | `arca-wsfev1` | rebuild | por crear | N3 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| A8 | `resend-email` | rebuild | por crear | N1 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| A9 | `openai-ocr` | rebuild | por crear | N0 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| A10 | `traccar-ingest` | rebuild + configuracion del dispositivo | por crear | N1 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| A11 | `mapbox-gl` | rebuild | por crear | N0 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| A12 | `hikvision-nvr` | rebuild | `/api/cctv/ping` existe | N1 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| A13 | `fx-bna` | ninguna | por crear | N0 | NO CONFIGURADA |
| A14 | `gemini-ai` | rebuild | por crear | N1 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| A15 | `anthropic-ai` | rebuild | por crear | N1 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| B1 | `supabase-prod` | rebuild | por crear | N3 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| B3 | `github-actions` | inmediata | por crear | N2 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| B4 | `netlify-hosting` | no aplica | por crear | N3 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| C1 | `cron-internal` | rebuild + actualizacion del secreto en GitHub Actions | por crear | N2 | IMPLEMENTACION PRESENTE · NO VERIFICADA |
| D1 | `supabase-backup` | inmediata | por crear | N3 | IMPLEMENTACION PRESENTE · NO VERIFICADA |

`[EVIDENCIA-CODIGO]` La columna Estado de la matriz declara lo derivable del repositorio en la
base: existencia de implementacion y ausencia de comprobacion.

`[PROPUESTA]` A5 y B2 no figuran en la matriz. Sus campos tienen procedencias distintas —unos
observables en la plataforma, otros asignados por este inventario y otros sin fuente alguna—, de
modo que una fila homogenea fingiria una naturaleza unica que no existe. Se enuncian por
separado, y solo lo demostrable.

`[EVIDENCIA-PLATAFORMA]` Lo observable al corte del 2026-08-05, segun
`08-MAKE-EVIDENCE-SANITIZED.md` §3 y §5:

| ID | Hecho observable |
|---|---|
| A5 | Escenario activo; ultima ejecucion exitosa registrada el 2026-08-05T23:14:20Z |
| B2 | 3 de los 5 escenarios de la organizacion estaban activos |

`[PROPUESTA]` Criticidad asignada por este inventario, no observada: N2 para ambas.

`[EVIDENCIA-CODIGO]` Ninguna de las dos tiene health check en el producto: no existe ruta de
comprobacion asociada en `src/app/api/`.

`[NO VERIFICABLE]` Modalidad de recarga de ambas. La evidencia preservada no la consigna.

`[PROPUESTA]` Estado de ambas: NO VERIFICADA. En esta fase no se ejecuto comprobacion alguna, y
el registro de ejecuciones de la plataforma no es un health check (§2.4).

`[EVIDENCIA-CODIGO]` Calificadores contextuales que no forman parte del estado: el ambiente por
defecto de A7 es SANDBOX; el proveedor por defecto de A14 y A15 es `mock`; A15 es el proveedor
secundario; la restriccion por dominio de A11 no fue verificada; el estado operativo de D1 no
fue verificado.

Definiciones nominales de criticidad: N0 informativa · N1 importante · N2 critica · N3 sistemica.

---

## 7. Capa de credenciales: `src/lib/credentials/`

`[EVIDENCIA-CODIGO]` Existe en la base una capa de abstraccion de credenciales, ausente de
versiones previas de este inventario.

### 7.1 Componentes

`[EVIDENCIA-CODIGO]` Componentes de la capa de credenciales.
| Archivo | Rol |
|---|---|
| `index.ts` | Punto de entrada. `getCredential(key)` recorre la cadena y devuelve el primer record disponible |
| `types.ts` | Contratos `CredentialProvider`, `CredentialRecord` y errores tipados |
| `checksum.ts` | `sha256Hex` y `CHECKSUM_ALGO = "SHA-256"`, fuente unica del algoritmo |
| `providers/environment.ts` | `EnvironmentProvider` |
| `providers/blob.ts` | `BlobProvider` sobre Netlify Blobs |
| `providers/secret-manager.ts` | `SecretManagerProvider` — placeholder |
| `index.test.ts` | Pruebas de resolucion de la cadena |

### 7.2 Orden real de resolucion

    EnvironmentProvider  →  BlobProvider

`src/lib/credentials/index.ts:36-41` construye la cadena por defecto en ese orden. Ambos
providers estan **cableados**. El comentario de cabecera declara el criterio: entorno primero
para no alterar el desarrollo local, y Blobs en produccion una vez que la variable se retira
del alcance de las Functions. `[EVIDENCIA-CODIGO]`

### 7.3 Credenciales mapeadas

`[EVIDENCIA-CODIGO]` `src/lib/credentials/index.ts:27-29` define un unico mapeo:

    "google-service-account"  →  GOOGLE_SERVICE_ACCOUNT_JSON

Ninguna otra credencial de este inventario pasa hoy por esta capa. `[EVIDENCIA-CODIGO]`

### 7.4 Estado de cada provider

`[EVIDENCIA-CODIGO]` Estado de cada provider en la base.
| Provider | Codigo existente | Wiring efectivo | Backend | Comportamiento ante ausencia |
|---|---|---|---|---|
| `EnvironmentProvider` | Si | **Si** — primero en la cadena | `process.env` | Devuelve `null`; la cadena continua |
| `BlobProvider` | Si | **Si** — segundo en la cadena | Netlify Blobs, store `secrets` | Sin contexto de Netlify o sin dato, devuelve `null`; la cadena continua y no rompe |
| `SecretManagerProvider` | Si | **No** — no integra la cadena por defecto | Ninguno | `load()` devuelve `null` siempre |

`[EVIDENCIA-CODIGO]` `src/lib/credentials/providers/secret-manager.ts:7-12` declara
expresamente que es un placeholder y punto de extension, hoy no cableado.

### 7.5 Integridad

`BlobProvider` lee y deserializa desde el store un envelope JSON con `value`, `sha256`, `algo`
y `createdAt`, y **recomputa el SHA-256 en cada lectura**: ante discrepancia lanza
`CredentialIntegrityError` y el dato no se utiliza. `EnvironmentProvider` computa el checksum
al leer y, si existe la variable opcional `<ENV>_SHA256`, valida contra ella.
`[EVIDENCIA-CODIGO]`

### 7.6 Precedencia, cache y rotacion

El primer provider que devuelve un record gana. El resultado se memoiza por key; los errores no
se cachean. `resetCredentialCache(key?)` existe expresamente para invalidar tras una rotacion.
`[EVIDENCIA-CODIGO]` `src/lib/credentials/index.ts:48-77`

### 7.7 Consumidores reales

**Uno.** `src/lib/drive/client.ts:3,66` importa `getCredential`, `resetCredentialCache` y
`CredentialNotFoundError`, y resuelve la credencial de Service Account por esta via.
`src/lib/env.ts:233` documenta que el cliente de Drive la carga a traves de esta capa y no
desde la variable de entorno. `[EVIDENCIA-CODIGO]`

`[EVIDENCIA-CODIGO]` Eso alcanza al VALOR de la credencial, no a toda lectura del nombre. En la
base subsisten cinco lecturas directas de `process.env.GOOGLE_SERVICE_ACCOUNT_JSON`
—`src/lib/env.ts:235,244,300` y `src/lib/drive/client.ts:94,122`— que alimentan el indicador
`configured` y la proyeccion del email de la Service Account, no la autenticacion. Por eso S6
cuenta a la vez como resuelta por la capa y como credencial con lectura directa (§20, punto 15).

La dependencia `@netlify/blobs` figura en `package.json`. `[EVIDENCIA-CODIGO]`

### 7.8 Distincion exigida

| Dimension | Estado |
|---|---|
| A · Codigo existente | **Si**, completo y con pruebas |
| B · Wiring efectivo | **Si** para `EnvironmentProvider` y `BlobProvider`; **no** para `SecretManagerProvider` |
| C · Uso en produccion | **`[NO VERIFICABLE]`** — depende del contenido del store `secrets`, que no se consulto |
| D · Intencion futura documentada | Migrar el origen fisico sin tocar los consumidores, mediante `SecretManagerProvider` |

### 7.9 La capa es de lectura: no hay escritura demostrada

`[EVIDENCIA-CODIGO]` `BlobProvider` expone un unico metodo, `load()`. Es un lector.

`[EVIDENCIA-CODIGO]` `store.set` no aparece en ningun archivo de `src/lib/credentials/`.

`[EVIDENCIA-CODIGO]` `buildEnvelope` esta exportada, pero sus unicos consumidores en la base son
el propio modulo y su archivo de pruebas. No existe en el repositorio un uploader que la use
para cargar una credencial en el store.

`[NO VERIFICABLE]` No se verifico si el store `secrets` contiene actualmente credenciales.

`[PROPUESTA]` De lo anterior se sigue la distincion que rige todo este inventario:

    IMPLEMENTACION DEL READER  !=  CONTENIDO DEL STORE  !=  USO OPERATIVO VERIFICADO

`[PROPUESTA]` Este documento **no afirma** que Nexus ya almacene credenciales en Netlify Blobs.
Afirma unicamente que existe y esta cableado un lector capaz de resolverlas desde alli.

`[PROPUESTA]` En consecuencia, la modalidad de recarga de A3 se declara como reconstruccion del
artefacto. Una eventual actualizacion por escritura en el store seria posible sin
reconstruccion, pero depende de un mecanismo de escritura hoy no demostrado en la base.

---

## 8. CRON_SECRET

Fuente originaria: Nexus. Secreto propio, autoemitido. `[EVIDENCIA-CODIGO]`

### 8.1 Stores persistentes — 2

`[EVIDENCIA-CODIGO]` Store consumido por los workflows: `secrets.CRON_SECRET` figura en seis
workflows de `.github/workflows/`.

    GitHub Actions Secrets           consumido por los workflows

`[INFERENCIA]` Store consumido por el runtime desplegado: el codigo lee
`process.env.CRON_SECRET`, y que ese valor provenga de las variables de entorno de Netlify se
deduce del alojamiento declarado en B4.

    Netlify Environment Variables    consumido por el runtime desplegado

`[NO VERIFICABLE]` El contenido de ese store no se consulto (§21, NV-1).

`[PROPUESTA]` El runtime desplegado —funcion programada y endpoints— **no es un tercer store**: es consumidor
derivado que hereda la variable de Netlify. Ambos stores persistentes deben contener el mismo
valor.

### 8.2 Emisores — 7 `[EVIDENCIA-CODIGO]`

    1  .github/workflows/clientify-dashboard-sync.yml
    2  .github/workflows/contratos-drive-sync.yml
    3  .github/workflows/compliance-drive-sync.yml
    4  .github/workflows/caja-chica-drive-sync.yml
    5  .github/workflows/connect-dispatch-outbox.yml
    6  .github/workflows/knowledge-drain.yml
    7  netlify/functions/connect-dispatch-outbox.mts

### 8.3 Validadores — 8, con postura medida `[EVIDENCIA-CODIGO]`

`[EVIDENCIA-CODIGO]` Postura de cada validador, medida sobre la base.
| Endpoint | Mecanismo | Postura |
|---|---|---|
| `src/app/api/clientify/sync-deals/route.ts` | `requireCronAuth` | FAIL-CLOSED |
| `src/app/api/comercial/contratos/sync/route.ts` | `requireCronAuth` | FAIL-CLOSED |
| `src/app/api/compliance/sync/route.ts` | `requireCronAuth` | FAIL-CLOSED |
| `src/app/api/tesoreria/caja-chica/sync/route.ts` | `requireCronAuth` | FAIL-CLOSED |
| `src/app/api/whatsapp/send/route.ts` | `requireCronAuth` con secreto propio | FAIL-CLOSED |
| `src/app/api/connect/cron/dispatch-outbox/route.ts` | guard en linea, 503 si falta | FAIL-CLOSED |
| `src/app/api/clientify/sync-contacts/route.ts` | `if (cronSecret) { ... }` | fail-open |
| `src/app/api/knowledge/drain/route.ts` | `if (secret) { ... }` | fail-open |

**6 fail-closed · 2 fail-open.**

`[EVIDENCIA-CODIGO]` `src/lib/cron-auth.ts` define `checkCronAuth` y `requireCronAuth`: sin secreto configurado
responde 503, con credencial invalida responde 401, y compara en tiempo constante.

**Rectificacion registrada:** la afirmacion «7 de 8 validadores son fail-open», sostenida en
informes previos de este expediente, se derivo de una rama de trabajo obsoleta y queda
retirada. `[EVIDENCIA-HISTORICA]`

### 8.4 Excluidos `[EVIDENCIA-CODIGO]`

    .github/workflows/supabase-backup.yml       0 ocurrencias — usa S2 y S3
    .github/workflows/p3-n1a0-db-harness.yml    0 ocurrencias

`[INFERENCIA]` El backup de Supabase no se ve afectado por una rotacion de `CRON_SECRET`.

### 8.5 Impacto de rotacion

Siete consumidores obligatorios, dos stores persistentes que deben coincidir y reconstruccion
del artefacto de Netlify para que el runtime tome el valor nuevo. Una rotacion parcial produce
401 en hasta siete procesos hasta publicar el deploy. `[INFERENCIA]`

---

## 9. WHATSAPP_SEND_SECRET

`[EVIDENCIA-CODIGO]` `src/app/api/whatsapp/send/route.ts:31` implementa:

    requireCronAuth(req, process.env.WHATSAPP_SEND_SECRET ?? process.env.CRON_SECRET)

`[EVIDENCIA-CODIGO]` Lectura del contrato del endpoint de envio.
| Elemento | Clasificacion |
|---|---|
| `WHATSAPP_SEND_SECRET` (S19) | Credencial logica propia del endpoint de envio |
| `CRON_SECRET` (S14) | Fallback legacy — se usa solo si S19 esta ausente |
| Consumidor principal | `/api/whatsapp/send` |
| Postura ante ausencia de ambas | FAIL-CLOSED — `checkCronAuth` responde 503 |
| Relacion con C1 | `/api/whatsapp/send` deja de ser consumidor obligatorio de `CRON_SECRET` cuando S19 esta definido |

`[INFERENCIA]` Deuda de desacoplamiento registrada: mientras el fallback exista, una rotacion
de `CRON_SECRET` puede alterar el comportamiento del endpoint de envio de forma no evidente,
segun este o no definido `WHATSAPP_SEND_SECRET` en el entorno.

`[NO VERIFICABLE]` Si `WHATSAPP_SEND_SECRET` esta definido en el entorno (§21, NV-1).

---

## 10. Make como plataforma consumidora

`[EVIDENCIA-PLATAFORMA]` · organizacion 7052028 · team 2061037 · consulta 2026-08-05

    Keychains ............................. 0
    Conexiones gestionadas ................ 2   Gmail OAuth · Netlify basic
    Escenarios ............................ 5   3 activos · 2 inactivos
    Webhooks .............................. 10  todos habilitados · ninguno con clave de API
    Modulos HTTP .......................... 6   candidatos a portar credencial
    Cantidad exacta con credencial ........ [NO VERIFICABLE]

`[EVIDENCIA-PLATAFORMA]` Distribucion de los 6 modulos HTTP: Bot Max 3 · Formulario Web 1 · Landing Cargas Generales 1 ·
Landing ANMAT 1.

`[EVIDENCIA-PLATAFORMA]` Make posee cero keychains y dos conexiones gestionadas (§4.6), y
ninguna de esas dos conexiones sirve a los modulos HTTP.

`[INFERENCIA]` No existe entonces credencial gestionada disponible para esos modulos, de modo
que cualquier credencial que utilicen solo puede residir en su propia configuracion.

**`[INFERENCIA]`** Al menos un modulo HTTP de Make porta una credencial embebida.

`[PROPUESTA]` Criterio de exposicion de la inferencia.
Los tres elementos que la sostienen, ninguno suficiente por si solo, se enuncian por separado.

`[EVIDENCIA-PLATAFORMA]` Existen seis modulos HTTP sin keychains ni conexiones HTTP gestionadas.

`[EVIDENCIA-PLATAFORMA]` Una ejecucion del escenario WhatsApp Bot Max fallo el 2026-08-03 con
`InvalidConfigurationError: Unauthorized`, y el modulo causante fue un `MakeRequest (http)`. Que
un modulo devuelva Unauthorized implica que intento una peticion autenticada.

`[EVIDENCIA-PLATAFORMA]` El 2026-08-05 se registro una modificacion por el titular de la cuenta
y, a continuacion, una ejecucion correcta. La evidencia no consigna en que consistio esa
modificacion ni sobre que modulo recayo (§21, NV-5).

`[PROPUESTA]` **Un error 401 aislado no constituye prueba suficiente de que una credencial estuviera
presente**, porque tambien puede producirse por ausencia de credencial o por configuracion
incorrecta.

`[EVIDENCIA-PLATAFORMA]` Cinco webhooks sin escenario asociado permanecen habilitados y sin
autenticacion.

`[PROPUESTA]` Se trasladan a MAKE-HYGIENE-001. Este inventario no propone accion operativa
sobre ellos.

`[EVIDENCIA-PLATAFORMA]` La evidencia sanitizada preservada para estos webhooks comprende
exclusivamente: identificador numerico, escenario asociado, estado de habilitacion, modalidad
de autenticacion y longitud de cola. Se omiten deliberadamente los identificadores unicos, las
URLs y **tambien los nombres**, por no ser necesarios para reproducir los conteos.

---

## 11. Clientify — estado de convergencia

`[EVIDENCIA-CODIGO]` Credencial logica unica S4: misma cuenta, mismo proveedor. Fuente
originaria: Clientify UI. Make no es fuente originaria.

`[INFERENCIA]` Estado de convergencia entre copias: **PARCIAL**. Sus tres componentes se
enuncian por separado, cada uno con su naturaleza.

`[NO VERIFICABLE]` Netlify Environment Variables: la copia no se verifico en esta fase.

`[NO VERIFICABLE]` Make · modulos HTTP: PENDIENTE DE CLASIFICACION. El paquete no preserva
ninguna fuente que permita afirmar que alguno de ellos aloje una copia de esta credencial, ni
que alguno haya sido intervenido.

`[EVIDENCIA-PLATAFORMA]` Keychain central de Make: INEXISTENTE.

`[PROPUESTA]` No se declara sincronizacion entre Netlify y Make.

---

## 12. Supabase

Cuatro credenciales distintas. No son intercambiables y no se agrupan. `[EVIDENCIA-CODIGO]`

### S1 · `SUPABASE_SERVICE_ROLE_KEY`

`[EVIDENCIA-CODIGO]` Consumidor logico: Nexus server runtime (uno).

`[EVIDENCIA-CODIGO]` Usos internos demostrados — solicitan el cliente administrativo; no
constituyen consumidores independientes de la credencial. En la base, 33 archivos productivos
de `src/` invocan `createAdminClient()`, ademas del unico que lo declara. Se citan cuatro a modo
de ejemplo: la factory y tres invocadores.

    src/lib/supabase/server.ts                   factory del cliente admin
    src/lib/comercial/contracts-sync/engine.ts
    src/lib/compliance/sync/engine.ts
    src/lib/custody/pod-pdf.ts

`[EVIDENCIA-CODIGO]` `src/lib/comercial/contracts-sync/read.ts` no utiliza el cliente
administrativo: importa e invoca `createClient` y solo comprueba la presencia de la clave
—`Boolean(env.supabase.serviceRoleKey)` en su linea 27— para derivar un indicador de
configuracion.

`[EVIDENCIA-CODIGO]` Control positivo preexistente:

    src/lib/ai/tools.test.ts   verifica que la credencial no se filtre a las
                               herramientas de IA

### P1 · `NEXT_PUBLIC_SUPABASE_ANON_KEY`

`[PROPUESTA]` Credencial publica restringible. Gobernada por RLS, no por confidencialidad.

### S2 · `SUPABASE_DB_URL` · S3 · `GCP_SA_KEY`

Consumidor unico: `.github/workflows/supabase-backup.yml`. Sin consumidores de codigo fuera de
ese workflow. S2 es la cadena de conexion de produccion; S3 es la Service Account con acceso a
Drive utilizada para subir el backup. `[EVIDENCIA-CODIGO]`

---

## 13. Meta — tres credenciales confirmadas, tres integraciones

`[EVIDENCIA-CODIGO]` Las tres credenciales de Meta confirmadas en la base y su funcion.
| Credencial | Integracion | Funcion |
|---|---|---|
| S7 `META_WA_TOKEN` | A4 | Bearer de la Graph API para envio desde Nexus |
| S8 `META_WA_WEBHOOK_VERIFY_TOKEN` | A6 | Token de verificacion del handshake del webhook |
| S18 `META_WA_APP_SECRET` | A6 | Verificacion HMAC de la firma de los mensajes entrantes |

Las tres son distintas y no deben confundirse. S8 autentica el alta del webhook; S18 autentica
cada mensaje recibido. `[EVIDENCIA-CODIGO]` `src/app/api/whatsapp/webhook/route.ts:56`.

`[NO VERIFICABLE]` El candidato S15, asociado a A5, no se cuenta entre ellas: la evidencia
preservada no demuestra que exista una credencial de Meta diferenciada para el Bot Max (§4.7).

`[EVIDENCIA-PLATAFORMA]` El funcionamiento de Bot Max prueba unicamente el estado de A5.

`[NO VERIFICABLE]` El estado de A4 y la validez de S7.

El health check de Nexus consulta un endpoint cuyos campos no incluyen la expiracion del token y
devuelve el campo de expiracion fijo en nulo (`src/lib/whatsapp/meta.ts`). **No detecta
expiracion.** `[EVIDENCIA-CODIGO]`

---

## 14. ARCA

`[PROPUESTA]` Clasificacion adoptada para el par criptografico de ARCA, conforme al criterio de
§4.5:

    Certificado X.509    artefacto PUBLICO — componente del par
    Clave privada        SECRETO S9

Ambos se entregan por dos vias alternativas: contenido PEM en variable de entorno o ruta a
secreto montado en el host. La logica de configuracion acepta cualquiera de las dos
(`src/lib/env.ts:218-219`), lo que constituye deuda declarada en §20. `[EVIDENCIA-CODIGO]`

El ambiente por defecto es `SANDBOX`. Esto describe la implementacion, no el estado operativo
de la integracion. `[EVIDENCIA-CODIGO]`

---

## 15. A14 · Integracion Gemini

`[EVIDENCIA-CODIGO]` Ficha de A14 segun la base.
| Campo | Valor |
|---|---|
| Proveedor | Google |
| Rol | Proveedor de modelo principal previsto del Copilot |
| Credencial | S16 |
| Modelo por defecto | `gemini-2.5-pro` cuando el proveedor no es `anthropic` |
| Activacion | Requiere `AI_ENABLED=1` y `AI_PROVIDER=gemini` y la clave en el store |
| Proveedor por defecto | `mock` — determinista, sin red y sin secretos |
| Estado | IMPLEMENTACION PRESENTE · NO VERIFICADA |

`[EVIDENCIA-CODIGO]` `src/lib/env.ts:92-95` registra la decision de Direccion del 2026-07-03 que
designa a Gemini como proveedor principal previsto y condiciona la activacion real a una
ventana aprobada.

**Limites operativos codificados** (`src/lib/env.ts:124-135`): 40 solicitudes por dia, 4 rondas
de herramienta por solicitud, 4000 tokens de salida, 24000 caracteres de contexto, 10 turnos por
sesion y un tope mensual global de 100 USD. Son valores por defecto, ajustables por variables de
entorno. `[EVIDENCIA-CODIGO]`

---

## 16. A15 · Integracion Anthropic

`[EVIDENCIA-CODIGO]` Ficha de A15 segun la base.
| Campo | Valor |
|---|---|
| Proveedor | Anthropic |
| Rol | Proveedor de modelo secundario, no preferido |
| Credencial | S17 `AI_ANTHROPIC_API_KEY` |
| Modelo por defecto | `claude-opus-4-8` cuando `AI_PROVIDER=anthropic` |
| Estado | IMPLEMENTACION PRESENTE · NO VERIFICADA |

`[EVIDENCIA-CODIGO]` `src/lib/env.ts:121-122`.

### Capacidad de rotacion

`[INFERENCIA]` Clasificacion derivada de la documentacion publica del proveedor, externa a este
expediente y no preservada en el paquete:

    CREACION            manual, desde Claude Console.
    GESTION POSTERIOR   parcialmente automatizable mediante la Admin API para las
                        capacidades soportadas, como listado y actualizacion o
                        inactivacion de keys existentes.
    ROTACION COMPLETA   no automatizable end-to-end unicamente mediante la Admin API
                        actual, porque la generacion de una nueva key requiere
                        intervencion en Console.

`[PROPUESTA]` S17 no se clasifica como «rotacion end-to-end por API». Su rotacion es un
procedimiento mixto. Ver `ADR-NIM-001 §6.2`.

---

## 17. Aliases `AI_GEMINI_API_KEY` / `GEMINI_API_KEY`

`[EVIDENCIA-CODIGO]` **Una unica credencial logica (S16) con dos nombres de configuracion.**

`[EVIDENCIA-CODIGO]` `src/lib/env.ts:117-120` implementa una cadena de precedencia:

    geminiApiKey = AI_GEMINI_API_KEY?.trim() || GEMINI_API_KEY?.trim() || ""

| Aspecto | Valor |
|---|---|
| Precedencia | `AI_GEMINI_API_KEY` es primaria |
| Fallback | `GEMINI_API_KEY` |
| Consumidores | Nexus server runtime (Copilot) |
| Declaracion del codigo | Ambas cargadas con el mismo valor (`src/lib/env.ts:113-115`) |
| Riesgo de divergencia | Si ambas estan definidas con valores distintos, el sistema usa silenciosamente la primaria y la secundaria queda como copia obsoleta no detectable. Una rotacion que actualice solo una de las dos no produce error observable |
| Verificacion de igualdad de valores | `[NO VERIFICABLE]` en esta fase (§21, NV-11) |

**Recomendacion futura:** converger a un unico nombre de configuracion, retirando
`GEMINI_API_KEY` tras confirmar que ningun consumidor depende de el. `[PROPUESTA]`

---

## 18. Resoluciones previas sobre credenciales de IA

`[EVIDENCIA-CODIGO]` Se busco en la base declarada cualquier resolucion que afectara a S16 o S17 —aceptacion de
riesgo, dispensa de rotacion o exclusion de gobierno—.

`[NO VERIFICABLE]` No existe en la base un expediente identificable con esa materia.

`[EVIDENCIA-CODIGO]` Lo unico documentado en el codigo es la decision de Direccion del
2026-07-03 sobre la eleccion de proveedor y la condicion de ventana aprobada para la activacion
real (`src/lib/env.ts:92-95`), que no constituye dispensa de rotacion ni aceptacion de riesgo
sobre la credencial.

`[PROPUESTA]` En consecuencia no se declara dispensa alguna, y S16 y S17 permanecen dentro del inventario
gobernado con el mismo regimen que las restantes credenciales privadas.

---

## 19. Capacidades existentes reutilizables

`[EVIDENCIA-CODIGO]`

    Capa de credenciales con providers, checksum y cache
        src/lib/credentials/ — ver §7. Ya resuelve precedencia, integridad y
        invalidacion tras rotacion para una credencial
    Cuatro health checks ya implementados
        /api/clientify/ping    devuelve identificacion de cuenta y conteos
        /api/drive/ping        incluye control de tasa
        /api/whatsapp/ping     no detecta expiracion (§13)
        /api/cctv/ping
    Guard unico fail-closed para cron
        src/lib/cron-auth.ts — 503 sin secreto, 401 con credencial invalida,
        comparacion en tiempo constante. Ya adoptado por 5 de 8 validadores
    Motor de estado del Cockpit
        src/lib/ejecutivo/command-center.ts modela estados y criticidad;
        solo una integracion verifica realmente contra la API
    Cliente HTTP con reintentos
        src/lib/clientify/client.ts maneja 429 con retry-after y reintenta 5xx
    Registro de auditoria
        tabla audit_log
    Bitacoras de sincronizacion por integracion
        el Integration Manager las lee; no las reemplaza
    Canal de notificaciones con outbox
    Control positivo de no filtracion
        src/lib/ai/tools.test.ts — patron a replicar en el sanitizador

---

## 20. Deuda tecnica declarada

`[EVIDENCIA-CODIGO]` Los puntos 1 a 9 son observables en la base:
1. Diez indicadores `configured` se renderizan como estado de conexion.
2. Dos de ocho validadores de `CRON_SECRET` siguen siendo fail-open:
   `clientify/sync-contacts` y `knowledge/drain`.
3. `knowledge/drain` declara «Fail-closed» en su comentario de cabecera mientras el codigo
   implementa el patron fail-open. Divergencia entre documentacion y comportamiento.
4. Fallback `WHATSAPP_SEND_SECRET ?? CRON_SECRET` sin desacoplar (§9).
5. Alias `AI_GEMINI_API_KEY` / `GEMINI_API_KEY` sin converger (§17).
6. Doble via de entrega para la credencial de ARCA.
7. Dos planificadores para el mismo drenaje de outbox: workflow cada 10 minutos y funcion
   programada cada 5 minutos.
8. Bitacoras de sincronizacion con esquemas distintos.
9. Sin identificador de correlacion transversal.

`[INFERENCIA]` El punto 10 es una ausencia constatada por busqueda, no un hecho positivo:

10. Ningun runbook de rotacion para ninguna integracion.

`[EVIDENCIA-CODIGO]` Los puntos 11 a 15 son observables en la base:

11. Alias sin fuente unica: `NEXT_PUBLIC_APP_URL` y `NEXT_PUBLIC_SITE_URL`.
12. Dos rutas para el mismo webhook de Clientify.
13. `RBAC_ENFORCE` con comportamiento fail-open documentado.
14. `GOOGLE_SA_EMAIL` participa del indicador `configured` de Drive junto con
    `GOOGLE_SERVICE_ACCOUNT_JSON`, de modo que la presencia de un identificador —no de una
    credencial— puede habilitar el estado de configuracion.
15. La capa de credenciales gobierna una sola de las 20 credenciales confirmadas. Dieciocho de
    esas veinte tienen al menos una lectura directa de `process.env` en `src/`, sin checksum,
    sin cache invalidable y sin cadena de providers; las dos restantes —`SUPABASE_DB_URL` y
    `GCP_SA_KEY`— no la tienen porque solo existen como secretos de workflow. La unica
    credencial que pasa por la capa conserva ademas lecturas directas, de modo que ambas
    categorias se superponen y no se suman.

---

## 21. Hallazgos NO VERIFICABLES — 12

`[NO VERIFICABLE]` Los doce hallazgos que no pueden establecerse con el instrumental autorizado.
| # | Hallazgo | Motivo | Que lo cerraria |
|---|---|---|---|
| NV-1 | Estado real del secret store de Netlify Environment Variables | El instrumental disponible devolveria valores | Exportacion manual desde la interfaz, sin valores |
| NV-2 | Validez actual de S7 | Exigiria llamada autenticada | Health check autorizado |
| NV-3 | Estado del modulo directo Nexus → Meta | Idem NV-2 | Idem |
| NV-4 | Cantidad exacta de modulos de Make con credencial embebida | Exigiria exportar configuraciones | Inspeccion autorizada con redaccion garantizada |
| NV-5 | Identidad del modulo que devolvio Unauthorized el 2026-08-03 | Idem NV-4 | Idem |
| NV-6 | Ultima actividad de los cinco webhooks huerfanos | La API no expone el campo | MAKE-HYGIENE-001 |
| NV-7 | Existencia actual de build hooks temporales en Netlify | Sin operacion de lectura disponible | Verificacion manual en la interfaz |
| NV-8 | Contenido del store `secrets` de Netlify Blobs y, por tanto, si S6 se resuelve hoy por entorno o por Blobs en produccion | No se consulto el store | Consulta de solo lectura autorizada, sin valores |
| NV-9 | Numeracion libre para nuevas migraciones | Requiere catalogo de la base, no el tracker | Consulta de lectura autorizada |
| NV-10 | Si Clientify admite claves superpuestas | No documentado por el proveedor | Prueba en cuenta de laboratorio |
| NV-11 | Igualdad de valores entre `AI_GEMINI_API_KEY` y `GEMINI_API_KEY` | Depende de NV-1 | Idem NV-1 |
| NV-12 | Existencia de una resolucion previa sobre credenciales de IA | No hallada en la base (§18) | Aporte documental de Direccion |

---

## 22. Expedientes derivados

`[PROPUESTA]` Expedientes derivados sugeridos.
| Expediente | Objeto | Prioridad |
|---|---|---|
| MAKE-HYGIENE-001 | Webhooks huerfanos, autenticacion y escenarios historicos | Alta |
| NEXUS-INT-MGR-001-F0B | Higiene y catalogo de `.env.example` | Media |
| OCR-AUDIT-001 | Uso efectivo de A9 | Baja |

---

## 23. Historial de revisiones

`[PROPUESTA]` Historial de versiones de este documento.
| Version | Fecha de corte | Base | Cambio |
|---|---|---|---|
| 1.0 | 2026-08-06T16:19:09Z | `64a9f9fb` | Version inicial sobre la base definitiva |
| 1.1 | 2026-08-06T16:19:09Z | `64a9f9fb` | Segunda redaccion tras veredicto C4 FAIL: normalizacion de etiquetas; destino real de D1 corregido a Google Drive; incorporacion de la capa `src/lib/credentials/` (§7) y de Netlify Blobs como cuarto secret store; correccion del store de S6; eliminacion de la contradiccion sobre credenciales gestionadas de Make; correccion de referencias internas; retiro de la afirmacion de referencia rota a `docs/runbooks/RELEASE.md` |
| 1.3 | 2026-08-06T16:19:09Z | `64a9f9fb` | Remediacion quirurgica tras tercer veredicto C4 FAIL: unicidad de naturaleza por bloque material, verificada con un verificador externo que comprueba unicidad y no solo presencia; separacion evidencia/inferencia en los bloques senalados; `CRON_SECRET` deja de presentarse como seis secretos —es un unico nombre consumido por seis workflows—; eliminada la excepcion que permitia declarar OPERATIVA sin health check vigente; estado de B4 devuelto al vocabulario cerrado y evidencia de plataforma de A5 y B2 movida fuera de la columna Estado |
| 1.2 | 2026-08-06T16:19:09Z | `64a9f9fb` | Remediacion final tras segundo veredicto C4 FAIL: cobertura completa de etiquetas por afirmacion material, con separacion de naturalezas; §7.9 declara que la capa de credenciales es de lectura y que no existe writer demostrado; Netlify Blobs reclasificado como store previsto y cableado para lectura, con contenido NO VERIFICABLE; recarga de A3 corregida a reconstruccion; capacidad de rotacion de S17 reclasificada como procedimiento mixto; §10 alineado con la evidencia sanitizada preservada, que omite los nombres de los webhooks |
| FINAL-DOCUMENTAL | 2026-08-06T16:19:09Z | `64a9f9fb` | Cierre directo por resolucion expresa de Direccion, que dispensa para este expediente una nueva revision adversarial posterior. Se corrigen los tres defectos residuales de procedencia documental. **Fuentes**: la clasificacion de capacidad de rotacion por proveedor deja de invocar una resolucion de Direccion y declara su base real —documentacion publica del proveedor, externa y no preservada—, de modo que se enuncia como inferencia revisable; el cierre de GOV-ADAPTER-001 pasa a citar su fuente reproducible en Git; la aprobacion del estado intermedio de ADR-NIM-002 deja de presentarse como evidencia historica y se enuncia como parte de la decision de esa ADR. **Convergencia del CRM**: deja de atribuirse a la plataforma de automatizacion; se apoya en las divergencias que documenta CRED-CLF-001 y la conclusion de parcialidad se enuncia como inferencia. **Alcance del negativo**: la afirmacion sobre el identificador ausente se limita al universo efectivamente auditado y no se extiende al universo documental de la organizacion |
| 1.7-SOURCE-INTEGRITY-CLOSEOUT | 2026-08-06T16:19:09Z | `64a9f9fb` | Remediacion tras el veredicto C4 manual de Direccion sobre v1.6, sobre la misma base de evidencia, con una regla unica: si el paquete no puede demostrar una celda, esa celda no se presenta como hecho. **Trazabilidad por celda**: A5 y B2 dejan de exhibirse como filas homogeneas; una auditoria celda por celda determino que de sus dieciseis campos solo cinco son demostrables por la evidencia de plataforma, seis tienen procedencia distinta y cinco carecen de fuente, de modo que cada grupo se enuncia por separado y lo indemostrable pasa a no verificable. A5 sale del conjunto confirmado: la evidencia demuestra un escenario de Make llamado «WhatsApp Bot Max», no la identidad de una integracion con Meta. **Fuente historica**: no se localizo un expediente u objeto fuente con identificador exacto CRED-CLF-MAKE-001 entre las fuentes utilizadas para sustentar este inventario, de modo que las afirmaciones que lo invocaban quedan sin sustento; el expediente que si sostiene parte de ellas es CRED-CLF-001, incorporado al paquete sanitizado. De los cinco claims que se le atribuian, ese objeto sostiene dos —el mapa de copias divergentes y el indicador favorable frente al 401— y no sostiene tres: la copia alojada en modulos de Make, la sustitucion del header de autenticacion y la intervencion del modulo. Los tres quedan retirados, y con ellos el cuarto store, que pasa de confirmado a candidato. **Universo**: 20 integraciones confirmadas —19 por repositorio y una por plataforma— mas un candidato de integracion y un candidato de credencial |
| 1.6-EVIDENCE-CLOSEOUT | 2026-08-06T16:19:09Z | `64a9f9fb` | Remediacion tras el veredicto C4 manual de Direccion sobre v1.5-CLOSEOUT, sobre la misma base de evidencia, con la regla de que el documento se adapta a la evidencia disponible y no al reves. Tres causas raiz. **Procedencia**: A5 y B2 salen de las tablas rotuladas como evidencia de codigo —no tienen anclaje alguno en el arbol— y pasan a bloques propios de evidencia de plataforma, con su fuente identificada; la misma regla se aplica al cuarto lugar de almacenamiento, cuya unica fuente es el expediente CRED-CLF-MAKE-001. **fx-bna**: se retira la afirmacion de que opera sin credencial, incompatible con NO CONFIGURADA; la formulacion viva declara que existe una referencia conceptual a `fx_bna_quote` y que no hay integracion externa conectada. **S15**: la evidencia preservada no demuestra la existencia de una credencial de Meta diferenciada, de modo que sale del conjunto confirmado y queda registrado en §4.7 como candidato no verificable, sin store, sin consumidor y sin uso aritmetico. El universo se recalcula por medicion: 20 credenciales confirmadas —18 privadas y 2 publicas— y 18 de esas veinte con lectura directa de `process.env` |
| 1.5-CLOSEOUT | 2026-08-06T16:19:09Z | `64a9f9fb` | Remediacion final tras el veredicto C4 manual de Direccion sobre v1.4-FORENSIC, sobre la misma base de evidencia: §3.2 y §3.3 dejan de insertar el parrafo rotulador entre la fila separadora y la primera fila de datos, lo que rompia ambas tablas; §3.5, §7.3, §8.1 y §14 reciben la naturaleza que corresponde a su fuente real, y §3.5 y §8.1 se parten porque mezclaban codigo con plataforma e inferencia; las filas A5 y B2 de la matriz devuelven a NO VERIFICADA y sus hechos de plataforma —ultima ejecucion exitosa y escenarios activos— pasan a un bloque `[EVIDENCIA-PLATAFORMA]` fuera de la tabla; A13 pasa a NO CONFIGURADA porque en la base no existen ruta, cliente, provider ni dependencia de red, y se retiran de §4.5 las cuatro variables `FX_BNA_*`, inexistentes en el arbol; el conteo de lecturas directas de `process.env` se corrige de diecisiete a dieciocho, porque tener lectura directa y resolverse por la capa de credenciales no son propiedades excluyentes |
| 1.4-FORENSIC | 2026-08-06T16:19:09Z | `64a9f9fb` | Reparacion forense minima sobre v1.3, sin reescritura y sobre la misma base de evidencia: §7.5 deja de atribuir escritura a `BlobProvider` y declara lectura y deserializacion del envelope; §11 y §12 parten los bloques preformateados que mezclaban o carecian de naturaleza; §12 retira `contracts-sync/read.ts` de los usos del cliente administrativo —usa `createClient` y solo comprueba presencia de la clave— y declara el conteo medido de invocaciones efectivas de `createAdminClient()`, excluidas las menciones en comentarios y cadenas; §20 separa el punto 10 del rotulo de evidencia que lo abarcaba y corrige a diecisiete las credenciales leidas directamente de `process.env`, medidas por control cuantitativo reproducible |
