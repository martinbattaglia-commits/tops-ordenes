# ADR-NIM-001 — Modelo de custodia de secretos del Nexus Integration Manager

`[PROPUESTA]` Metadatos declarados de este ADR.
| Campo | Valor |
|---|---|
| Status | **ACCEPTED** |
| Implementation status | **PENDING** |
| Decision authority | **Direccion** |
| Date | 2026-08-06 |
| Version | FINAL-DOCUMENTAL |
| Expediente | NEXUS-INT-MGR-001 |
| Producto | `tops-ordenes` |
| Base de evidencia | `64a9f9fb9d3c36560fda8fb0fc7bae2b62288303` |
| Clasificacion | ADR de producto |

Definiciones nominales del encabezado: no constituyen afirmaciones materiales.

`[PROPUESTA]` Este ADR esta subordinado al canon, no es normativo para otros productos, no
modifica el corpus sellado y no puede contradecir ADR canonicos vigentes.

## 1. Naturaleza de esta aceptacion

`[PROPUESTA]` La decision arquitectonica esta aprobada por Direccion.

`[PROPUESTA]` La implementacion tecnica NO esta autorizada.

`[PROPUESTA]` La aceptacion de este ADR no equivale a autorizacion de codigo, migracion,
deploy ni cambio de produccion. Cada una de esas acciones requiere una resolucion
independiente.

## 2. Contexto

`[EVIDENCIA-CODIGO]` Nexus ERP comprende 19 integraciones logicas con anclaje en el
repositorio y 20 credenciales logicas gobernadas confirmadas: 18 secretos privados y 2
credenciales publicas restringibles.

`[EVIDENCIA-PLATAFORMA]` A ellas se suma una integracion mas, confirmada por la evidencia de
plataforma preservada aunque sin anclaje en el repositorio: la propia plataforma de
automatizacion. El total confirmado es de 20 integraciones.

`[NO VERIFICABLE]` Quedan fuera del conjunto confirmado un candidato de integracion y un
candidato de credencial, que la evidencia preservada no demuestra. Detalle en
`INVENTORY.md §3.1` y en `INVENTORY.md §4.7`.

`[EVIDENCIA-CODIGO]` El universo inventariado abarca 87 nombres de variable, de los cuales 84
se utilizan con nombre literal en `src/`.

`[EVIDENCIA-CODIGO]` Existen tres lugares verificables desde el repositorio donde el producto
localiza credenciales:

    Netlify Environment Variables
    Netlify Blobs (store `secrets`), a traves de un provider de lectura
    GitHub Actions Secrets

`[NO VERIFICABLE]` Un cuarto lugar no esta confirmado: la configuracion embebida de modulos de
Make. Ninguna fuente preservada demuestra que una credencial gobernada resida alli. Se registra
como candidato de store. Detalle en `INVENTORY.md §5`.

`[EVIDENCIA-CODIGO]` A ellos se suman, para credenciales concretas, la alternativa de secreto
montado en el host y la configuracion del dispositivo.

`[EVIDENCIA-CODIGO]` El producto posee una capa de credenciales en `src/lib/credentials/` con
una cadena de providers `EnvironmentProvider → BlobProvider`, verificacion de integridad por
SHA-256 en cada lectura, cache invalidable y un `SecretManagerProvider` no cableado. Hoy esa
capa resuelve una sola credencial: la Service Account de Google. Detalle en `INVENTORY.md §7`.

`[EVIDENCIA-PLATAFORMA]` Make posee cero keychains y dos conexiones gestionadas —una OAuth de
Gmail y una basic de Netlify—, y ninguna de ellas sirve a sus modulos HTTP.

`[PROPUESTA]` Esas dos conexiones se inventarian por separado y no integran el alcance inicial
de rotacion.

`[EVIDENCIA-CODIGO]` El inventario incluye dos proveedores de modelo de lenguaje: Gemini como
principal previsto y Anthropic como secundario.

`[NO VERIFICABLE]` No se hallo en la base ninguna resolucion documentada que dispense de
rotacion o acepte riesgo sobre las credenciales de esos dos proveedores. En consecuencia
permanecen dentro del inventario gobernado.

