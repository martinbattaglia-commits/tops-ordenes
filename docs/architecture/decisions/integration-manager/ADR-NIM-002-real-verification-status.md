# ADR-NIM-002 — Estado operativo basado en verificacion real

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

`[PROPUESTA]` Este ADR esta subordinado al canon y no puede contradecir ADR canonicos vigentes.

## 1. Naturaleza de esta aceptacion

`[PROPUESTA]` El principio arquitectonico esta aprobado por Direccion.

`[PROPUESTA]` La implementacion tecnica NO esta autorizada.

`[PROPUESTA]` Este ADR no autoriza modificar la lectura de variables de entorno, el motor de
estado del Cockpit ni la interfaz. Establece el principio que regira las fases posteriores de
health checks y de integracion con el Cockpit.

## 2. Contexto

`[EVIDENCIA-CODIGO]` `src/lib/env.ts` expone diez indicadores con la forma
`configured: Boolean(...)`, en las lineas 42, 79, 143, 159, 218, 227, 243, 298, 315 y 326.

`[EVIDENCIA-CODIGO]` La pantalla de configuracion renderiza esos indicadores como estado de
conexion.

`[EVIDENCIA-CODIGO]` `src/lib/ejecutivo/command-center.ts` deriva de ellos el estado de la
mayoria de sus sistemas; solo uno verifica contra la API del proveedor.

`[EVIDENCIA-HISTORICA]` Durante el expediente CRED-CLF-001, preservado en el paquete como
`13-CRED-CLF-001-SANITIZED.md`, la pantalla de configuracion informo estado favorable mientras
el proveedor devolvia 401, porque el indicador solo comprueba la presencia de la variable.

`[EVIDENCIA-CODIGO]` El health check de mensajeria en `src/lib/whatsapp/meta.ts` consulta un
endpoint cuyos campos no incluyen la expiracion del token y devuelve el campo de expiracion
fijo en nulo.

`[INFERENCIA]` En consecuencia ese health check no puede detectar una credencial vencida y aun
asi devuelve resultado favorable.

`[EVIDENCIA-CODIGO]` `src/lib/env.ts:243` y `:298` incorporan al indicador `configured` de
Drive un identificador —`GOOGLE_SA_EMAIL`— ademas de la credencial.

`[INFERENCIA]` La presencia de un identificador puede asi habilitar un estado de configuracion
sin que exista credencial utilizable, lo que refuerza la necesidad de este ADR.

## 3. Decision

`[PROPUESTA]` Las seis reglas siguientes constituyen la decision adoptada:
1. `Boolean(env.X)` significa exclusivamente **CONFIGURADO**. Queda prohibido renderizarlo como
   conectado, operativo, saludable o validado.

`[PROPUESTA]` 2. El estado **operativo** requiere autenticacion real exitosa cuya antiguedad sea menor al
   umbral definido para la integracion.

`[PROPUESTA]` 3. Se separan cinco capas de salud. Ninguna implica la siguiente:

       credential       la credencial autentica
       provider         el proveedor responde
       consumer         cada consumidor la utiliza correctamente
       synchronization  los datos estan al dia
       business         el proceso de negocio funciona

`[PROPUESTA]` 4. Ante imposibilidad de verificar, el resultado es **NO VERIFICABLE**.
   **NO VERIFICABLE nunca se degrada a operativo.**

`[PROPUESTA]` 5. La lectura centralizada expondra `configured` y `healthy` como campos distintos.

`[PROPUESTA]` 6. Se admite el estado intermedio visible **CONFIGURADO · NO VALIDADO** hasta ejecutar el
   primer health check real.

`[PROPUESTA]` El estado intermedio de la regla 6 no constituye regresion. Esta ADR lo declara
como parte de su decision, y su autoridad es la que consta en el encabezado.

## 4. Umbrales de antiguedad por criticidad

`[PROPUESTA]` Valores adoptados:

    N3 sistemica ....... 5 minutos
    N2 critica ......... 15 minutos
    N1 importante ...... 1 hora
    N0 informativa ..... 24 horas

`[PROPUESTA]` Superado el umbral sin verificacion exitosa, el estado degrada a
CONFIGURADO · NO VALIDADO. Nunca permanece en operativo por inercia.

## 5. Vocabulario obligatorio de estado

Definiciones nominales:

    NO CONFIGURADA
    IMPLEMENTACION PRESENTE
    CONFIGURACION NO VERIFICADA
    ULTIMA EJECUCION EXITOSA <fecha>
    HEALTH CHECK EXITOSO <fecha>
    OPERATIVA
    NO VERIFICADA

`[PROPUESTA]` La existencia de un workflow, una variable de entorno, una ruta, un provider o
una configuracion no habilita el vocabulario «operativa».

## 6. Fundamento

`[PROPUESTA]` Este ADR se apoya en la regla del Marco de Gobierno Tecnico sobre validaciones
que dan resultado favorable por ausencia del objeto evaluado, en los criterios del Guardian
previo al commit —comprobar existencia antes que condicion, y vocabulario cerrado de
veredictos— y en el principio de validacion real del expediente.

## 7. Precedente aplicable ya existente en el producto

`[EVIDENCIA-CODIGO]` `src/lib/cron-auth.ts` sustituye el guard fail-open `if (secret) { ... }`
por un guard fail-closed que responde 503 ante misconfiguracion visible y 401 ante credencial
invalida, con comparacion en tiempo constante.

`[EVIDENCIA-CODIGO]` Cinco de los ocho validadores de cron ya lo adoptaron.

`[INFERENCIA]` Ese cambio resuelve, en el plano de la autorizacion, el mismo defecto que este
ADR resuelve en el plano del estado: la ausencia de comprobacion no debe producir un resultado
favorable.

## 8. Restricciones de implementacion

`[PROPUESTA]` La implementacion posterior debera preservar la jerarquia visual actual del
Cockpit, la lectura ejecutiva, el impacto de negocio en primer plano y el detalle tecnico en
segundo plano.

`[PROPUESTA]` Rige el principio canonico de evolucion antes que rediseno.

## 9. Consecuencias

### 9.1 Positivas

`[INFERENCIA]` El Cockpit deja de informar estados no verificados.

`[INFERENCIA]` El primer error de autenticacion se vuelve accionable.

`[INFERENCIA]` Se elimina la clase de defecto «resultado favorable por ausencia».

### 9.2 Aceptadas

`[INFERENCIA]` Al implementarse, sistemas hoy mostrados como operativos pasaran a
CONFIGURADO · NO VALIDADO hasta el primer health check.
