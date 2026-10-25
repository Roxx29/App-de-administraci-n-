# 001 · Stack de la aplicación de escritorio

**Decisión:** Electron + HTML/CSS/JS sin framework. Lógica de negocio pura en `aplicacion/src/logica.js`.

**Por qué:** genera `.exe` para Windows desde cualquier sistema, se prueba fácil, y la misma interfaz web se puede llevar a móvil con Capacitor.

**Pendiente:** base de datos (por ahora un `datos.json` local con escritura atómica y respaldo). Cuando se elija, solo cambian `leerDatos`/`guardarDatos` en `main.js`.

**Diseño:** colores y fuentes de las referencias “Precision Ledger”: azul marino de fondo, naranja primario `#d97706`, verde `#059669`, azul `#0ea5e9`; Hanken Grotesk (texto) y JetBrains Mono (etiquetas y cifras).
