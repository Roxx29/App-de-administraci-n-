/* global totalesTicket, datosIniciales, aCentimos, formatoDinero, validarProducto, estadoStock, registrarVenta, resumen */
let datos;
let ticket = []; // líneas del ticket en curso
let metodoPago = 'Efectivo';

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dinero = (c) => formatoDinero(c, datos.ajustes.moneda);
const decimal = (c) => (c / 100).toFixed(2);
const fecha = (iso) => new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
const ESTADOS = { ok: 'Óptimo', bajo: 'Stock bajo', agotado: 'Agotado' };

function avisar(texto, mal = false) {
  const a = $('#aviso');
  a.textContent = texto;
  a.className = 'visible' + (mal ? ' mal' : '');
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => (a.className = ''), 2800);
}

async function guardar(nuevos) {
  try {
    await window.api.guardarDatos(nuevos);
    datos = nuevos;
    return true;
  } catch (e) {
    avisar('No se pudo guardar: ' + e.message, true);
    return false;
  }
}

// ---------- Vistas ----------
const vistas = {
  resumen() {
    const r = resumen(datos);
    const ultimas = datos.ventas.slice(-5).reverse();
    return `
      <h1>Resumen Diario</h1><p class="sub">${new Date().toLocaleDateString('es-ES', { dateStyle: 'full' })}</p>
      <div class="tarjetas">
        <div class="tarjeta"><small>Ventas de hoy</small><div class="valor">${dinero(r.ventasHoy)}</div><small>${r.ticketsHoy} tickets</small></div>
        <div class="tarjeta"><small>Ventas totales</small><div class="valor">${dinero(r.ventasTotal)}</div><small>${datos.ventas.length} facturas</small></div>
        <div class="tarjeta"><small>Valor inventario (costo)</small><div class="valor">${dinero(r.valorInventario)}</div><small>${datos.productos.length} productos</small></div>
        <div class="tarjeta"><small>Alertas de stock</small><div class="valor ${r.alertas.length ? 'bajo' : 'ok'}">${r.alertas.length}</div><small>bajo mínimo o agotados</small></div>
      </div>
      <div class="tarjetas">
        <div class="panel"><h2>Productos por reponer</h2>${r.alertas.length ? `<table>${r.alertas.map((p) => `<tr><td>${esc(p.nombre)}</td><td class="num"><span class="chip ${estadoStock(p)}">${p.stock} uds</span></td></tr>`).join('')}</table>` : '<p class="vacio">Todo en orden.</p>'}</div>
        <div class="panel"><h2>Últimas ventas</h2>${ultimas.length ? `<table>${ultimas.map((v) => `<tr><td class="mono">${v.numero}</td><td>${fecha(v.fecha)}</td><td class="num">${dinero(v.total)}</td></tr>`).join('')}</table>` : '<p class="vacio">Aún no hay ventas.</p>'}</div>
      </div>`;
  },

  inventario() {
    return `
      <div class="cabecera"><div><h1>Inventario &amp; Catálogo</h1><p class="sub">${datos.productos.length} productos</p></div>
        <div class="acciones"><button id="exportar-productos">Exportar a Excel</button><button class="primario" id="nuevo-producto">+ Nuevo producto</button></div></div>
      <input class="buscador" id="buscar" placeholder="Buscar por nombre, SKU o categoría…" aria-label="Buscar productos">
      <div class="panel"><table>
        <thead><tr><th>SKU</th><th>Producto</th><th>Categoría</th><th class="num">Existencias</th><th class="num">Costo</th><th class="num">Precio (IVA incl.)</th><th class="num">Margen</th><th></th></tr></thead>
        <tbody id="filas"></tbody></table></div>`;
  },

  venta() {
    return `
      <h1>Punto de Venta</h1><p class="sub">Haz clic en un producto para añadirlo al ticket.</p>
      <div class="pos">
        <div><input class="buscador" id="buscar" placeholder="Buscar producto o SKU…" aria-label="Buscar productos"><div class="rejilla" id="rejilla"></div></div>
        <div class="panel" id="ticket"></div>
      </div>`;
  },

  ventas() {
    const lista = datos.ventas.slice().reverse();
    return `
      <div class="cabecera"><div><h1>Ventas &amp; Facturas</h1><p class="sub">${datos.ventas.length} facturas emitidas</p></div>
        <div class="acciones"><button id="exportar-ventas" ${lista.length ? '' : 'disabled'}>Exportar a Excel</button></div></div>
      <div class="panel">${lista.length ? `<table>
        <thead><tr><th>Factura</th><th>Fecha</th><th>Cliente</th><th>Método</th><th class="num">Artículos</th><th class="num">Total</th><th></th></tr></thead>
        <tbody>${lista.map((v) => `<tr><td class="mono">${v.numero}</td><td>${fecha(v.fecha)}</td><td>${esc(v.cliente)}</td><td>${esc(v.metodo)}</td>
          <td class="num">${v.lineas.reduce((s, l) => s + l.cantidad, 0)}</td><td class="num">${dinero(v.total)}</td>
          <td class="num"><button data-pdf="${v.id}">Factura PDF</button></td></tr>`).join('')}</tbody></table>` : '<p class="vacio">Aún no hay ventas. Registra la primera en el Punto de Venta.</p>'}</div>`;
  },

  ajustes() {
    const a = datos.ajustes;
    return `
      <h1>Ajustes</h1><p class="sub">Datos que aparecen en las facturas.</p>
      <form class="panel" id="form-ajustes" style="max-width:520px">
        <label>Nombre del negocio<input name="negocio" required value="${esc(a.negocio)}"></label>
        <label>NIF / CIF / RUC<input name="nif" value="${esc(a.nif)}"></label>
        <label>Dirección<input name="direccion" value="${esc(a.direccion)}"></label>
        <div class="dos">
          <label>Símbolo de moneda<input name="moneda" required maxlength="4" value="${esc(a.moneda)}"></label>
          <label>IVA (%)<input name="iva" required type="number" min="0" max="100" step="1" value="${a.iva}"></label>
        </div>
        <button class="primario">Guardar ajustes</button>
      </form>`;
  },
};

