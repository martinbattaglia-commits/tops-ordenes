# PROTOCOLO CANÓNICO DE DEPLOY CON BUILDS BLOQUEADOS (MCP / HUMAN-IN-THE-LOOP)

1. **INVARIANTE DE GOBIERNO**:
   - El archivo Bootstrap y sus reglas se mantienen 100% intactos.
   - Respetar que los builds automáticos y la publicación en Netlify están BLOQUEADOS por política de seguridad.

2. **FASE DRAFT DEPLOY (PREVIEW VÍA MCP/CLI)**:
   - Con los cambios verificados y el PR mergeado en `main`, interactuar con Netlify vía Netlify CLI o Netlify MCP.
   - Disparar y generar un Draft Deploy (Preview) de forma aislada sin desbloquear producción abierta.
   - Verificar que el build del draft termine con éxito y obtener la URL de preview.

3. **CHECKPOINT HUMAN-IN-THE-LOOP (AUTORIZACIÓN)**:
   - Detener el proceso y solicitar autorización explícita a Dirección en el chat:
     > *"Draft deploy generado y validado con éxito. ¿Autorizás la activación y publicación a producción viva en Netlify?"*

4. **PUBLICACIÓN Y CIERRE (MCP/CLI)**:
   - Tras recibir la aprobación de Dirección (*"Sí"*, *"Autorizado"*, *"Procedé"*), ejecutar la publicación del deploy a producción viva (`netlify deploy --prod` o publish del build verificado vía API/MCP).
   - Asegurar que las políticas de bloqueo y gobierno queden restablecidas según el invariante.
   - Confirmar el estado final `'Published'` y realizar la verificación de respuesta HTTP 200 OK sobre el dominio productivo.
