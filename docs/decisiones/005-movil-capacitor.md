# 005 · App para teléfono (Android) con Capacitor

Revisado por los agentes `arquitecto`, `diseno` y `seguridad`.

**Decisión:** Capacitor 8 envuelve la misma interfaz de `aplicacion/src/`. El motor de datos y sincronización está en `aplicacion/nucleo.js` y lo comparten escritorio y móvil, cada uno con sus adaptadores:
- escritorio: `main.js` y `preload.js`;
- móvil: `movil/plataforma-movil.js`, que implementa el mismo `window.api`.

Sin bundler: `movil/preparar-www.js` copia la interfaz y las versiones navegador de supabase-js y exceljs a `www/`.

**Android (`aplicacion/movil/android`):**
- Datos en la carpeta privada de la app, cifrados con AES-GCM. La clave vive en el Android Keystore.
- La sesión de Supabase va en el Keystore, nunca en localStorage.
- Plugin propio `ApexNativo` (Java): almacén seguro e impresión con el diálogo de Android ("Guardar como PDF").
- Sin copias de seguridad ni transferencia a otro teléfono (`allowBackup=false` y reglas de extracción).
- Sin capturas de pantalla (FLAG_SECURE) y sin depuración del WebView.
- La CSP solo deja conectar con el proyecto de Supabase de `config.json`.
- Al volver a la app se sincroniza, porque Android congela la app en segundo plano.

**Diseño (≤720px):**
- Barra inferior con Resumen, Inventario, Vender, Ventas y "Más".
- Las tablas pasan a tarjetas.
- El ticket es una hoja inferior, con el total y Cobrar siempre visibles.
- Los formularios ocupan la pantalla completa, con zonas táctiles de 44–48px.

**Compilación:** GitHub Actions (`.github/workflows/android.yml`) genera el APK de depuración. iOS necesita un Mac y queda para después.

**Pendiente:**
- APK firmado de release, con el keystore en los secretos de GitHub y una copia guardada fuera.
- Bloqueo con huella o PIN al abrir la app.
- Al cerrar sesión no se borran los datos de ese teléfono: se conservan por cuenta, igual que en escritorio.
- El enlace de confirmación de correo abre la web, no la app: se confirma en el navegador y luego se entra en la app.
