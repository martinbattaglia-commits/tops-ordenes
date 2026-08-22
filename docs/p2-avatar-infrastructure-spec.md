# Especificación de Infraestructura y Almacenamiento de Avatares (P2)

**Estado:** `PENDIENTE DE DIRECCIÓN — AUTORIZACIÓN DE MIGRACIÓN/INFRAESTRUCTURA`  
**Expediente:** `HOTFIX-LINK-V2` / `NEXUS-LINK-MAX-RECOVERY`

---

## 1. Diseño Canónico de Almacenamiento

1. **Bucket de Almacenamiento:**
   - Bucket: `connect-files` (existente) o `avatars` (dedicado).
   - Estructura de clave: `avatars/{user_id}/avatar_{hash}.{ext}`
   - Tamaño máximo por archivo: 2 MB.
   - Formatos permitidos (sniffed): `image/jpeg`, `image/png`, `image/webp`.

2. **Políticas de Seguridad y Privacidad:**
   - Carga: `auth.uid() = user_id` mediante URL firmada de subida (`uploadToSignedUrl`).
   - Lectura: URL pública optimizada por CDN o URL firmada temporal de descarga.
   - Restricción de base de datos: `profiles.avatar_url` almacena únicamente la URL canónica HTTPS (longitud máxima 2048 caracteres). Prohibición estricta de `data:` URLs en columnas SQL.

3. **Migración de Base de Datos para `profiles_public`:**
   ```sql
   -- Extensión de la vista profiles_public respetando el lockdown de PII (0040)
   create or replace view public.profiles_public as
     select id, full_name, avatar_url
       from public.profiles
      where coalesce(active, true) is true;

   revoke all on public.profiles_public from public, anon;
   grant select on public.profiles_public to authenticated, service_role;

   notify pgrst, 'reload schema';
   ```

4. **Rollback Correspondiente:**
   ```sql
   create or replace view public.profiles_public as
     select id, full_name
       from public.profiles
      where coalesce(active, true) is true;

   revoke all on public.profiles_public from public, anon;
   grant select on public.profiles_public to authenticated, service_role;

   notify pgrst, 'reload schema';
   ```
