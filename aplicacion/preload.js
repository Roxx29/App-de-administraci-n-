const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  leerDatos: () => ipcRenderer.invoke('datos:leer'),
  guardarDatos: (datos) => ipcRenderer.invoke('datos:guardar', datos),
  exportarExcel: (args) => ipcRenderer.invoke('excel:exportar', args),
  facturaPdf: (args) => ipcRenderer.invoke('factura:pdf', args),
});
