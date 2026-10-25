# ApexLedger (aplicación)

App de escritorio para pymes: productos, inventario, punto de venta, facturas PDF y exportación a Excel.
Hecha con Electron + HTML/JS; la lógica de negocio está en `src/logica.js` para reutilizarla en móvil.

- `npm install` → instalar
- `npm start` → abrir la app
- `npm test` → pruebas
- `npm run build:win` → genera `dist/ApexLedger-<versión>.exe` (portable, no necesita instalación). Desde Linux: `npm run build:win:linux` (sin ícono en el .exe; el de GitHub Actions sí lo lleva)

Los datos se guardan en `datos.json` dentro de la carpeta de usuario de la app (con respaldo automático) hasta que se elija base de datos.