// ---------- Comportamiento de cada vista ----------
const alMontar = {
  inventario() {
    const pintar = () => {
      const q = $('#buscar').value.toLowerCase();
      const lista = datos.productos.filter((p) => `${p.nombre} ${p.sku} ${p.categoria}`.toLowerCase().includes(q));
      $('#filas').innerHTML = lista.length ? lista.map((p) => {
        const est = estadoStock(p);
        const margen = p.precio ? Math.round(((p.precio / (1 + datos.ajustes.iva / 100) - p.costo) / (p.precio / (1 + datos.ajustes.iva / 100))) * 100) : 0;
        return `<tr><td class="mono">${esc(p.sku)}</td><td>${esc(p.nombre)}</td><td>${esc(p.categoria)}</td>
          <td class="num"><span class="chip ${est}">${p.stock} uds · ${ESTADOS[est]}</span></td>
          <td class="num">${dinero(p.costo)}</td><td class="num">${dinero(p.precio)}</td><td class="num">${margen}%</td>
          <td class="num"><button data-editar="${p.id}">Editar</button></td></tr>`;
      }).join('') : `<tr><td colspan="8" class="vacio">${datos.productos.length ? 'Sin resultados.' : 'Aún no hay productos. Crea el primero con “+ Nuevo producto”.'}</td></tr>`;
    };
    $('#buscar').oninput = pintar;
    $('#nuevo-producto').onclick = () => formularioProducto();
    $('#filas').onclick = (e) => e.target.dataset.editar && formularioProducto(datos.productos.find((p) => p.id === e.target.dataset.editar));
    $('#exportar-productos').onclick = () => exportar('Productos', ['SKU', 'Producto', 'Categoría', 'Stock', 'Mínimo', 'Costo', 'Precio'],
      datos.productos.map((p) => [p.sku, p.nombre, p.categoria, p.stock, p.minimo, p.costo / 100, p.precio / 100]));
    pintar();
  },

  venta() {
    const pintarRejilla = () => {
      const q = $('#buscar').value.toLowerCase();
      const lista = datos.productos.filter((p) => `${p.nombre} ${p.sku}`.toLowerCase().includes(q));
      $('#rejilla').innerHTML = lista.length ? lista.map((p) => {
        const est = estadoStock(p);
        return `<button class="producto" data-id="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>
          <span class="chip ${est}">${esc(p.sku)} · Stock: ${p.stock}</span><b>${esc(p.nombre)}</b><span class="precio">${dinero(p.precio)}</span></button>`;
      }).join('') : `<p class="vacio">${datos.productos.length ? 'Sin resultados.' : 'Primero crea productos en Inventario.'}</p>`;
    };
    const pintarTicket = () => {
      const { total, base, cuota } = totalesTicket(ticket, datos.ajustes.iva);
      $('#ticket').innerHTML = `
        <h2>Ticket en curso</h2>
        <label>Cliente<input id="cliente" placeholder="Cliente mostrador" value="${esc(pintarTicket.cliente || '')}"></label>
        ${ticket.length ? ticket.map((l, i) => `<div class="linea"><div>${esc(l.nombre)}<br><small class="mono">${dinero(l.precio)} / ud</small></div>
          <div class="cantidad"><button data-menos="${i}" aria-label="Quitar uno">−</button><span class="mono">${l.cantidad}</span><button data-mas="${i}" aria-label="Añadir uno">+</button></div>
          <b class="mono">${dinero(l.precio * l.cantidad)}</b></div>`).join('') : '<p class="vacio">Ticket vacío</p>'}
        <div class="totales"><div><span>Base imponible</span><span>${dinero(base)}</span></div><div><span>IVA (${datos.ajustes.iva}%)</span><span>${dinero(cuota)}</span></div></div>
        <div class="total-cobrar"><small>TOTAL A COBRAR</small><b>${dinero(total)}</b></div>
        <div class="metodos">${['Efectivo', 'Tarjeta', 'Transferencia'].map((m) => `<button data-metodo="${m}" class="${m === metodoPago ? 'activo' : ''}">${m}</button>`).join('')}</div>
        <button class="primario" id="cobrar" style="width:100%" ${ticket.length ? '' : 'disabled'}>Cobrar y generar factura</button>
        <button id="vaciar" style="width:100%;margin-top:6px" ${ticket.length ? '' : 'disabled'}>Vaciar ticket</button>`;
    };
    $('#buscar').oninput = pintarRejilla;
    $('#rejilla').onclick = (e) => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      const p = datos.productos.find((x) => x.id === b.dataset.id);
      const l = ticket.find((x) => x.productoId === p.id);
      if ((l ? l.cantidad : 0) >= p.stock) return avisar(`No hay más stock de ${p.nombre}.`, true);
      if (l) l.cantidad++;
      else ticket.push({ productoId: p.id, sku: p.sku, nombre: p.nombre, precio: p.precio, cantidad: 1 });
      pintarTicket();
    };
    $('#ticket').oninput = (e) => e.target.id === 'cliente' && (pintarTicket.cliente = e.target.value);
    $('#ticket').onclick = async (e) => {
      const d = e.target.dataset;
      if (d.mas) {
        const l = ticket[d.mas];
        const p = datos.productos.find((x) => x.id === l.productoId);
        if (l.cantidad >= p.stock) return avisar(`No hay más stock de ${p.nombre}.`, true);
        l.cantidad++;
      } else if (d.menos) {
        if (--ticket[d.menos].cantidad === 0) ticket.splice(d.menos, 1);
      } else if (d.metodo) metodoPago = d.metodo;
      else if (e.target.id === 'vaciar') ticket = [];
      else if (e.target.id === 'cobrar') {
        try {
          const r = registrarVenta(datos, ticket, { metodo: metodoPago, cliente: pintarTicket.cliente });
          if (!(await guardar(r.datos))) return;
          ticket = [];
          pintarTicket.cliente = '';
          avisar(`Venta registrada: ${r.venta.numero}`);
          pintarRejilla();
          actualizarContador();
        } catch (err) {
          return avisar(err.message, true);
        }
      } else return;
      pintarTicket();
    };
    pintarRejilla();
    pintarTicket();
  },

  ventas() {
    $('#vista').onclick = (e) => {
      const v = datos.ventas.find((x) => x.id === e.target.dataset.pdf);
      if (v) window.api.facturaPdf({ nombre: v.numero, html: htmlFactura(v) }).then((r) => r && avisar('Factura guardada'));
    };
    const b = $('#exportar-ventas');
    b.onclick = () => exportar('Ventas', ['Factura', 'Fecha', 'Cliente', 'Método', 'Base', 'IVA', 'Total'],
      datos.ventas.map((v) => [v.numero, fecha(v.fecha), v.cliente, v.metodo, v.base / 100, v.cuota / 100, v.total / 100]));
  },

  ajustes() {
    $('#form-ajustes').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const iva = Number(f.iva);
      if (!Number.isInteger(iva) || iva < 0 || iva > 100) return avisar('IVA no válido.', true);
      if (await guardar({ ...datos, ajustes: { negocio: f.negocio.trim(), nif: f.nif.trim(), direccion: f.direccion.trim(), moneda: f.moneda.trim(), iva } })) {
        $('#nombre-negocio').textContent = datos.ajustes.negocio.toUpperCase();
        avisar('Ajustes guardados');
      }
    };
  },
};

