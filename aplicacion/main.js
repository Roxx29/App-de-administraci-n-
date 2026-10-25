const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const { normalizar } = require('./src/logica.js');
const S = require('./sincronizacion.js');

// Los datos viven en datos.json (funciona sin internet) y se sincronizan con Supabase si hay sesión.
const ruta = (nombre) => path.join(app.getPath('userData'), nombre);

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

let actual; // datos vigentes
let estadoSync; // pendientes, versiones y cursor de la sincronización
// La pantalla guarda partiendo de una versión (rev); así sus cambios se aplican sobre lo último sin pisar lo bajado de la nube.
let rev = 0;
const versionesPantalla = new Map();

function entregar() {
  rev++;
  versionesPantalla.set(rev, actual);
  if (versionesPantalla.size > 20) versionesPantalla.delete(versionesPantalla.keys().next().value);
  return { rev, datos: actual };
}

function guardarDesdePantalla({ rev: base, datos }) {
  const cambios = S.diferencias(versionesPantalla.get(base) ?? actual, datos);
  actual = S.aplicar(actual, cambios);
  escribirJson('datos.json', actual);
  if (usuario) {
    estadoSync = S.anotarPendientes(estadoSync, cambios);
    escribirJson('sync.json', estadoSync);
    programarSync(1500);
  }
  return entregar();
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

// La sesión (tokens) se guarda cifrada con el almacén seguro del sistema.
const almacenSesion = {
  leer() {
    try {
      const b = fs.readFileSync(ruta('sesion.bin'));
      return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString());
    } catch {
      return {};
    }
  },
  escribir(m) {
    const txt = JSON.stringify(m);
    fs.writeFileSync(ruta('sesion.bin'), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(txt) : txt);
  },
  getItem(k) { return this.leer()[k] ?? null; },
  setItem(k, v) { this.escribir({ ...this.leer(), [k]: v }); },
  removeItem(k) { const m = this.leer(); delete m[k]; this.escribir(m); },
};

let cliente = null;
let usuario = null; // { id, email }
let sincronizando = false;
let temporizador = null;

const avisarPantalla = (canal, valor) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(canal, valor));
const contarPendientes = () => Object.keys(estadoSync.pendientes).length;

function programarSync(ms) {
  clearTimeout(temporizador);
  temporizador = setTimeout(sincronizar, ms);
}

async function bajarCambios() {
  for (;;) {
    const { data, error } = await cliente.from('registros').select('tipo,id,datos,borrado,actualizado,recibido')
      .eq('owner_id', usuario.id).gte('recibido', estadoSync.cursor || '1970-01-01T00:00:00Z').order('recibido').limit(1000);
    if (error) throw error;
    const r = S.fusionarRemotos(actual, estadoSync, data);
    estadoSync = r.estado;
    if (r.hubo) {
      actual = r.datos;
      escribirJson('datos.json', actual);
      avisarPantalla('datos:remotos', entregar());
    }
    if (data.length < 1000) return;
  }
}

async function sincronizar() {
  if (!cliente || !usuario || sincronizando) return;
  sincronizando = true;
  avisarPantalla('sync:estado', { estado: 'sincronizando', pendientes: contarPendientes() });
  try {
    const subir = Object.values(estadoSync.pendientes);
    for (let i = 0; i < subir.length; i += 200) {
      const lote = subir.slice(i, i + 200);
      const filas = lote.map((p) => ({ owner_id: usuario.id, tipo: p.tipo, id: p.id, datos: p.datos, borrado: p.borrado, actualizado: p.actualizado }));
      const { error } = await cliente.from('registros').upsert(filas, { onConflict: 'owner_id,tipo,id' });
      if (error) throw error;
      estadoSync = S.quitarSubidos(estadoSync, lote);
    }
    await bajarCambios();
    // Primera vez en esta cuenta: lo que solo existe en este equipo se sube (lo de la nube ya se bajó y manda).
    if (!estadoSync.vinculado) {
      const locales = [...S.registrosDe(actual).entries()].filter(([k]) => !estadoSync.versiones[k]).map(([, r]) => r);
      estadoSync = { ...S.anotarPendientes(estadoSync, locales), vinculado: true };
      if (locales.length) programarSync(0);
    }
    escribirJson('sync.json', estadoSync);
    avisarPantalla('sync:estado', { estado: 'ok', hora: new Date().toISOString(), pendientes: contarPendientes() });
  } catch (e) {
    escribirJson('sync.json', estadoSync);
    const sinRed = /fetch failed|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(String(e.message || e));
    avisarPantalla('sync:estado', { estado: sinRed ? 'sin-conexion' : 'error', mensaje: String(e.message || e), pendientes: contarPendientes() });
  } finally {
    sincronizando = false;
  }
}

