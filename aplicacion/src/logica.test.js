const test = require('node:test');
const assert = require('node:assert');
const L = require('./logica.js');

const prod = (o) => ({ id: 'p1', sku: 'SKU-1', nombre: 'Lámpara', categoria: '', costo: 1850, precio: 4625, stockBase: 5, stockFecha: '2000-01-01T00:00:00.000Z', minimo: 2, ...o });
const conStockDe = (o) => ({ ...prod(o), stock: o?.stock ?? prod(o).stockBase });

test('aCentimos acepta coma y punto, rechaza basura', () => {
  assert.strictEqual(L.aCentimos('46,25'), 4625);
  assert.strictEqual(L.aCentimos('46.2'), 4620);
  assert.strictEqual(L.aCentimos('0.1'), 10);
  assert.ok(Number.isNaN(L.aCentimos('abc')));
  assert.ok(Number.isNaN(L.aCentimos('-3')));
  assert.ok(Number.isNaN(L.aCentimos('1.234')));
});

test('totales desglosan IVA incluido y cuadran', () => {
  const t = L.totalesTicket([{ precio: 4625, cantidad: 1 }, { precio: 620, cantidad: 2 }], 21);
  assert.strictEqual(t.total, 5865);
  assert.strictEqual(t.base + t.cuota, t.total);
  assert.strictEqual(t.base, 4847);
});

test('registrarVenta descuenta stock y numera la factura', () => {
  const datos = { ...L.datosIniciales(), productos: [prod()] };
  const { datos: d2, venta } = L.registrarVenta(datos, [{ productoId: 'p1', sku: 'SKU-1', nombre: 'Lámpara', precio: 4625, cantidad: 2 }], { metodo: 'Efectivo', fecha: new Date('2026-10-25T10:00:00Z') });
  assert.strictEqual(L.conStock(d2).productos[0].stock, 3);
  assert.strictEqual(datos.ventas.length, 0, 'no muta los datos originales');
  assert.strictEqual(d2.productos[0].stockBase, 5, 'la venta no reescribe el producto');
  assert.strictEqual(venta.numero, 'FAC-2026-0001');
  assert.strictEqual(venta.total, 9250);
});

test('registrarVenta rechaza stock insuficiente y ticket vacío', () => {
  const datos = { ...L.datosIniciales(), productos: [prod({ stockBase: 1 })] };
  assert.throws(() => L.registrarVenta(datos, [{ productoId: 'p1', nombre: 'Lámpara', precio: 1, cantidad: 2 }], { metodo: 'Efectivo' }), /Stock insuficiente/);
  assert.throws(() => L.registrarVenta(datos, [], { metodo: 'Efectivo' }), /vacío/);
});

test('validarProducto detecta SKU duplicado y estado de stock', () => {
  assert.match(L.validarProducto(conStockDe({ id: 'p2' }), [prod()]), /SKU/);
  assert.strictEqual(L.validarProducto(conStockDe(), [prod()]), null);
  assert.strictEqual(L.estadoStock(conStockDe({ stock: 0 })), 'agotado');
  assert.strictEqual(L.estadoStock(conStockDe({ stock: 2 })), 'bajo');
});

test('informe calcula rentabilidad con costo histórico y gastos', () => {
  let datos = { ...L.datosIniciales(), productos: [prod({ stockBase: 10 })] };
  // 2 uds a 46,25 con IVA 21% → base 76,45; costo 2 × 18,50 = 37,00
  ({ datos } = L.registrarVenta(datos, [{ productoId: 'p1', sku: 'SKU-1', nombre: 'Lámpara', precio: 4625, cantidad: 2 }], { metodo: 'Efectivo', fecha: new Date(2026, 9, 10, 12) }));
  datos.productos[0].costo = 99999; // cambiar el costo después no altera ventas pasadas
  datos.gastos = [{ id: 'g1', fecha: '2026-10-05', concepto: 'Alquiler', categoria: 'Local y alquiler', importe: 2000 }, { id: 'g2', fecha: '2026-09-30', concepto: 'Fuera', categoria: 'Otros', importe: 500 }];
  const r = L.informe(datos, '2026-10-01', '2026-10-31');
  assert.strictEqual(r.ingresos, 7645);
  assert.strictEqual(r.cogs, 3700);
  assert.strictEqual(r.gastos, 2000);
  assert.strictEqual(r.beneficio, 1945);
  assert.strictEqual(r.topProductos[0].unidades, 2);
  assert.deepStrictEqual(r.porCategoria, [['Local y alquiler', 2000]]);
  const serie = L.serieMensual(datos, 2, new Date(2026, 9, 25));
  assert.strictEqual(serie.length, 2);
  assert.strictEqual(serie[0].costes, 500);
  assert.strictEqual(serie[1].beneficio, 1945);
});