// ---------- Utilidades de pantalla ----------
function formularioProducto(p) {
  const dlg = $('#dialogo');
  dlg.innerHTML = `
    <form method="dialog" id="form-producto">
      <h2>${p ? 'Editar producto' : 'Nuevo producto'}</h2>
      <div class="dos">
        <label>Nombre<input name="nombre" required value="${esc(p?.nombre)}"></label>
        <label>SKU / Código<input name="sku" required value="${esc(p?.sku)}"></label>
        <label>Categoría<input name="categoria" value="${esc(p?.categoria)}"></label>
        <label>Stock actual<input name="stock" type="number" min="0" step="1" required value="${p?.stock ?? 0}"></label>
        <label>Costo de compra<input name="costo" inputmode="decimal" required value="${p ? decimal(p.costo) : ''}" placeholder="0,00"></label>
        <label>Precio de venta (IVA incl.)<input name="precio" inputmode="decimal" required value="${p ? decimal(p.precio) : ''}" placeholder="0,00"></label>
        <label>Stock mínimo (alerta)<input name="minimo" type="number" min="0" step="1" required value="${p?.minimo ?? 0}"></label>
      </div>
      <p class="error" id="error-producto"></p>
      <div class="acciones" style="justify-content:space-between">
        ${p ? '<button type="button" class="peligro" id="borrar">Eliminar</button>' : '<span></span>'}
        <div class="acciones"><button type="button" id="cancelar">Cancelar</button><button class="primario">Guardar</button></div>
      </div>
    </form>`;
  dlg.showModal();
  $('#cancelar').onclick = () => dlg.close();
  if (p) $('#borrar').onclick = async () => {
    if (!confirm(`¿Eliminar "${p.nombre}"? Las facturas ya emitidas no cambian.`)) return;
    if (await guardar({ ...datos, productos: datos.productos.filter((x) => x.id !== p.id) })) { dlg.close(); ir(); }
  };
  $('#form-producto').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const nuevo = {
      id: p?.id || 'p' + Date.now().toString(36),
      nombre: f.nombre.trim(), sku: f.sku.trim(), categoria: f.categoria.trim(),
      costo: aCentimos(f.costo), precio: aCentimos(f.precio), stock: Number(f.stock), minimo: Number(f.minimo),
    };
    const error = validarProducto(nuevo, datos.productos);
    if (error) return ($('#error-producto').textContent = error);
    const productos = p ? datos.productos.map((x) => (x.id === p.id ? nuevo : x)) : [...datos.productos, nuevo];
    if (await guardar({ ...datos, productos })) { dlg.close(); avisar('Producto guardado'); ir(); }
  };
}

