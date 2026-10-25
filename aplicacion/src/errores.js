// Si algo falla al arrancar, se muestra el error en pantalla en vez de dejarla en blanco (sobre todo en el teléfono, sin consola).
(() => {
  const mostrar = (texto) => {
    let caja = document.getElementById('error-arranque');
    if (!caja) {
      caja = document.createElement('pre');
      caja.id = 'error-arranque';
      caja.setAttribute('role', 'alert');
      caja.style.cssText = 'position:fixed;inset:auto 8px 8px 8px;z-index:99;max-height:45vh;overflow:auto;white-space:pre-wrap;'
        + 'background:#2a0f17;color:#fecdd3;border:1px solid #f43f5e;border-radius:8px;padding:10px;font:12px monospace;user-select:text';
      document.body.appendChild(caja);
    }
    caja.textContent += texto + '\n';
  };
  const datos = () => `\n[${navigator.userAgent}]`;
  window.addEventListener('error', (e) => mostrar(`Error: ${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})${datos()}`));
  // Colgada sin error (p. ej. un plugin nativo que no responde): tampoco se queda en blanco.
  setTimeout(() => {
    const vista = document.getElementById('vista');
    const acceso = document.getElementById('acceso');
    if (vista && !vista.children.length && acceso && acceso.hidden) mostrar(`La app no terminó de cargar en 15 s.${datos()}`);
  }, 15000);
  window.addEventListener('unhandledrejection', (e) => mostrar(`Error: ${e.reason?.message || e.reason}${datos()}`));
})();