// Al entrar con otra cuenta, los datos de la anterior se apartan para no mezclarlos ni subirlos a la cuenta nueva.
function activarUsuario(u) {
  usuario = { id: u.id, email: u.email };
  if (estadoSync.usuario && estadoSync.usuario !== u.id) {
    fs.copyFileSync(ruta('datos.json'), ruta(`datos-${estadoSync.usuario}.json`));
    actual = normalizar(null);
    escribirJson('datos.json', actual);
    estadoSync = S.estadoInicial();
    avisarPantalla('datos:remotos', entregar());
  }
  estadoSync.usuario = u.id;
  escribirJson('sync.json', estadoSync);
  programarSync(0);
}

const MENSAJES_ACCESO = [
  [/invalid login credentials/i, 'Correo o contraseña incorrectos.'],
  [/email not confirmed/i, 'Confirma tu correo con el enlace que te enviamos y vuelve a entrar.'],
  [/already registered|already exists/i, 'Ya existe una cuenta con ese correo.'],
  [/password should be at least|weak password/i, 'La contraseña debe tener al menos 6 caracteres.'],
  [/invalid email|unable to validate email/i, 'Correo no válido.'],
  [/fetch failed|network/i, 'No hay conexión con el servidor.'],
];
const mensajeAcceso = (e) => (MENSAJES_ACCESO.find(([re]) => re.test(e.message)) || [null, e.message])[1];

const cuenta = {
  estado: () => ({ configurado: !!config, email: usuario?.email ?? null }),
  async entrar(_e, { email, clave }) {
    const { data, error } = await cliente.auth.signInWithPassword({ email, password: clave });
    if (error) return { error: mensajeAcceso(error) };
    activarUsuario(data.user);
    return { email: data.user.email };
  },
  async registrar(_e, { email, clave }) {
    const { data, error } = await cliente.auth.signUp({ email, password: clave });
    if (error) return { error: mensajeAcceso(error) };
    if (!data.session) return { confirmar: true };
    activarUsuario(data.user);
    return { email: data.user.email };
  },
  async salir() {
    await cliente.auth.signOut({ scope: 'local' });
    usuario = null;
    return true;
  },
  pendientes: () => contarPendientes(),
};

async function iniciarSupabase() {
  if (!config) return;
  cliente = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { storage: almacenSesion, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  // Con sesión guardada se entra sin internet; los tokens se renuevan cuando vuelva la conexión.
  const { data } = await cliente.auth.getSession();
  if (data.session?.user) activarUsuario(data.session.user);
  setInterval(() => programarSync(0), 30000);
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
  win.on('focus', () => programarSync(500));
}

ipcMain.handle('datos:leer', () => entregar());
ipcMain.handle('datos:guardar', (_e, args) => guardarDesdePantalla(args));
ipcMain.handle('cuenta:estado', cuenta.estado);
ipcMain.handle('cuenta:entrar', cuenta.entrar);
ipcMain.handle('cuenta:registrar', cuenta.registrar);
ipcMain.handle('cuenta:salir', cuenta.salir);
ipcMain.handle('cuenta:pendientes', cuenta.pendientes);
ipcMain.handle('sync:ahora', () => sincronizar());
ipcMain.handle('excel:exportar', (e, args) => exportarExcel(BrowserWindow.fromWebContents(e.sender), args));
ipcMain.handle('factura:pdf', (e, args) => facturaPdf(BrowserWindow.fromWebContents(e.sender), args));

app.whenReady().then(async () => {
  actual = normalizar(leerJson('datos.json'));
  estadoSync = { ...S.estadoInicial(), ...leerJson('sync.json') };
  await iniciarSupabase();
  crearVentana();
});
app.on('window-all-closed', () => app.quit());
