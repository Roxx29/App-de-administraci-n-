// Lógica de negocio pura: sin pantalla ni almacenamiento, para reutilizarla en móvil.
// El dinero se guarda siempre en céntimos (enteros) para evitar errores de redondeo.

const CATEGORIAS_GASTO = ['Mercancía / Proveedores', 'Local y alquiler', 'Suministros', 'Sueldos', 'Logística y envíos', 'Software y herramientas', 'Impuestos y tasas', 'Otros'];

// Fecha local YYYY-MM-DD (las ventas se guardan en ISO UTC).
const diaLocal = (d) => {
  const f = new Date(d);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
};

const datosIniciales = () => ({
  ajustes: { negocio: 'Mi Negocio', nif: '', direccion: '', moneda: '€', iva: 21 },
  productos: [],
  ventas: [],
  gastos: [],
  secuencia: 0,
});

function aCentimos(texto) {
  const limpio = String(texto).trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return NaN;
  return Math.round(Number(limpio) * 100);
}

function formatoDinero(centimos, moneda = '€') {
  const n = (centimos / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${moneda}${n}`;
}

function validarProducto(p, productos) {
  if (!p.nombre.trim()) return 'El nombre es obligatorio.';
  if (!p.sku.trim()) return 'El SKU es obligatorio.';
  if (productos.some((o) => o.id !== p.id && o.sku.toLowerCase() === p.sku.trim().toLowerCase())) return 'Ya existe un producto con ese SKU.';
  if (!Number.isInteger(p.precio) || p.precio < 0) return 'Precio de venta no válido.';
  if (!Number.isInteger(p.costo) || p.costo < 0) return 'Costo no válido.';
  if (!Number.isInteger(p.stock) || p.stock < 0) return 'El stock debe ser un número entero, 0 o mayor.';
  if (!Number.isInteger(p.minimo) || p.minimo < 0) return 'El mínimo debe ser un número entero, 0 o mayor.';
  return null;
}

function estadoStock(p) {
  if (p.stock <= 0) return 'agotado';
  if (p.stock <= p.minimo) return 'bajo';
  return 'ok';
}

// Los precios incluyen IVA: se desglosa la base a partir del total.
function totalesTicket(lineas, iva) {
  const total = lineas.reduce((s, l) => s + l.precio * l.cantidad, 0);
  const base = Math.round(total / (1 + iva / 100));
  return { total, base, cuota: total - base };
}

function numeroFactura(anio, n) {
  return `FAC-${anio}-${String(n).padStart(4, '0')}`;
}

// Devuelve datos nuevos con la venta registrada y el stock descontado; lanza error si no hay stock.
function registrarVenta(datos, lineas, { metodo, cliente, fecha = new Date() }) {
  if (!lineas.length) throw new Error('El ticket está vacío.');
  const productos = datos.productos.map((p) => ({ ...p }));
  for (const l of lineas) {
    const p = productos.find((x) => x.id === l.productoId);
    if (!p) throw new Error(`El producto ${l.nombre} ya no existe.`);
    if (!Number.isInteger(l.cantidad) || l.cantidad <= 0) throw new Error(`Cantidad no válida para ${p.nombre}.`);
    if (p.stock < l.cantidad) throw new Error(`Stock insuficiente de ${p.nombre} (quedan ${p.stock}).`);
    p.stock -= l.cantidad;
  }
  const secuencia = datos.secuencia + 1;
  const { total, base, cuota } = totalesTicket(lineas, datos.ajustes.iva);
  const venta = {
    id: `v${secuencia}`,
    numero: numeroFactura(fecha.getFullYear(), secuencia),
    fecha: fecha.toISOString(),
    cliente: cliente || 'Cliente mostrador',
    metodo,
    iva: datos.ajustes.iva,
    // Se guarda el costo del momento para calcular la rentabilidad aunque luego cambie.
    lineas: lineas.map(({ productoId, sku, nombre, precio, cantidad }) => ({ productoId, sku, nombre, precio, cantidad, costo: productos.find((x) => x.id === productoId).costo })),
    total,
    base,
    cuota,
  };
  return { datos: { ...datos, productos, ventas: [...datos.ventas, venta], secuencia }, venta };
}

function resumen(datos, hoy = new Date()) {
  const dia = diaLocal(hoy);
  const deHoy = datos.ventas.filter((v) => diaLocal(v.fecha) === dia);
  return {
    ventasHoy: deHoy.reduce((s, v) => s + v.total, 0),
    ticketsHoy: deHoy.length,
    ventasTotal: datos.ventas.reduce((s, v) => s + v.total, 0),
    valorInventario: datos.productos.reduce((s, p) => s + p.costo * p.stock, 0),
    alertas: datos.productos.filter((p) => estadoStock(p) !== 'ok'),
  };
}

function validarGasto(g) {
  if (!g.concepto.trim()) return 'El concepto es obligatorio.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.fecha)) return 'Fecha no válida.';
  if (!Number.isInteger(g.importe) || g.importe <= 0) return 'El importe debe ser mayor que 0.';
  if (!CATEGORIAS_GASTO.includes(g.categoria)) return 'Categoría no válida.';
  return null;
}

// Rentabilidad entre dos fechas YYYY-MM-DD (ambas incluidas). Ingresos sin IVA.
function informe(datos, desde, hasta) {
  const enRango = (dia) => dia >= desde && dia <= hasta;
  const ventas = datos.ventas.filter((v) => enRango(diaLocal(v.fecha)));
  const gastos = (datos.gastos || []).filter((g) => enRango(g.fecha));
  const costoActual = (id) => datos.productos.find((p) => p.id === id)?.costo ?? 0;
  const productos = {};
  let cogs = 0;
  for (const v of ventas) {
    for (const l of v.lineas) {
      const costo = (l.costo ?? costoActual(l.productoId)) * l.cantidad;
      const ingreso = Math.round((l.precio * l.cantidad) / (1 + v.iva / 100));
      cogs += costo;
      const p = (productos[l.sku] ??= { sku: l.sku, nombre: l.nombre, unidades: 0, ingresos: 0, costo: 0 });
      p.unidades += l.cantidad;
      p.ingresos += ingreso;
      p.costo += costo;
    }
  }
  const porCategoria = {};
  for (const g of gastos) porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + g.importe;
  const ingresos = ventas.reduce((s, v) => s + v.base, 0);
  const totalGastos = gastos.reduce((s, g) => s + g.importe, 0);
  const beneficio = ingresos - cogs - totalGastos;
  return {
    tickets: ventas.length,
    facturado: ventas.reduce((s, v) => s + v.total, 0),
    iva: ventas.reduce((s, v) => s + v.cuota, 0),
    ingresos,
    cogs,
    gastos: totalGastos,
    beneficio,
    margen: ingresos ? Math.round((beneficio / ingresos) * 1000) / 10 : 0,
    porCategoria: Object.entries(porCategoria).sort((a, b) => b[1] - a[1]),
    topProductos: Object.values(productos).sort((a, b) => b.ingresos - a.ingresos),
  };
}

// Ingresos y costes (mercancía vendida + gastos) de los últimos `meses` meses.
function serieMensual(datos, meses, hoy = new Date()) {
  const serie = [];
  for (let i = meses - 1; i >= 0; i--) {
    const ini = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const fin = new Date(hoy.getFullYear(), hoy.getMonth() - i + 1, 0);
    const r = informe(datos, diaLocal(ini), diaLocal(fin));
    serie.push({ mes: ini.toLocaleDateString('es-ES', { month: 'short', year: '2-digit' }), ingresos: r.ingresos, costes: r.cogs + r.gastos, beneficio: r.beneficio });
  }
  return serie;
}

if (typeof module !== 'undefined') {
  module.exports = { datosIniciales, aCentimos, formatoDinero, validarProducto, estadoStock, totalesTicket, numeroFactura, registrarVenta, resumen, CATEGORIAS_GASTO, diaLocal, validarGasto, informe, serieMensual };
}
