const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const { normalizar } = require('./src/logica.js');
const S = require('./sincronizacion.js');
const { crearNucleo } = require('./nucleo.js');

// Los datos viven en datos.json (funciona sin internet) y se sincronizan con Supabase si hay sesión.
const ruta = (nombre) => path.join(app.getPath('userData'), nombre);

// La app se llamaba ApexLedger: si es la primera vez como Guarmo, se traen los datos y la sesión de la carpeta anterior.
const carpetaAnterior = path.join(app.getPath('appData'), 'ApexLedger');
if (!fs.existsSync(ruta('datos.json')) && fs.existsSync(path.join(carpetaAnterior, 'datos.json'))) {
  fs.cpSync(carpetaAnterior, app.getPath('userData'), { recursive: true });
}

function leerJson(nombre) {
  try {
    return JSON.parse(fs.readFileSync(ruta(nombre), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    // Archivo dañado: se guarda una copia para no perderlo y se empieza de cero.
    fs.copyFileSync(ruta(nombre), ruta(nombre) + `.danado-${Date.now()}`);
    return null;
  }
}

function escribirJson(nombre, valor) {
  const tmp = ruta(nombre) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(valor, null, 2));
  if (nombre === 'datos.json' && fs.existsSync(ruta(nombre))) fs.copyFileSync(ruta(nombre), ruta(nombre) + '.respaldo');
  fs.renameSync(tmp, ruta(nombre)); // escritura atómica: nunca queda el archivo a medias
}

// ---------- Supabase ----------
const config = (() => {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    return c.supabaseUrl && c.supabaseAnonKey ? c : null;
  } catch {
    return null;
  }
})();

// La sesión (tokens) se guarda cifrada con el almacén seguro del sistema. Si el sistema no lo ofrece
// (p. ej. Linux sin llavero) no se guarda en disco: queda en memoria y hay que entrar en cada arranque.
const sesionEnMemoria = {};
const almacenSesion = {
  leer() {
    if (!safeStorage.isEncryptionAvailable()) return sesionEnMemoria;
    try {
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(ruta('sesion.bin'))));
    } catch {
      return {};
    }
  },
  escribir(m) {
    if (!safeStorage.isEncryptionAvailable()) return Object.assign(sesionEnMemoria, m);
    fs.writeFileSync(ruta('sesion.bin'), safeStorage.encryptString(JSON.stringify(m)));
  },
  getItem(k) { return this.leer()[k] ?? null; },
  setItem(k, v) { this.escribir({ ...this.leer(), [k]: v }); },
  removeItem(k) { const m = { ...this.leer() }; delete m[k]; delete sesionEnMemoria[k]; this.escribir(m); },
};

const nucleo = crearNucleo({
  S, normalizar, config, almacenSesion, crearCliente: createClient,
  almacen: { leer: leerJson, escribir: escribirJson },
  avisar: (canal, valor) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(canal, valor)),
});

async function exportarExcel(win, { nombre, hojas }) {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `${nombre}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (canceled) return null;
  const libro = new ExcelJS.Workbook();
  for (const { nombre: titulo, columnas, filas } of hojas) {
    const hoja = libro.addWorksheet(titulo.slice(0, 31));
    hoja.columns = columnas.map((c) => ({ header: c, key: c, width: Math.max(12, c.length + 4) }));
    hoja.getRow(1).font = { bold: true };
    filas.forEach((f) => hoja.addRow(f));
  }
  await libro.xlsx.writeFile(filePath);
  return filePath;
}

async function facturaPdf(win, { nombre, html }) {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: `${nombre}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled) return null;
  const oculto = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  await oculto.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  fs.writeFileSync(filePath, await oculto.webContents.printToPDF({ pageSize: 'A4', printBackground: true }));
  oculto.destroy();
  shell.openPath(filePath);
  return filePath;
}

function crearVentana() {
  const win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0b1220',
    title: 'Guarmo',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  // Enlaces externos se abren en el navegador, nunca dentro de la app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('focus', nucleo.alVolver);
}

ipcMain.handle('datos:leer', () => nucleo.leer());
ipcMain.handle('datos:guardar', (_e, args) => nucleo.guardar(args));
ipcMain.handle('cuenta:estado', () => nucleo.cuenta.estado());
ipcMain.handle('cuenta:entrar', (_e, args) => nucleo.cuenta.entrar(args));
ipcMain.handle('cuenta:registrar', (_e, args) => nucleo.cuenta.registrar(args));
ipcMain.handle('cuenta:salir', () => nucleo.cuenta.salir());
ipcMain.handle('cuenta:pendientes', () => nucleo.cuenta.pendientes());
ipcMain.handle('cuenta:pedirCodigo', (_e, args) => nucleo.cuenta.pedirCodigo(args));
ipcMain.handle('cuenta:restablecer', (_e, args) => nucleo.cuenta.restablecer(args));
ipcMain.handle('cuenta:cancelarRestablecer', () => nucleo.cuenta.cancelarRestablecer());
ipcMain.handle('sync:ahora', () => nucleo.sincronizar());
ipcMain.handle('equipo:listar', () => nucleo.equipo.listar());
ipcMain.handle('equipo:invitar', (_e, args) => nucleo.equipo.invitar(args));
ipcMain.handle('equipo:cancelar', (_e, email) => nucleo.equipo.cancelar(email));
ipcMain.handle('equipo:cambiar', (_e, args) => nucleo.equipo.cambiar(args));
ipcMain.handle('equipo:permisos', (_e, args) => nucleo.equipo.permisos(args));
ipcMain.handle('excel:exportar', (e, args) => exportarExcel(BrowserWindow.fromWebContents(e.sender), args));
ipcMain.handle('factura:pdf', (e, args) => facturaPdf(BrowserWindow.fromWebContents(e.sender), args));

app.whenReady().then(async () => {
  await nucleo.iniciar();
  crearVentana();
});
app.on('window-all-closed', () => app.quit());
