// Motor común de datos y sincronización: lo usan el escritorio (main.js) y el móvil (src/plataforma-movil.js).
// No conoce Electron ni Capacitor: recibe por parámetros cómo guardar archivos, cómo crear el cliente de Supabase y cómo avisar a la pantalla.
//   almacen: { leer(nombre) -> objeto|null, escribir(nombre, valor) }   (pueden ser async)
//   almacenSesion: almacén seguro para los tokens de Supabase (getItem/setItem/removeItem)
//   avisar(canal, valor): 'datos:remotos' | 'sync:estado' | 'cuenta:cambio'
function crearNucleo({ S, normalizar, almacen, almacenSesion, crearCliente, config, avisar, programar = setTimeout, cancelar = clearTimeout }) {
  let actual; // datos vigentes
  let estadoSync; // pendientes, versiones y cursor de la sincronización
  // La pantalla guarda partiendo de una versión (rev); así sus cambios se aplican sobre lo último sin pisar lo bajado de la nube.
  let rev = 0;
  const versionesPantalla = new Map();
  let cliente = null;
  let usuario = null; // { id, email }
  let sincronizando = false;
  let temporizador = null;
  let recuperando = false; // código ya verificado, falta guardar la contraseña nueva

  const escribir = (nombre, valor) => almacen.escribir(nombre, valor);
  const contarPendientes = () => Object.keys(estadoSync.pendientes).length;
  const miembro = () => estadoSync.miembro || { empresa: usuario?.id, rol: 'admin', serie: '', permisos: [] };
  const esAdmin = () => miembro().rol === 'admin';
  const puede = (permiso) => esAdmin() || (miembro().permisos || []).includes(permiso);

  function entregar() {
    rev++;
    versionesPantalla.set(rev, actual);
    if (versionesPantalla.size > 20) versionesPantalla.delete(versionesPantalla.keys().next().value);
    return { rev, datos: actual };
  }

  function programarSync(ms) {
    cancelar(temporizador);
    temporizador = programar(sincronizar, ms);
  }

  async function guardar({ rev: base, datos }) {
    const cambios = S.diferencias(versionesPantalla.get(base) ?? actual, datos);
    actual = S.aplicar(actual, cambios);
    await escribir('datos.json', actual);
    if (usuario) {
      estadoSync = S.anotarPendientes(estadoSync, cambios);
      await escribir('sync.json', estadoSync);
      programarSync(1500);
    }
    return entregar();
  }

  // Empresa, rol y serie de esta persona. Si cambian (la invitaron, la quitaron o le cambiaron el rol) se ajustan los datos locales.
  async function actualizarMiembro() {
    const { data, error } = await cliente.rpc('entrar_empresa');
    // Sin la migración 002 aplicada, cada cuenta sigue siendo su propia empresa.
    if (error?.code === 'PGRST202') return;
    if (error) throw error;
    const nuevo = { empresa: data[0].empresa_id, rol: data[0].rol, serie: data[0].serie, permisos: data[0].permisos || [] };
    const antes = estadoSync.miembro;
    if (antes && antes.empresa !== nuevo.empresa) {
      // Otra empresa: lo local de la anterior no se mezcla ni se sube aquí.
      actual = normalizar(null);
      estadoSync = { ...S.estadoInicial(), usuario: usuario.id };
      await escribir('datos.json', actual);
      avisar('datos:remotos', entregar());
    } else if (antes && (antes.rol !== nuevo.rol || JSON.stringify(antes.permisos) !== JSON.stringify(nuevo.permisos))) {
      // Cambiaron rol o permisos: se vuelve a bajar todo con los permisos nuevos; sin permiso de gastos, se borran de este equipo.
      estadoSync = { ...estadoSync, cursor: null, versiones: {}, miembro: nuevo };
      if (!puede('gastos')) {
        actual = { ...actual, gastos: [] };
        await escribir('datos.json', actual);
        avisar('datos:remotos', entregar());
      }
    }
    estadoSync = { ...estadoSync, miembro: nuevo };
    if (JSON.stringify(antes) !== JSON.stringify(nuevo)) avisar('cuenta:cambio', cuenta.estado());
  }

  // Ventas y anulaciones solo se insertan (nunca se reescriben; primero las ventas, que las anulaciones las necesitan).
  // Lo demás se actualiza si es más nuevo.
  async function subirLote(lote) {
    const fila = (p) => ({ owner_id: miembro().empresa, tipo: p.tipo, id: p.id, datos: p.datos, borrado: p.borrado, actualizado: p.actualizado });
    for (const tipo of ['venta', 'anulacion']) {
      const filas = lote.filter((p) => p.tipo === tipo).map(fila);
      const r = filas.length ? await cliente.from('registros').upsert(filas, { onConflict: 'owner_id,tipo,id', ignoreDuplicates: true }) : {};
      if (r.error) return r.error;
    }
    const otros = lote.filter((p) => !['venta', 'anulacion'].includes(p.tipo)).map(fila);
    const r = otros.length ? await cliente.from('registros').upsert(otros, { onConflict: 'owner_id,tipo,id' }) : {};
    return r.error;
  }

  async function subirPendientes() {
    const rechazable = (e) => ['42501', '22023'].includes(e.code);
    const subir = Object.values(estadoSync.pendientes);
    for (let i = 0; i < subir.length; i += 200) {
      const lote = subir.slice(i, i + 200);
      const error = await subirLote(lote);
      if (!error) {
        estadoSync = S.quitarSubidos(estadoSync, lote);
        continue;
      }
      if (!rechazable(error)) throw error;
      // Permiso denegado: se prueba fila a fila. Lo rechazado se descarta (salvo ventas, que nunca se pierden).
      for (const p of lote) {
        const e = await subirLote([p]);
        if (!e) estadoSync = S.quitarSubidos(estadoSync, [p]);
        else if (rechazable(e) && p.tipo !== 'venta') {
          const pendientes = { ...estadoSync.pendientes };
          delete pendientes[`${p.tipo}:${p.id}`];
          estadoSync = { ...estadoSync, pendientes, cursor: null, versiones: {} };
        } else if (!rechazable(e)) throw e;
      }
    }
  }

  async function bajarCambios() {
    for (;;) {
      const { data, error } = await cliente.from('registros').select('tipo,id,datos,borrado,actualizado,recibido')
        .eq('owner_id', miembro().empresa).gte('recibido', estadoSync.cursor || '1970-01-01T00:00:00Z').order('recibido').limit(1000);
      if (error) throw error;
      const r = S.fusionarRemotos(actual, estadoSync, data);
      estadoSync = r.estado;
      if (r.hubo) {
        actual = normalizar(r.datos);
        await escribir('datos.json', actual);
        avisar('datos:remotos', entregar());
      }
      if (data.length < 1000) return;
    }
  }

  async function sincronizar() {
    if (!cliente || !usuario || sincronizando) return;
    sincronizando = true;
    avisar('sync:estado', { estado: 'sincronizando', pendientes: contarPendientes() });
    try {
      await actualizarMiembro();
      await subirPendientes();
      await bajarCambios();
      // Primera vez en esta cuenta: lo que solo existe en este equipo se sube (lo de la nube ya se bajó y manda).
      if (!estadoSync.vinculado) {
        const locales = [...S.registrosDe(actual).entries()]
          .filter(([k, r]) => !estadoSync.versiones[k] && (esAdmin() || r.tipo === 'venta')).map(([, r]) => r);
        estadoSync = { ...S.anotarPendientes(estadoSync, locales), vinculado: true };
        if (locales.length) programarSync(0);
      }
      await escribir('sync.json', estadoSync);
      avisar('sync:estado', { estado: 'ok', hora: new Date().toISOString(), pendientes: contarPendientes() });
    } catch (e) {
      await escribir('sync.json', estadoSync);
      const sinRed = /fetch failed|failed to fetch|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(String(e.message || e));
      avisar('sync:estado', { estado: sinRed ? 'sin-conexion' : 'error', mensaje: String(e.message || e), pendientes: contarPendientes() });
    } finally {
      sincronizando = false;
    }
  }

  // Cada cuenta tiene sus propios datos en este equipo: al cambiar de cuenta se apartan los de la anterior
  // (con sus cambios pendientes de subir) y se recuperan los de la nueva si ya entró antes aquí.
  async function activarUsuario(u) {
    usuario = { id: u.id, email: u.email };
    if (estadoSync.usuario && estadoSync.usuario !== u.id) {
      await escribir(`datos-${estadoSync.usuario}.json`, actual);
      await escribir(`sync-${estadoSync.usuario}.json`, estadoSync);
      actual = normalizar(await almacen.leer(`datos-${u.id}.json`));
      estadoSync = { ...S.estadoInicial(), ...(await almacen.leer(`sync-${u.id}.json`)) };
      await escribir('datos.json', actual);
      avisar('datos:remotos', entregar());
    }
    estadoSync.usuario = u.id;
    await escribir('sync.json', estadoSync);
    programarSync(0);
  }

  const MENSAJES_ACCESO = [
    [/invalid login credentials/i, 'Correo o contraseña incorrectos.'],
    [/email not confirmed/i, 'Confirma tu correo con el enlace que te enviamos y vuelve a entrar.'],
    [/already registered|already exists/i, 'Ya existe una cuenta con ese correo.'],
    [/password should be at least|weak password/i, 'La contraseña es demasiado corta o débil.'],
    [/token has expired or is invalid|otp.*(expired|invalid)|invalid.*(token|otp)/i, 'Código incorrecto o caducado.'],
    [/same.*password|different from the old/i, 'La contraseña nueva debe ser distinta de la anterior.'],
    [/invalid email|unable to validate email/i, 'Correo no válido.'],
    [/rate limit|too many requests|only request this after/i, 'Se enviaron demasiados correos. Espera un rato y vuelve a intentarlo.'],
    [/fetch failed|failed to fetch|network/i, 'No hay conexión con el servidor.'],
  ];
  const mensajeAcceso = (e) => (MENSAJES_ACCESO.find(([re]) => re.test(e.message)) || [null, e.message])[1];

  const cuenta = {
    estado: () => ({ configurado: !!config, email: usuario?.email ?? null, rol: usuario ? miembro().rol : 'admin', serie: usuario ? miembro().serie : '', permisos: usuario ? miembro().permisos || [] : [] }),
    async entrar({ email, clave }) {
      const { data, error } = await cliente.auth.signInWithPassword({ email, password: clave });
      if (error) return { error: mensajeAcceso(error) };
      await activarUsuario(data.user);
      return { email: data.user.email };
    },
    async registrar({ email, clave }) {
      const { data, error } = await cliente.auth.signUp({ email, password: clave });
      if (error) return { error: mensajeAcceso(error) };
      if (!data.session) return { confirmar: true };
      await activarUsuario(data.user);
      return { email: data.user.email };
    },
    async salir() {
      await sincronizar(); // último intento de subir lo pendiente
      await cliente.auth.signOut({ scope: 'local' });
      usuario = null;
      return true;
    },
    pendientes: () => contarPendientes(),

    // Restablecer contraseña con un código de un solo uso enviado por correo (sin enlaces: no hay deep links).
    // Siempre responde igual, exista o no la cuenta; solo un fallo de red se distingue.
    async pedirCodigo({ email }) {
      const { error } = await cliente.auth.resetPasswordForEmail(email.trim().toLowerCase());
      if (error && /fetch failed|failed to fetch|network/i.test(error.message)) return { error: mensajeAcceso(error) };
      return { ok: true };
    },
    // Si la contraseña nueva se rechaza, se puede reintentar sin pedir otro código (la sesión de recuperación sigue).
    async restablecer({ email, codigo, clave }) {
      if (!recuperando) {
        await almacen.escribir('recuperando.json', true); // si la app se cierra antes de terminar, esta sesión se descarta
        const { error } = await cliente.auth.verifyOtp({ email: email.trim().toLowerCase(), token: codigo.trim(), type: 'recovery' });
        if (error) {
          await almacen.escribir('recuperando.json', false);
          return { error: mensajeAcceso(error) };
        }
        recuperando = true;
      }
      const { data, error } = await cliente.auth.updateUser({ password: clave });
      if (error) return { error: mensajeAcceso(error), reintentar: true };
      recuperando = false;
      await almacen.escribir('recuperando.json', false);
      // Cambiar la contraseña no echa a otros equipos: se cierran sus sesiones (un equipo robado deja de entrar).
      const otros = await cliente.auth.signOut({ scope: 'others' });
      await activarUsuario(data.user);
      return { email: data.user.email, avisoOtros: !!otros.error };
    },
    async cancelarRestablecer() {
      if (recuperando) await cliente.auth.signOut({ scope: 'local' });
      recuperando = false;
      await almacen.escribir('recuperando.json', false);
    },
  };

  // ---------- Equipo (solo con conexión; la seguridad la aplica el servidor) ----------
  const respuesta = async (promesa) => {
    const { data, error } = await promesa;
    return error ? { error: error.message } : { data };
  };
  const equipo = {
    async listar() {
      const m = await respuesta(cliente.from('miembros').select('user_id,email,rol,serie,permisos').order('email'));
      if (m.error) return m;
      const inv = !esAdmin() ? { data: [] } : await respuesta(cliente.from('invitaciones').select('email,rol,expira').order('email'));
      return inv.error ? inv : { miembros: m.data, invitaciones: inv.data, yo: usuario.id };
    },
    permisos: ({ userId, permisos }) => respuesta(cliente.rpc('cambiar_permisos', { p_user: userId, p_permisos: permisos })),
    invitar: ({ email, rol }) => respuesta(cliente.rpc('invitar', { p_email: email, p_rol: rol })),
    cancelar: (email) => respuesta(cliente.rpc('cancelar_invitacion', { p_email: email })),
    async cambiar({ userId, rol }) {
      const r = await respuesta(cliente.rpc('cambiar_miembro', { p_user: userId, p_rol: rol }));
      if (!r.error && userId === usuario.id) programarSync(0); // si me cambio el rol a mí, se aplica ya
      return r;
    },
  };

  async function iniciar() {
    actual = normalizar(await almacen.leer('datos.json'));
    estadoSync = { ...S.estadoInicial(), ...(await almacen.leer('sync.json')) };
    if (!config) return;
    cliente = crearCliente(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { storage: almacenSesion, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    // Una recuperación de contraseña que quedó a medias no debe servir para entrar.
    if (await almacen.leer('recuperando.json')) {
      await cliente.auth.signOut({ scope: 'local' });
      await almacen.escribir('recuperando.json', false);
    }
    // Con sesión guardada se entra sin internet; los tokens se renuevan cuando vuelva la conexión.
    const { data } = await cliente.auth.getSession();
    if (data.session?.user) await activarUsuario(data.session.user);
    setInterval(() => programarSync(0), 30000).unref?.(); // en Node (pruebas) no impide terminar; en el navegador no existe
  }

  return {
    iniciar,
    leer: async () => entregar(),
    guardar,
    sincronizar,
    alVolver: () => programarSync(500), // la ventana o la app vuelve al primer plano
    cuenta,
    equipo,
    cliente: () => cliente,
  };
}

if (typeof module !== 'undefined') module.exports = { crearNucleo };
