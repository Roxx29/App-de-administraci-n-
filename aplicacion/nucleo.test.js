const test = require('node:test');
const assert = require('node:assert');
const S = require('./sincronizacion.js');
const { normalizar } = require('./src/logica.js');
const { crearNucleo } = require('./nucleo.js');

const almacenEnMemoria = () => {
  const archivos = {};
  return { archivos, leer: async (n) => (archivos[n] ? JSON.parse(archivos[n]) : null), escribir: async (n, v) => { archivos[n] = JSON.stringify(v); } };
};

test('sin nube: guarda en el almacén y aplica cambios sobre la versión que tenía la pantalla', async () => {
  const almacen = almacenEnMemoria();
  const n = crearNucleo({ S, normalizar, almacen, config: null, avisar: () => {} });
  await n.iniciar();
  const v1 = await n.leer();
  const prod = { id: 'p1', sku: 'A', nombre: 'Mesa', costo: 1, precio: 2, stockBase: 5, stockFecha: '2026-01-01', minimo: 0 };
  const v2 = await n.guardar({ rev: v1.rev, datos: { ...v1.datos, productos: [prod] } });
  // Otra pantalla con la versión vieja añade un gasto: no debe borrar el producto.
  const v3 = await n.guardar({ rev: v1.rev, datos: { ...v1.datos, gastos: [{ id: 'g1' }] } });
  assert.strictEqual(v3.datos.productos.length, 1);
  assert.strictEqual(v3.datos.gastos.length, 1);
  assert.ok(v3.rev > v2.rev);
  assert.strictEqual(JSON.parse(almacen.archivos['datos.json']).productos[0].nombre, 'Mesa');
  assert.deepStrictEqual(n.cuenta.estado(), { configurado: false, email: null, rol: 'admin', serie: '', permisos: [] });
});

test('restablecer contraseña: código, reintento sin código nuevo y sesión a medias descartada', async () => {
  const llamadas = [];
  let claveAceptada = false;
  const auth = {
    getSession: async () => ({ data: { session: null } }),
    resetPasswordForEmail: async (email) => (llamadas.push(['pedir', email]), { error: null }),
    verifyOtp: async ({ token }) => (llamadas.push(['verificar', token]), token === '123456' ? { error: null } : { error: { message: 'Token has expired or is invalid' } }),
    updateUser: async ({ password }) => (llamadas.push(['cambiar']), password.length < 10 ? { error: { message: 'Password should be at least 10 characters' } } : (claveAceptada = true, { data: { user: { id: 'u1', email: 'a@x.com' } } })),
    signOut: async ({ scope }) => (llamadas.push(['salir', scope]), {}),
  };
  const cliente = { auth, rpc: async () => ({ error: { code: 'PGRST202' } }), from: () => ({}) };
  const almacen = almacenEnMemoria();
  const crear = () => crearNucleo({ S, normalizar, almacen, config: { supabaseUrl: 'x', supabaseAnonKey: 'y' }, crearCliente: () => cliente, avisar: () => {}, programar: () => 0, cancelar: () => {} });
  const n = crear();
  await n.iniciar();

  assert.deepStrictEqual(await n.cuenta.pedirCodigo({ email: '  A@X.com ' }), { ok: true });
  assert.deepStrictEqual(llamadas.pop(), ['pedir', 'a@x.com'], 'el correo se normaliza');

  assert.match((await n.cuenta.restablecer({ email: 'a@x.com', codigo: '000000', clave: 'larga-y-buena' })).error, /incorrecto o caducado/);
  const corta = await n.cuenta.restablecer({ email: 'a@x.com', codigo: '123456', clave: 'corta' });
  assert.ok(corta.reintentar && corta.error, 'contraseña rechazada: se puede reintentar');
  assert.strictEqual(n.cuenta.estado().email, null, 'no entra hasta guardar la contraseña');
  llamadas.length = 0;
  const ok = await n.cuenta.restablecer({ email: 'a@x.com', codigo: '123456', clave: 'larga-y-buena' });
  assert.ok(claveAceptada);
  assert.ok(!llamadas.some(([q]) => q === 'verificar'), 'el reintento no vuelve a pedir el código');
  assert.ok(llamadas.some(([q, s]) => q === 'salir' && s === 'others'), 'cierra las sesiones de otros equipos');
  assert.strictEqual(ok.email, 'a@x.com');
  assert.strictEqual(n.cuenta.estado().email, 'a@x.com');

  // App cerrada después de verificar el código y antes de guardar la contraseña: al abrir, esa sesión se descarta.
  await almacen.escribir('recuperando.json', true);
  llamadas.length = 0;
  await crear().iniciar();
  assert.deepStrictEqual(llamadas, [['salir', 'local']]);
  assert.strictEqual(await almacen.leer('recuperando.json'), false);
});