test('validarGasto', () => {
  const g = { concepto: 'Luz', fecha: '2026-10-01', importe: 1500, categoria: 'Suministros' };
  assert.strictEqual(L.validarGasto(g), null);
  assert.match(L.validarGasto({ ...g, importe: 0 }), /importe/);
  assert.match(L.validarGasto({ ...g, categoria: 'x' }), /Categoría/);
});

test('normalizar completa ajustes nuevos sin perder los guardados', () => {
  const viejo = { id: 'p1', sku: 'S', nombre: 'n', costo: 1, precio: 2, stock: 7, minimo: 0 };
  const d = L.normalizar({ ajustes: { negocio: 'Tienda', moneda: '$', iva: 18 }, productos: [viejo], ventas: [{ fecha: '2026-01-02T00:00:00.000Z', lineas: [{ productoId: 'p1', cantidad: 3 }] }] });
  assert.strictEqual(d.ajustes.negocio, 'Tienda');
  assert.strictEqual(d.ajustes.factura.plantilla, 'clasica');
  assert.deepStrictEqual(d.gastos, []);
  assert.strictEqual(d.productos[0].stockBase, 7, 'el stock viejo ya descontado pasa a ser la base');
  assert.strictEqual(L.conStock(d).productos[0].stock, 7, 'las ventas anteriores no se descuentan dos veces');
  assert.strictEqual(L.normalizar(null).ajustes.iva, 21);
});

test('el traductor se aplica a los mensajes con parámetros', () => {
  L.fijarTraductor((s, p = {}) => (s === 'Stock insuficiente de {n} (quedan {s}).' ? `Not enough ${p.n} (${p.s} left).` : s));
  const datos = { ...L.datosIniciales(), productos: [prod({ stockBase: 1 })] };
  assert.throws(() => L.registrarVenta(datos, [{ productoId: 'p1', nombre: 'Lámpara', precio: 1, cantidad: 2 }], { metodo: 'x' }), /Not enough Lámpara \(1 left\)/);
  L.fijarTraductor((s, p = {}) => s.replace(/\{(\w+)\}/g, (_, k) => p[k]));
});

test('ventas de dos equipos sin conexión se suman en el stock', () => {
  const base = { ...L.datosIniciales(), productos: [prod({ stockBase: 10 })] };
  const linea = [{ productoId: 'p1', sku: 'SKU-1', nombre: 'Lámpara', precio: 4625, cantidad: 2 }];
  const a = L.registrarVenta(base, linea, { metodo: 'Efectivo', serie: '' }).venta;
  const b = L.registrarVenta(base, linea, { metodo: 'Efectivo', serie: 'E2' }).venta;
  const juntos = { ...base, ventas: [a, b] };
  assert.strictEqual(L.conStock(juntos).productos[0].stock, 6);
  assert.notStrictEqual(a.numero, b.numero, 'cada serie numera aparte');
  assert.match(b.numero, /^FAC-E2-\d{4}-0001$/);
  // El admin recuenta el stock: las ventas anteriores al recuento ya no se descuentan.
  const recontado = { ...juntos, productos: [prod({ stockBase: 20, stockFecha: '2999-01-01T00:00:00.000Z' })] };
  assert.strictEqual(L.conStock(recontado).productos[0].stock, 20);
  assert.strictEqual(L.siguienteNumero(juntos.ventas, ''), 2);
});

test('sobreventa sin conexión: stock negativo, descuadre y anulación', () => {
  const base = { ...L.datosIniciales(), productos: [prod({ stockBase: 5 })] };
  const cinco = [{ productoId: 'p1', sku: 'SKU-1', nombre: 'Mesa', precio: 100, cantidad: 5 }];
  const online = L.registrarVenta(base, cinco, { metodo: 'Efectivo', vendedor: 'a@x.com', fecha: new Date('2026-10-25T10:00:00Z') }).venta;
  const offline = L.registrarVenta(base, cinco, { metodo: 'Efectivo', serie: 'E2', vendedor: 'b@x.com', sinConexion: true, fecha: new Date('2026-10-25T10:05:00Z') }).venta;
  const juntos = { ...base, ventas: [online, offline] };
  assert.strictEqual(L.conStock(juntos).productos[0].stock, -5);
  const [d] = L.descuadres(juntos);
  assert.strictEqual(d.faltan, 5);
  assert.deepStrictEqual(d.ventas.map((x) => x.venta.vendedor), ['b@x.com', 'a@x.com']);
  assert.ok(d.ventas[0].venta.sinConexion);
  const anulado = L.anularVenta(juntos, offline, { motivo: 'Sobreventa', por: 'admin@x.com' });
  assert.strictEqual(L.conStock(anulado).productos[0].stock, 0, 'anular devuelve el stock');
  assert.deepStrictEqual(L.descuadres(anulado), []);
  assert.strictEqual(L.resumen(anulado, new Date('2026-10-25T12:00:00Z')).ventasTotal, 500, 'la anulada no suma');
  assert.strictEqual(anulado.ventas.length, 2, 'la venta no se borra');
  assert.throws(() => L.anularVenta(anulado, offline, {}), /ya está anulada/);
});