`[EVIDENCIA-HISTORICA]` El expediente CRED-CLF-001, preservado en el paquete como
`13-CRED-CLF-001-SANITIZED.md`, demostro que sin inventario de consumidores una rotacion deja
copias antiguas en circulacion: la clave se cargo en un solo sitio y el mapa verificado hallo
la credencial repartida en cuatro sitios distintos, cada uno con un nombre de variable propio.

## 3. Decision

### 3.1 Modelo A — Orquestacion sin custodia central generalizada. Vigente.

`[PROPUESTA]` Nexus gobierna metadatos, consumidores, validacion, rotacion, salud y auditoria
sin convertirse en un vault central universal.

`[PROPUESTA]` Cada credencial declara tres conceptos distintos, que nunca se fusionan:

    fuente originaria    proveedor que genera o gobierna la credencial
    secret store         lugar donde cada runtime guarda su copia
    consumidor logico    componente que la utiliza

`[PROPUESTA]` Ninguna formulacion puede declarar a un secret store como fuente originaria.

### 3.2 Estado real de la capa de almacenamiento — sin sobreafirmar

`[PROPUESTA]` La formulacion absoluta «Nexus no almacena valores de secretos» queda revocada
por imprecisa.

`[PROPUESTA]` La formulacion opuesta «Nexus ya almacena secretos en Blobs» tampoco se adopta:
la evidencia disponible no la sostiene.

Lo que la evidencia demuestra, separado por naturaleza:

`[EVIDENCIA-CODIGO]` Existe `BlobProvider` y expone un unico metodo, `load()`. Es un lector.

`[EVIDENCIA-CODIGO]` `BlobProvider` referencia un store denominado `secrets`.

`[EVIDENCIA-CODIGO]` `BlobProvider` esta incorporado a la cadena de providers por defecto, en
segunda posicion, segun `src/lib/credentials/index.ts`.

`[EVIDENCIA-CODIGO]` No existe dentro de esta capa ningun writer ni uploader: `store.set` no
aparece en `src/lib/credentials/`.

`[EVIDENCIA-CODIGO]` `buildEnvelope` esta exportada, pero sus unicos consumidores en la base
son el propio modulo y su archivo de pruebas. Su existencia no demuestra por si sola carga
operativa de secretos.

`[NO VERIFICABLE]` No se verifico si el store `secrets` contiene actualmente credenciales.

`[PROPUESTA]` De lo anterior se sigue la distincion que este ADR fija:

    IMPLEMENTACION DEL READER  !=  CONTENIDO DEL STORE  !=  USO OPERATIVO VERIFICADO

`[INFERENCIA]` La capa parece disenada para permitir que determinadas credenciales dejen de
depender exclusivamente de variables de entorno, sin obligar a modificar sus consumidores.

`[PROPUESTA]` La existencia de un provider de almacenamiento no equivale al Modelo C y no lo
activa. Se distingue por su alcance:

`[PROPUESTA]` Criterio de distincion por alcance.
| Dimension | Provider existente | Modelo C |
|---|---|---|
| Alcance | Una credencial mapeada, por excepcion | Universal, todas las credenciales |
| Backend | Store del propio hosting, ya contratado | Servicio especializado de custodia |
| Dependencia nueva | Ninguna | Si |
| Decision requerida | Ya tomada en el producto | Requiere ADR expresa |

### 3.3 Modelo B — Ingreso o custodia efimera, gestionada por integracion.

`[PROPUESTA]` Habilitable por integracion, nunca de forma general. Precondiciones acumulativas
y verificables:

    saga compensable implementada
    sanitizador probado con control positivo
    auditoria append-only operativa
    RBAC fail-closed con independencia de la variable de refuerzo
    entorno representativo materializado y aprobado
    rollback ejecutado, no solamente escrito
    aprobacion independiente

### 3.4 Modelo C — Custodia central universal. Descartada para esta etapa.

`[PROPUESTA]` Descartada. Reconsiderable unicamente mediante nueva ADR expresa.

