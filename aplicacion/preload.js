const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  leerDatos: () => ipcRenderer.invoke('datos:leer'),
  guardarDatos: (args) => ipcRenderer.invoke('datos:guardar', args),
  exportarExcel: (args) => ipcRenderer.invoke('excel:exportar', args),
  facturaPdf: (args) => ipcRenderer.invoke('factura:pdf', args),
  cuenta: {
    estado: () => ipcRenderer.invoke('cuenta:estado'),
    entrar: (args) => ipcRenderer.invoke('cuenta:entrar', args),
    registrar: (args) => ipcRenderer.invoke('cuenta:registrar', args),
    salir: () => ipcRenderer.invoke('cuenta:salir'),
    pendientes: () => ipcRenderer.invoke('cuenta:pendientes'),
  },
  equipo: {
    listar: () => ipcRenderer.invoke('equipo:listar'),
    invitar: (args) => ipcRenderer.invoke('equipo:invitar', args),
    cancelar: (email) => ipcRenderer.invoke('equipo:cancelar', email),
    cambiar: (args) => ipcRenderer.invoke('equipo:cambiar', args),
  },
  alCambiarCuenta: (fn) => ipcRenderer.on('cuenta:cambio', (_e, v) => fn(v)),
  sincronizarAhora: () => ipcRenderer.invoke('sync:ahora'),
  alCambiarSync: (fn) => ipcRenderer.on('sync:estado', (_e, v) => fn(v)),
  alLlegarDatos: (fn) => ipcRenderer.on('datos:remotos', (_e, v) => fn(v)),
});
