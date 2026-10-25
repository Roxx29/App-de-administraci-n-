/* global Capacitor, crearNucleo, normalizar, registrosDe, diferencias, aplicar, estadoInicial, anotarPendientes, quitarSubidos, fusionarRemotos, supabase, ExcelJS */
// window.api para Android: misma forma que preload.js en escritorio, pero sobre Capacitor.
// Datos en archivos cifrados (AES-GCM) dentro de la carpeta privada de la app; la clave y la sesión, en el Keystore.
(() => {
  const Filesystem = Capacitor.registerPlugin('Filesystem');
  const Share = Capacitor.registerPlugin('Share');
  const App = Capacitor.registerPlugin('App');
  const Nativo = Capacitor.registerPlugin('ApexNativo'); // plugin propio: almacén seguro e impresión (android/…/ApexNativoPlugin.java)
  const DATOS = 'DATA';

  // ---------- Cifrado de los archivos de datos ----------
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const desdeB64 = (txt) => Uint8Array.from(atob(txt), (c) => c.charCodeAt(0));
  let clave = null;
  async function obtenerClave() {
    if (clave) return clave;
    let cruda = (await Nativo.leer({ clave: 'datos' })).valor;
    if (!cruda) {
      cruda = b64(crypto.getRandomValues(new Uint8Array(32)));
      await Nativo.guardar({ clave: 'datos', valor: cruda });
    }
    clave = await crypto.subtle.importKey('raw', desdeB64(cruda), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return clave;
  }
  async function cifrar(texto) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const datos = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await obtenerClave(), new TextEncoder().encode(texto));
    return b64(iv) + '.' + b64(datos);
  }
  async function descifrar(txt) {
    const [iv, datos] = txt.split('.');
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: desdeB64(iv) }, await obtenerClave(), desdeB64(datos)));
  }

  // b64 de un buffer grande sin desbordar la pila.
  function b64Grande(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // ---------- Almacén de archivos (escrituras en cola para que nunca se pisen) ----------
  let cola = Promise.resolve();
  const almacen = {
    async leer(nombre) {
      try {
        const { data } = await Filesystem.readFile({ path: nombre, directory: DATOS, encoding: 'utf8' });
        return JSON.parse(await descifrar(data));
      } catch (e) {
        if (/not exist|no such file|does not exist/i.test(e.message || '')) return null;
        // Archivo dañado o clave perdida (p. ej. restaurado en otro teléfono): se aparta y se empieza de cero.
        await Filesystem.rename({ from: nombre, to: `${nombre}.danado-${Date.now()}`, directory: DATOS }).catch(() => {});
        return null;
      }
    },
    escribir(nombre, valor) {
      cola = cola.then(async () => {
        const tmp = nombre + '.tmp';
        await Filesystem.writeFile({ path: tmp, directory: DATOS, data: await cifrar(JSON.stringify(valor)), encoding: 'utf8' });
        if (nombre === 'datos.json') {
          await Filesystem.copy({ from: nombre, to: nombre + '.respaldo', directory: DATOS }).catch(() => {});
        }
        await Filesystem.rename({ from: tmp, to: nombre, directory: DATOS }); // escritura atómica
      });
      return cola;
    },
  };

  // Sesión de Supabase en el Keystore (nunca en localStorage).
  const almacenSesion = {
    getItem: async (k) => (await Nativo.leer({ clave: 'sesion:' + k })).valor ?? null,
    setItem: (k, v) => Nativo.guardar({ clave: 'sesion:' + k, valor: v }),
    removeItem: (k) => Nativo.borrar({ clave: 'sesion:' + k }),
  };

  // ---------- Avisos a la pantalla ----------
  const oyentes = { 'sync:estado': [], 'datos:remotos': [], 'cuenta:cambio': [] };
  const avisar = (canal, valor) => oyentes[canal].forEach((fn) => fn(valor));

  const S = { registrosDe, diferencias, aplicar, estadoInicial, anotarPendientes, quitarSubidos, fusionarRemotos };
  const listo = (async () => {
    let config = null;
    try {
      const c = await (await fetch('config.json')).json();
      if (c.supabaseUrl && c.supabaseAnonKey) config = c;
    } catch {
      /* sin config.json: solo local */
    }
    const nucleo = crearNucleo({ S, normalizar, almacen, almacenSesion, config, avisar, crearCliente: supabase.createClient });
    await nucleo.iniciar();
    // Android congela la app en segundo plano: al volver se sincroniza.
    App.addListener('appStateChange', ({ isActive }) => isActive && nucleo.alVolver());
    return nucleo;
  })();
  const conNucleo = (fn) => async (...args) => fn(await listo, ...args);

  async function exportarExcel({ nombre, hojas }) {
    const libro = new ExcelJS.Workbook();
    for (const { nombre: titulo, columnas, filas } of hojas) {
      const hoja = libro.addWorksheet(titulo.slice(0, 31));
      hoja.columns = columnas.map((c) => ({ header: c, key: c, width: Math.max(12, c.length + 4) }));
      hoja.getRow(1).font = { bold: true };
      filas.forEach((f) => hoja.addRow(f));
    }
    const archivo = `${nombre}.xlsx`;
    const { uri } = await Filesystem.writeFile({ path: archivo, directory: 'CACHE', data: b64Grande(await libro.xlsx.writeBuffer()) });
    await Share.share({ title: archivo, files: [uri] });
    return uri;
  }

  window.api = {
    leerDatos: conNucleo((n) => n.leer()),
    guardarDatos: conNucleo((n, args) => n.guardar(args)),
    exportarExcel,
    // Android abre su diálogo de impresión, que incluye "Guardar como PDF".
    facturaPdf: ({ nombre, html }) => Nativo.imprimir({ nombre, html }).then(() => nombre),
    cuenta: {
      estado: conNucleo((n) => n.cuenta.estado()),
      entrar: conNucleo((n, args) => n.cuenta.entrar(args)),
      registrar: conNucleo((n, args) => n.cuenta.registrar(args)),
      salir: conNucleo((n) => n.cuenta.salir()),
      pendientes: conNucleo((n) => n.cuenta.pendientes()),
    },
    equipo: {
      listar: conNucleo((n) => n.equipo.listar()),
      invitar: conNucleo((n, args) => n.equipo.invitar(args)),
      cancelar: conNucleo((n, email) => n.equipo.cancelar(email)),
      cambiar: conNucleo((n, args) => n.equipo.cambiar(args)),
      permisos: conNucleo((n, args) => n.equipo.permisos(args)),
    },
    sincronizarAhora: conNucleo((n) => n.sincronizar()),
    alCambiarSync: (fn) => oyentes['sync:estado'].push(fn),
    alLlegarDatos: (fn) => oyentes['datos:remotos'].push(fn),
    alCambiarCuenta: (fn) => oyentes['cuenta:cambio'].push(fn),
    movil: true,
  };
  document.documentElement.classList.add('movil');
})();