`[EVIDENCIA-CODIGO]` `SecretManagerProvider` existe, no integra la cadena por defecto y su
`load()` devuelve siempre `null`.

`[PROPUESTA]` Se registra como punto de extension no cableado. No se presenta como
implementacion activa.

### 3.5 Equivalencia eliminada

`[PROPUESTA]` «No adoptar custodia central» NO significa «Nexus nunca puede almacenar ningun
secreto». Esa equivalencia queda expresamente eliminada de este ADR.

`[PROPUESTA]` El criterio rector no es la prohibicion de todo almacenamiento, sino:
1. que cada credencial tenga fuente originaria, store y consumidor declarados;
2. que ningun store se adopte de forma generalizada sin decision expresa;
3. que todo almacenamiento propio verifique integridad y permita invalidacion tras rotacion;
4. que el estado real de uso no se declare sin evidencia.

### 3.6 Alcance del modelo inicial

`[PROPUESTA]` El modelo inicial no gobierna todavia el ciclo de vida de conexiones OAuth o
basic gestionadas enteramente por plataformas de automatizacion. Su incorporacion requerira una
fase o expediente posterior.

`[PROPUESTA]` Esta exclusion es de alcance, no de criterio: dichas conexiones siguen siendo
activos sensibles y quedan registradas en `INVENTORY.md §4.6`.

## 4. Limites permanentes

`[PROPUESTA]` Nexus no realizara scraping de portales de proveedores.

`[PROPUESTA]` Nexus no almacenara usuario y contrasena de portales de proveedores.

`[PROPUESTA]` Cuando el proveedor exija generacion manual, el primer paso permanece humano.

## 5. Fundamento

`[PROPUESTA]` Este ADR se apoya en el principio de gobierno sin custodia central del
expediente, en el articulo de MVP First de la Session Bootstrap Law, en el principio de
proporcionalidad, en la seccion Dependencias de las Engineering Guidelines y en el principio de
operacion humana explicita.

## 6. Capacidad real de rotacion por proveedor

`[PROPUESTA]` Se emplea una taxonomia de tres grados, separando creacion de gestion posterior.

`[PROPUESTA]` Las tres clasificaciones de esta seccion se apoyan en documentacion publica de
cada proveedor, que es externa a este expediente y no se preserva en el paquete. Por eso se
enuncian como inferencias revisables y ninguna se presenta como evidencia reproducible.

### 6.1 Rotacion completa automatizable por API

`[INFERENCIA]` Segun la documentacion publica de cada proveedor, admiten creacion y revocacion
programatica de credenciales: Google Cloud IAM, Resend, OpenAI, Mapbox y Google AI Studio.

`[EVIDENCIA-CODIGO]` Los secretos autoemitidos por Nexus —`CRON_SECRET`,
`CLIENTIFY_WEBHOOK_SECRET`, `META_WA_WEBHOOK_VERIFY_TOKEN`, `TRACKING_INGEST_TOKEN` y
`WHATSAPP_SEND_SECRET`— son generados por la propia organizacion y por tanto rotables sin
dependencia de terceros.

### 6.2 Rotacion parcialmente automatizable

**Anthropic (`AI_ANTHROPIC_API_KEY`).**

`[INFERENCIA]` Clasificacion derivada de la documentacion publica del proveedor. Esa
documentacion es externa y no se preserva en el paquete, de modo que la clasificacion es
revisable y no se presenta como evidencia:

    CREACION            manual, desde Claude Console.
    GESTION POSTERIOR   parcialmente automatizable mediante la Admin API para las
                        capacidades soportadas, como listado y actualizacion o
                        inactivacion de keys existentes.
    ROTACION COMPLETA   no automatizable end-to-end unicamente mediante la Admin API
                        actual, porque la generacion de una nueva key requiere
                        intervencion en Console.

`[PROPUESTA]` En consecuencia `AI_ANTHROPIC_API_KEY` no se clasifica como «rotacion end-to-end
por API». Su rotacion es un procedimiento mixto: paso de creacion humano, gestion posterior
automatizable.

### 6.3 Creacion y revocacion manual en portal

