const test = require('node:test');
const assert = require('node:assert');
const L = require('./logica.js');

const prod = (o) => ({ id: 'p1', sku: 'SKU-1', nombre: 'Lámpara', categoria: '', costo: 1850, precio: 4625, stock: 5, minimo: 2, ...o });

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
  assert.strictEqual(d2.productos[0].stock, 3);
  assert.strictEqual(datos.productos[0].stock, 5, 'no muta los datos originales');
  assert.strictEqual(venta.numero, 'FAC-2026-0001');
  assert.strictEqual(venta.total, 9250);
});

test('registrarVenta rechaza stock insuficiente y ticket vacío', () => {
  const datos = { ...L.datosIniciales(), productos: [prod({ stock: 1 })] };
  assert.throws(() => L.registrarVenta(datos, [{ productoId: 'p1', nombre: 'Lámpara', precio: 1, cantidad: 2 }], { metodo: 'Efectivo' }), /Stock insuficiente/);
  assert.throws(() => L.registrarVenta(datos, [], { metodo: 'Efectivo' }), /vacío/);
});

test('validarProducto detecta SKU duplicado y estado de stock', () => {
  assert.match(L.validarProducto(prod({ id: 'p2' }), [prod()]), /SKU/);
  assert.strictEqual(L.validarProducto(prod(), [prod()]), null);
  assert.strictEqual(L.estadoStock(prod({ stock: 0 })), 'agotado');
  assert.strictEqual(L.estadoStock(prod({ stock: 2 })), 'bajo');
});

test('informe calcula rentabilidad con costo histórico y gastos', () => {
  let datos = { ...L.datosIniciales(), productos: [prod({ stock: 10 })] };
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
