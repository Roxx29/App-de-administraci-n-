const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

// shortcut: datos en un JSON local, cambiar por la base de datos cuando se elija.
const archivoDatos = () => path.join(app.getPath('userData'), 'datos.json');

function leerDatos() {
  try {
    return JSON.parse(fs.readFileSync(archivoDatos(), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    // Archivo dañado: se guarda una copia para no perderlo y se empieza de cero.
    fs.copyFileSync(archivoDatos(), archivoDatos() + `.danado-${Date.now()}`);
    return null;
  }
}

function guardarDatos(datos) {
  const tmp = archivoDatos() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(datos, null, 2));
  if (fs.existsSync(archivoDatos())) fs.copyFileSync(archivoDatos(), archivoDatos() + '.respaldo');
  fs.renameSync(tmp, archivoDatos()); // escritura atómica: nunca queda el archivo a medias
  return true;
}

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
    title: 'ApexLedger',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  // Enlaces externos se abren en el navegador, nunca dentro de la app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

ipcMain.handle('datos:leer', () => leerDatos());
ipcMain.handle('datos:guardar', (_e, datos) => guardarDatos(datos));
ipcMain.handle('excel:exportar', (e, args) => exportarExcel(BrowserWindow.fromWebContents(e.sender), args));
ipcMain.handle('factura:pdf', (e, args) => facturaPdf(BrowserWindow.fromWebContents(e.sender), args));

app.whenReady().then(crearVentana);
app.on('window-all-closed', () => app.quit());
