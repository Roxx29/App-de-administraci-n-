# Guarmo (aplicación)

App de escritorio para pymes: productos, inventario, punto de venta, facturas PDF y exportación a Excel.
Hecha con Electron + HTML/JS; la lógica de negocio está en `src/logica.js` para reutilizarla en móvil.

- `npm install` → instalar
- `npm start` → abrir la app
- `npm test` → pruebas
- `npm run build:win` → genera `dist/Guarmo-<versión>.exe` (portable, no necesita instalación). Desde Linux: `npm run build:win:linux` (sin ícono en el .exe; el de GitHub Actions sí lo lleva)

Los datos se guardan en `datos.json` dentro de la carpeta de usuario de la app (con respaldo automático) hasta que se elija base de datos.

## Supabase (nube)

La app guarda todo en local y, si hay `config.json`, pide iniciar sesión y sincroniza con Supabase.

1. En Supabase → **SQL Editor**, ejecuta en orden `supabase/migrations/001_registros.sql`, `002_equipo.sql` y `003_permisos_anulaciones.sql` (tablas, equipo con roles y seguridad RLS). Activa **Confirm email** en Authentication.
2. Copia `config.example.json` a `config.json` con la **Project URL** y la clave **anon / publishable** (Settings → API). Nunca la `service_role`.
3. Sin `config.json` la app funciona solo en local, como antes.

## Equipo

En Ajustes → Equipo el admin invita por correo (rol admin o trabajador), cambia roles, da permisos concretos a cada persona o la quita. La persona invitada crea su cuenta con ese correo, lo confirma y, al entrar, se une a la empresa.
Pruebas de seguridad: `PGHOST=… sh supabase/pruebas/ejecutar.sh` sobre un Postgres vacío.

## Teléfono (Android)

`aplicacion/movil/` contiene la misma interfaz empaquetada con Capacitor (ver `docs/decisiones/005-movil-capacitor.md`).
- `cd aplicacion/movil && npm install && npm run sync` prepara `www/` y el proyecto Android.
- El APK lo compila GitHub Actions (workflow "APK Android"). En local hace falta el SDK de Android y JDK 21: `cd android && ./gradlew assembleDebug`.

## Restablecer contraseña

"¿Olvidaste tu contraseña?" en la pantalla de acceso envía un **código** por correo (sin enlaces: las apps no abren enlaces de correo). Configuración necesaria en Supabase:
1. Authentication → Emails → plantilla **Reset Password**: incluir `{{ .Token }}` y quitar `{{ .ConfirmationURL }}`. Por ejemplo: `<p>Tu código para restablecer la contraseña de Guarmo es: <b>{{ .Token }}</b></p>`.
2. Authentication → Providers → Email: caducidad del código (OTP) de 15 minutos.
3. Authentication → Passwords: longitud mínima 8.
4. El correo integrado de Supabase envía pocos correos por hora; para uso real, configurar un SMTP propio (Authentication → SMTP).