async function exportar(nombre, columnas, filas) {
  try {
    const r = await window.api.exportarExcel({ nombre, columnas, filas });
    if (r) avisar('Excel guardado');
  } catch (e) {
    avisar('No se pudo exportar: ' + e.message, true);
  }
}

function htmlFactura(v) {
  const a = datos.ajustes;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font:13px Arial,sans-serif;color:#111;margin:40px} h1{margin:0;color:#b45309} table{width:100%;border-collapse:collapse;margin-top:24px}
    th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left} .n{text-align:right} .tot td{border:0} .grande{font-size:18px;font-weight:bold}
    .cab{display:flex;justify-content:space-between}</style></head><body>
    <div class="cab"><div><h1>${esc(a.negocio)}</h1><div>${esc(a.nif)}</div><div>${esc(a.direccion)}</div></div>
    <div class="n"><b>FACTURA SIMPLIFICADA</b><div>${v.numero}</div><div>${fecha(v.fecha)}</div></div></div>
    <p>Cliente: <b>${esc(v.cliente)}</b> · Pago: ${esc(v.metodo)}</p>
    <table><tr><th>Producto</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Importe</th></tr>
    ${v.lineas.map((l) => `<tr><td>${esc(l.nombre)} <small>(${esc(l.sku)})</small></td><td class="n">${l.cantidad}</td><td class="n">${dinero(l.precio)}</td><td class="n">${dinero(l.precio * l.cantidad)}</td></tr>`).join('')}
    <tr class="tot"><td colspan="3" class="n">Base imponible</td><td class="n">${dinero(v.base)}</td></tr>
    <tr class="tot"><td colspan="3" class="n">IVA ${v.iva}%</td><td class="n">${dinero(v.cuota)}</td></tr>
    <tr class="tot grande"><td colspan="3" class="n">TOTAL</td><td class="n">${dinero(v.total)}</td></tr></table>
    <p style="margin-top:40px;color:#666">Gracias por su compra.</p></body></html>`;
}

function actualizarContador() {
  $('#contador-productos').textContent = datos.productos.length;
}

function ir() {
  const vista = vistas[location.hash.slice(1)] ? location.hash.slice(1) : 'resumen';
  $('#vista').onclick = null;
  $('#vista').innerHTML = vistas[vista]();
  alMontar[vista]?.();
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('activo', a.dataset.vista === vista));
  actualizarContador();
}

(async () => {
  datos = (await window.api.leerDatos()) || datosIniciales();
  $('#nombre-negocio').textContent = datos.ajustes.negocio.toUpperCase();
  window.addEventListener('hashchange', ir);
  ir();
})();