`[INFERENCIA]` Segun la documentacion publica de cada proveedor, no ofrecen creacion
programatica de credenciales: Clientify, Meta, ARCA y Hikvision.

### 6.4 Sin rotacion aislada

`[INFERENCIA]` Las credenciales derivadas del secreto de firma del proyecto de base de datos no
pueden rotarse de forma individual sin afectar al conjunto.

`[PROPUESTA]` La expresion «rotable por API» se reserva exclusivamente al grupo 6.1.

## 7. Consecuencias

### 7.1 Positivas

`[INFERENCIA]` No existe un unico deposito universal cuyo compromiso exponga todas las
credenciales.

`[EVIDENCIA-CODIGO]` El modelo no introduce dependencias nuevas: la capa de credenciales y su
unica dependencia externa ya estan presentes en la base.

`[INFERENCIA]` La capa de credenciales existente ofrece un punto de insercion natural para el
gobierno, sin reescribir consumidores.

### 7.2 Aceptadas

`[PROPUESTA]` La propagacion hacia Make permanece manual asistida.

`[INFERENCIA]` Toda rotacion que dependa de variables de entorno del hosting exige
reconstruccion del artefacto y constituye una ventana de publicacion.

`[INFERENCIA]` Para una credencial que llegara a resolverse por el provider de Blobs, la
actualizacion del store no requeriria reconstruccion. Este efecto es potencial: depende de que
exista un mecanismo de escritura, hoy no demostrado en la base.

`[NO VERIFICABLE]` Para Clientify no esta documentada la superposicion de claves. Si al generar
una nueva la anterior quedara invalidada, no existiria rollback funcional; ese extremo debe
declararse antes de aprobar la rotacion.

`[EVIDENCIA-CODIGO]` Dieciocho de las veinte credenciales gobernadas confirmadas tienen al
menos una lectura directa de `process.env` en `src/`, sin checksum ni invalidacion de cache.
Las dos restantes no la tienen: solo existen como secretos de workflow.

`[EVIDENCIA-CODIGO]` Tener lectura directa y resolverse por la capa de credenciales no son
propiedades excluyentes. La Service Account de Google cumple ambas: su valor se resuelve por la
cadena de providers en `src/lib/drive/client.ts:66`, y ademas subsisten lecturas directas de
`process.env` en `src/lib/env.ts` y en el propio `src/lib/drive/client.ts` que alimentan el
indicador de configuracion. Por eso figura entre las dieciocho.

## 8. Estado de verificacion

`[NO VERIFICABLE]` Contenido del secret store de Netlify Environment Variables.

`[NO VERIFICABLE]` Contenido del store `secrets` de Netlify Blobs.

`[NO VERIFICABLE]` Cantidad exacta de modulos de Make con credencial embebida.

`[EVIDENCIA-HISTORICA]` El expediente CRED-CLF-001 documenta que la credencial del CRM estaba
repartida en cuatro sitios con nombres de variable distintos y fechas de actualizacion
divergentes.

`[INFERENCIA]` De esas divergencias se sigue que la convergencia entre copias es parcial. La
plataforma de automatizacion no interviene en esta conclusion.

`[NO VERIFICABLE]` Igualdad de valores entre los dos nombres de la credencial de Gemini.

`[NO VERIFICABLE]` Existencia de una dispensa de rotacion para credenciales de IA. No se
declara ninguna.

## 9. Precisiones que este ADR fija expresamente

`[EVIDENCIA-CODIGO]` El secreto compartido de los procesos programados posee dos stores
persistentes. El runtime desplegado es consumidor derivado y no constituye un tercer store.

`[PROPUESTA]` No se declara convergencia total entre el secret store del hosting y el de la
plataforma de automatizacion.

`[EVIDENCIA-CODIGO]` Una credencial logica puede tener mas de un nombre de configuracion. Dos
nombres con precedencia y fallback constituyen una credencial, no dos, mientras el codigo no
demuestre valores funcionalmente distintos.

`[PROPUESTA]` Un provider y un secret store no son credenciales y no se cuentan como tales.
