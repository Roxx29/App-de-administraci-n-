/* global t, fijarIdioma, htmlFactura, fijarTraductor, normalizar, facturaInicial, CATEGORIAS_GASTO, diaLocal, validarGasto, informe, serieMensual, totalesTicket, aCentimos, formatoDinero, validarProducto, estadoStock, registrarVenta, resumen */
let datos;
let ticket = []; // líneas del ticket en curso
let metodoPago = 'Efectivo';
let periodo = 'mes'; // periodo elegido en Informes

const $ = (s) => document.querySelector(s);
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const locale = () => (datos.ajustes.idioma === 'en' ? 'en-US' : 'es-ES');
const dinero = (c) => formatoDinero(c, datos.ajustes.moneda, locale());
const decimal = (c) => (c / 100).toFixed(2);
const fecha = (iso) => new Date(iso).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });
const fechaDia = (dia) => new Date(dia + 'T00:00').toLocaleDateString(locale());
const ESTADOS = { ok: 'Óptimo', bajo: 'Stock bajo', agotado: 'Agotado' };
const conImagenes = () => datos.ajustes.imagenes;
const miniatura = (p, clase) => (p.imagen ? `<img class="${clase}" src="${p.imagen}" alt="">` : `<span class="${clase} sin-imagen" aria-hidden="true">▣</span>`);
const opciones = (lista, actual) => lista.map((v) => `<option value="${esc(v)}" ${v === actual ? 'selected' : ''}>${esc(t(v))}</option>`).join('');

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
    avisar(t('No se pudo guardar: {e}', { e: e.message }), true);
    return false;
  }
}

// Redimensiona la imagen elegida y la devuelve como data URL para guardarla en los datos.
// shortcut: las imágenes van dentro de datos.json; con miles de productos conviene guardarlas como archivos aparte.
function leerImagen(archivo, max, tipo) {
  return new Promise((ok, mal) => {
    if (!archivo.type.startsWith('image/')) return mal(new Error(t('El archivo no es una imagen.')));
    if (archivo.size > 10 * 1024 * 1024) return mal(new Error(t('La imagen pesa más de 10 MB.')));
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      ok(c.toDataURL(tipo, 0.85));
    };
    img.onerror = () => mal(new Error(t('No se pudo leer la imagen.')));
    img.src = URL.createObjectURL(archivo);
  });
}

// ---------- Vistas ----------
const vistas = {
  resumen() {
    const r = resumen(datos);
    const ultimas = datos.ventas.slice(-5).reverse();
    return `
      <h1>${t('Resumen Diario')}</h1><p class="sub">${new Date().toLocaleDateString(locale(), { dateStyle: 'full' })}</p>
      <div class="tarjetas">
        <div class="tarjeta"><small>${t('Ventas de hoy')}</small><div class="valor">${dinero(r.ventasHoy)}</div><small>${t('{n} tickets', { n: r.ticketsHoy })}</small></div>
        <div class="tarjeta"><small>${t('Ventas totales')}</small><div class="valor">${dinero(r.ventasTotal)}</div><small>${t('{n} facturas', { n: datos.ventas.length })}</small></div>
        <div class="tarjeta"><small>${t('Valor inventario (costo)')}</small><div class="valor">${dinero(r.valorInventario)}</div><small>${t('{n} productos', { n: datos.productos.length })}</small></div>
        <div class="tarjeta"><small>${t('Alertas de stock')}</small><div class="valor ${r.alertas.length ? 'bajo' : 'ok'}">${r.alertas.length}</div><small>${t('bajo mínimo o agotados')}</small></div>
      </div>
      <div class="tarjetas">
        <div class="panel"><h2>${t('Productos por reponer')}</h2>${r.alertas.length ? `<table>${r.alertas.map((p) => `<tr><td>${esc(p.nombre)}</td><td class="num"><span class="chip ${estadoStock(p)}">${t('{n} uds', { n: p.stock })}</span></td></tr>`).join('')}</table>` : `<p class="vacio">${t('Todo en orden.')}</p>`}</div>
        <div class="panel"><h2>${t('Últimas ventas')}</h2>${ultimas.length ? `<table>${ultimas.map((v) => `<tr><td class="mono">${v.numero}</td><td>${fecha(v.fecha)}</td><td class="num">${dinero(v.total)}</td></tr>`).join('')}</table>` : `<p class="vacio">${t('Aún no hay ventas.')}</p>`}</div>
      </div>`;
  },

  inventario() {
    return `
      <div class="cabecera"><div><h1>${t('Inventario & Catálogo')}</h1><p class="sub">${t('{n} productos', { n: datos.productos.length })}</p></div>
        <div class="acciones"><button id="exportar-productos">${t('Exportar a Excel')}</button><button class="primario" id="nuevo-producto">${t('+ Nuevo producto')}</button></div></div>
      <input class="buscador" id="buscar" placeholder="${t('Buscar por nombre, SKU o categoría…')}" aria-label="${t('Buscar productos')}">
      <div class="panel"><table>
        <thead><tr>${conImagenes() ? '<th></th>' : ''}<th>SKU</th><th>${t('Producto')}</th><th>${t('Categoría')}</th><th class="num">${t('Existencias')}</th><th class="num">${t('Costo')}</th><th class="num">${t('Precio (IVA incl.)')}</th><th class="num">${t('Margen')}</th><th></th></tr></thead>
        <tbody id="filas"></tbody></table></div>`;
  },

  venta() {
    return `
      <h1>${t('Punto de Venta')}</h1><p class="sub">${t('Haz clic en un producto para añadirlo al ticket.')}</p>
      <div class="pos">
        <div><input class="buscador" id="buscar" placeholder="${t('Buscar producto o SKU…')}" aria-label="${t('Buscar productos')}"><div class="rejilla" id="rejilla"></div></div>
        <div class="panel" id="ticket"></div>
      </div>`;
  },

  ventas() {
    const lista = datos.ventas.slice().reverse();
    return `
      <div class="cabecera"><div><h1>${t('Ventas & Facturas')}</h1><p class="sub">${t('{n} facturas emitidas', { n: datos.ventas.length })}</p></div>
        <div class="acciones"><button id="exportar-ventas" ${lista.length ? '' : 'disabled'}>${t('Exportar a Excel')}</button></div></div>
      <div class="panel">${lista.length ? `<table>
        <thead><tr><th>${t('Factura')}</th><th>${t('Fecha')}</th><th>${t('Cliente')}</th><th>${t('Método')}</th><th class="num">${t('Artículos')}</th><th class="num">${t('Total')}</th><th></th></tr></thead>
        <tbody>${lista.map((v) => `<tr><td class="mono">${v.numero}</td><td>${fecha(v.fecha)}</td><td>${esc(v.cliente)}</td><td>${esc(t(v.metodo))}</td>
          <td class="num">${v.lineas.reduce((s, l) => s + l.cantidad, 0)}</td><td class="num">${dinero(v.total)}</td>
          <td class="num"><button data-pdf="${v.id}">${t('Factura PDF')}</button></td></tr>`).join('')}</tbody></table>` : `<p class="vacio">${t('Aún no hay ventas. Registra la primera en el Punto de Venta.')}</p>`}</div>`;
  },

  gastos() {
    const lista = datos.gastos.slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
    const mes = diaLocal(new Date()).slice(0, 7);
    const delMes = datos.gastos.filter((g) => g.fecha.startsWith(mes)).reduce((s, g) => s + g.importe, 0);
    return `
      <div class="cabecera"><div><h1>${t('Gastos Operativos')}</h1><p class="sub">${t('Este mes')}: <b class="mono">${dinero(delMes)}</b> · ${t('{n} gastos registrados', { n: datos.gastos.length })}</p></div>
        <div class="acciones"><button id="exportar-gastos" ${lista.length ? '' : 'disabled'}>${t('Exportar a Excel')}</button><button class="primario" id="nuevo-gasto">${t('+ Nuevo gasto')}</button></div></div>
      <div class="panel">${lista.length ? `<table>
        <thead><tr><th>${t('Fecha')}</th><th>${t('Concepto')}</th><th>${t('Categoría')}</th><th>${t('Método')}</th><th class="num">${t('Importe')}</th><th></th></tr></thead>
        <tbody>${lista.map((g) => `<tr><td class="mono">${fechaDia(g.fecha)}</td><td>${esc(g.concepto)}</td><td>${esc(t(g.categoria))}</td><td>${esc(t(g.metodo))}</td>
          <td class="num">${dinero(g.importe)}</td><td class="num"><button data-editar="${g.id}">${t('Editar')}</button></td></tr>`).join('')}</tbody></table>`
        : `<p class="vacio">${t('Aún no hay gastos. Registra alquiler, proveedores, luz… para ver la rentabilidad real en Informes.')}</p>`}</div>`;
  },

  informes() {
    const [desde, hasta] = rangoPeriodo();
    const r = informe(datos, desde, hasta);
    const serie = serieMensual(datos, 6, new Date(), locale());
    const maxSerie = Math.max(1, ...serie.flatMap((m) => [m.ingresos, m.costes]));
    const maxCat = Math.max(1, ...r.porCategoria.map((c) => c[1]));
    const periodos = { mes: 'Este mes', anterior: 'Mes anterior', anio: 'Este año', todo: 'Todo' };
    const rango = periodo === 'todo' ? t('Todo el historial') : t('Del {d} al {h}', { d: fechaDia(desde), h: fechaDia(hasta) });
    return `
      <div class="cabecera"><div><h1>${t('Informes & Rentabilidad')}</h1><p class="sub">${rango} · ${t('importes sin IVA')}</p></div>
        <div class="acciones">${Object.entries(periodos).map(([k, v]) => `<button data-periodo="${k}" class="${k === periodo ? 'activo-periodo' : ''}">${t(v)}</button>`).join('')}
        <button class="primario" id="exportar-informe">${t('Exportar a Excel')}</button></div></div>
      <div class="tarjetas">
        <div class="tarjeta"><small>${t('Beneficio neto')}</small><div class="valor ${r.beneficio < 0 ? 'agotado' : 'ok'}">${dinero(r.beneficio)}</div><small>${t('Margen neto {m}%', { m: r.margen })}</small></div>
        <div class="tarjeta"><small>${t('Ingresos (sin IVA)')}</small><div class="valor">${dinero(r.ingresos)}</div><small>${t('{n} tickets', { n: r.tickets })} · ${t('facturado')} ${dinero(r.facturado)}</small></div>
        <div class="tarjeta"><small>${t('Costo mercancía vendida')}</small><div class="valor">${dinero(r.cogs)}</div><small>${t('según costo de compra')}</small></div>
        <div class="tarjeta"><small>${t('Gastos operativos')}</small><div class="valor">${dinero(r.gastos)}</div><small>${t('{n} categorías', { n: r.porCategoria.length })}</small></div>
        <div class="tarjeta"><small>${t('IVA repercutido')}</small><div class="valor">${dinero(r.iva)}</div><small>${t('a declarar')}</small></div>
      </div>
      <div class="dos-paneles">
        <div class="panel"><div class="cabecera"><h2>${t('Ingresos vs. costes · últimos 6 meses')}</h2>
          <div class="leyenda"><span><i style="background:var(--serie-1)"></i>${t('Ingresos')}</span><span><i style="background:var(--serie-2)"></i>${t('Costes (mercancía + gastos)')}</span></div></div>
          <div class="grafico" role="img" aria-label="${t('Ingresos y costes por mes')}">
            ${serie.map((m) => `<div class="mes"><div class="barras">
              <div class="barra" style="height:${(m.ingresos / maxSerie) * 100}%;background:var(--serie-1)" title="${m.mes} · ${t('Ingresos')} ${dinero(m.ingresos)}"></div>
              <div class="barra" style="height:${(m.costes / maxSerie) * 100}%;background:var(--serie-2)" title="${m.mes} · ${t('Costes')} ${dinero(m.costes)}"></div>
            </div><small>${m.mes}</small><small class="${m.beneficio < 0 ? 'agotado' : 'ok'}">${dinero(m.beneficio)}</small></div>`).join('')}
          </div></div>
        <div class="panel"><h2>${t('Gastos por categoría')}</h2>${r.porCategoria.length ? r.porCategoria.map(([c, v]) => `
          <div class="categoria"><div class="cabecera"><span>${esc(t(c))}</span><span class="mono">${dinero(v)}</span></div>
          <div class="pista"><div style="width:${(v / maxCat) * 100}%"></div></div></div>`).join('') : `<p class="vacio">${t('Sin gastos en este periodo.')}</p>`}</div>
      </div>
      <div class="panel" style="margin-top:12px"><h2>${t('Rentabilidad por producto')}</h2>${r.topProductos.length ? `<table>
        <thead><tr><th>${t('Producto')}</th><th class="num">${t('Unidades')}</th><th class="num">${t('Ingresos')}</th><th class="num">${t('Costo')}</th><th class="num">${t('Beneficio bruto')}</th><th class="num">${t('Margen')}</th></tr></thead>
        <tbody>${r.topProductos.map((p) => `<tr><td>${esc(p.nombre)} <small class="chip">${esc(p.sku)}</small></td><td class="num">${p.unidades}</td><td class="num">${dinero(p.ingresos)}</td>
          <td class="num">${dinero(p.costo)}</td><td class="num">${dinero(p.ingresos - p.costo)}</td><td class="num">${p.ingresos ? Math.round(((p.ingresos - p.costo) / p.ingresos) * 100) : 0}%</td></tr>`).join('')}</tbody></table>`
        : `<p class="vacio">${t('Sin ventas en este periodo.')}</p>`}</div>`;
  },

  ajustes() {
    const a = datos.ajustes;
    const f = a.factura;
    const casilla = (nombre, valor, texto) => `<label class="casilla"><input type="checkbox" name="${nombre}" ${valor ? 'checked' : ''}> ${t(texto)}</label>`;
    return `
      <div class="cabecera"><div><h1>${t('Ajustes')}</h1><p class="sub">${t('Datos del negocio, apariencia y diseño de las facturas.')}</p></div>
        <div class="acciones"><button class="primario" form="form-ajustes">${t('Guardar ajustes')}</button></div></div>
      <form id="form-ajustes" class="ajustes">
        <div class="columna">
          <section class="panel"><h2>${t('Negocio')}</h2>
            <label>${t('Nombre del negocio')}<input name="negocio" required value="${esc(a.negocio)}"></label>
            <label>${t('NIF / CIF / RUC')}<input name="nif" value="${esc(a.nif)}"></label>
            <label>${t('Dirección')}<input name="direccion" value="${esc(a.direccion)}"></label>
            <div class="dos">
              <label>${t('Símbolo de moneda')}<input name="moneda" required maxlength="4" value="${esc(a.moneda)}"></label>
              <label>${t('IVA (%)')}<input name="iva" required type="number" min="0" max="100" step="1" value="${a.iva}"></label>
            </div>
            <div class="etiqueta-campo">${t('Logo de la empresa')}</div>
            <div class="logo-campo">
              <div class="logo-vista" id="logo-vista">${a.logo ? `<img src="${a.logo}" alt="${t('Logo')}">` : `<small>${t('Sin logo')}</small>`}</div>
              <div class="acciones"><button type="button" id="elegir-logo">${t('Subir logo')}</button><button type="button" class="peligro" id="quitar-logo" ${a.logo ? '' : 'hidden'}>${t('Quitar')}</button></div>
              <input type="file" id="archivo-logo" accept="image/*" hidden>
            </div>
          </section>
          <section class="panel"><h2>${t('Apariencia')}</h2>
            <div class="dos">
              <label>${t('Tema')}<select name="tema">${['oscuro', 'claro'].map((v) => `<option value="${v}" ${v === a.tema ? 'selected' : ''}>${t(v === 'oscuro' ? 'Oscuro' : 'Claro')}</option>`).join('')}</select></label>
              <label>${t('Idioma')}<select name="idioma"><option value="es" ${a.idioma === 'es' ? 'selected' : ''}>Español</option><option value="en" ${a.idioma === 'en' ? 'selected' : ''}>English</option></select></label>
            </div>
          </section>
          <section class="panel"><h2>${t('Productos')}</h2>
            ${casilla('imagenes', a.imagenes, 'Usar imágenes en los productos')}
            <small class="ayuda">${t('Muestra una foto en el inventario y en el punto de venta. Al desactivarlo, las fotos no se borran.')}</small>
          </section>
        </div>
        <section class="panel columna"><h2>${t('Diseño de factura')}</h2>
          <div class="dos">
            <label>${t('Plantilla')}<select name="plantilla">${['clasica', 'moderna', 'minimal'].map((v) => `<option value="${v}" ${v === f.plantilla ? 'selected' : ''}>${t({ clasica: 'Clásica', moderna: 'Moderna', minimal: 'Minimalista' }[v])}</option>`).join('')}</select></label>
            <label>${t('Color principal')}<input name="color" type="color" value="${esc(f.color)}"></label>
            <label>${t('Título del documento')}<input name="titulo" value="${esc(f.titulo)}"></label>
            <label>${t('Posición del logo')}<select name="logoPos">${['izquierda', 'centro', 'derecha'].map((v) => `<option value="${v}" ${v === f.logoPos ? 'selected' : ''}>${t({ izquierda: 'Izquierda', centro: 'Centro', derecha: 'Derecha' }[v])}</option>`).join('')}</select></label>
          </div>
          <label>${t('Texto bajo el encabezado')}<input name="cabecera" value="${esc(f.cabecera)}" placeholder="${t('Ej.: Tel. 600 000 000 · tienda@correo.com')}"></label>
          <label>${t('Mensaje final')}<input name="pie" value="${esc(f.pie)}"></label>
          <label>${t('Notas / condiciones')}<textarea name="notas" rows="2" placeholder="${t('Ej.: Cambios y devoluciones en 15 días con este ticket.')}">${esc(f.notas)}</textarea></label>
          <div class="casillas">${casilla('mostrarLogo', f.mostrarLogo, 'Mostrar logo')}${casilla('mostrarSku', f.mostrarSku, 'Mostrar SKU')}${casilla('mostrarMetodo', f.mostrarMetodo, 'Mostrar método de pago')}</div>
          <div class="cabecera"><div class="etiqueta-campo">${t('Vista previa')}</div><button type="button" id="restablecer-factura">${t('Restablecer diseño')}</button></div>
          <iframe id="vista-factura" title="${t('Vista previa de la factura')}" sandbox></iframe>
        </section>
      </form>`;
  },
};

// ---------- Comportamiento de cada vista ----------
const alMontar = {
  inventario() {
    const pintar = () => {
      const q = $('#buscar').value.toLowerCase();
      const lista = datos.productos.filter((p) => `${p.nombre} ${p.sku} ${p.categoria}`.toLowerCase().includes(q));
      const neto = (c) => c / (1 + datos.ajustes.iva / 100);
      $('#filas').innerHTML = lista.length ? lista.map((p) => {
        const est = estadoStock(p);
        const margen = p.precio ? Math.round(((neto(p.precio) - p.costo) / neto(p.precio)) * 100) : 0;
        return `<tr>${conImagenes() ? `<td>${miniatura(p, 'mini')}</td>` : ''}<td class="mono">${esc(p.sku)}</td><td>${esc(p.nombre)}</td><td>${esc(p.categoria)}</td>
          <td class="num"><span class="chip ${est}">${t('{n} uds', { n: p.stock })} · ${t(ESTADOS[est])}</span></td>
          <td class="num">${dinero(p.costo)}</td><td class="num">${dinero(p.precio)}</td><td class="num">${margen}%</td>
          <td class="num"><button data-editar="${p.id}">${t('Editar')}</button></td></tr>`;
      }).join('') : `<tr><td colspan="9" class="vacio">${datos.productos.length ? t('Sin resultados.') : t('Aún no hay productos. Crea el primero con “+ Nuevo producto”.')}</td></tr>`;
    };
    $('#buscar').oninput = pintar;
    $('#nuevo-producto').onclick = () => formularioProducto();
    $('#filas').onclick = (e) => e.target.dataset.editar && formularioProducto(datos.productos.find((p) => p.id === e.target.dataset.editar));
    $('#exportar-productos').onclick = () => exportar(t('Productos'), ['SKU', t('Producto'), t('Categoría'), 'Stock', t('Mínimo'), t('Costo'), t('Precio')],
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
          ${conImagenes() ? miniatura(p, 'foto') : ''}
          <span class="chip ${est}">${esc(p.sku)} · Stock: ${p.stock}</span><b>${esc(p.nombre)}</b><span class="precio">${dinero(p.precio)}</span></button>`;
      }).join('') : `<p class="vacio">${datos.productos.length ? t('Sin resultados.') : t('Primero crea productos en Inventario.')}</p>`;
    };
    const pintarTicket = () => {
      const { total, base, cuota } = totalesTicket(ticket, datos.ajustes.iva);
      $('#ticket').innerHTML = `
        <h2>${t('Ticket en curso')}</h2>
        <label>${t('Cliente')}<input id="cliente" placeholder="${t('Cliente mostrador')}" value="${esc(pintarTicket.cliente || '')}"></label>
        ${ticket.length ? ticket.map((l, i) => `<div class="linea"><div>${esc(l.nombre)}<br><small class="mono">${dinero(l.precio)} / ${t('ud')}</small></div>
          <div class="cantidad"><button data-menos="${i}" aria-label="${t('Quitar uno')}">−</button><span class="mono">${l.cantidad}</span><button data-mas="${i}" aria-label="${t('Añadir uno')}">+</button></div>
          <b class="mono">${dinero(l.precio * l.cantidad)}</b></div>`).join('') : `<p class="vacio">${t('Ticket vacío')}</p>`}
        <div class="totales"><div><span>${t('Base imponible')}</span><span>${dinero(base)}</span></div><div><span>${t('IVA')} (${datos.ajustes.iva}%)</span><span>${dinero(cuota)}</span></div></div>
        <div class="total-cobrar"><small>${t('TOTAL A COBRAR')}</small><b>${dinero(total)}</b></div>
        <div class="metodos">${['Efectivo', 'Tarjeta', 'Transferencia'].map((m) => `<button data-metodo="${m}" class="${m === metodoPago ? 'activo' : ''}">${t(m)}</button>`).join('')}</div>
        <button class="primario" id="cobrar" style="width:100%" ${ticket.length ? '' : 'disabled'}>${t('Cobrar y generar factura')}</button>
        <button id="vaciar" style="width:100%;margin-top:6px" ${ticket.length ? '' : 'disabled'}>${t('Vaciar ticket')}</button>`;
    };
    $('#buscar').oninput = pintarRejilla;
    $('#rejilla').onclick = (e) => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      const p = datos.productos.find((x) => x.id === b.dataset.id);
      const l = ticket.find((x) => x.productoId === p.id);
      if ((l ? l.cantidad : 0) >= p.stock) return avisar(t('No hay más stock de {n}.', { n: p.nombre }), true);
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
        if (l.cantidad >= p.stock) return avisar(t('No hay más stock de {n}.', { n: p.nombre }), true);
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
          avisar(t('Venta registrada: {n}', { n: r.venta.numero }));
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
      if (v) window.api.facturaPdf({ nombre: v.numero, html: factura(v, datos.ajustes) }).then((r) => r && avisar(t('Factura guardada')));
    };
    $('#exportar-ventas').onclick = () => exportar(t('Ventas'), [t('Factura'), t('Fecha'), t('Cliente'), t('Método'), t('Base'), t('IVA'), t('Total')],
      datos.ventas.map((v) => [v.numero, fecha(v.fecha), v.cliente, t(v.metodo), v.base / 100, v.cuota / 100, v.total / 100]));
  },

  gastos() {
    $('#nuevo-gasto').onclick = () => formularioGasto();
    $('#vista').onclick = (e) => e.target.dataset.editar && formularioGasto(datos.gastos.find((g) => g.id === e.target.dataset.editar));
    $('#exportar-gastos').onclick = () => exportar(t('Gastos'), [t('Fecha'), t('Concepto'), t('Categoría'), t('Método'), t('Importe')],
      datos.gastos.map((g) => [g.fecha, g.concepto, t(g.categoria), t(g.metodo), g.importe / 100]));
  },

  informes() {
    $('#vista').onclick = (e) => {
      if (!e.target.dataset.periodo) return;
      periodo = e.target.dataset.periodo;
      ir();
    };
    $('#exportar-informe').onclick = () => {
      const [desde, hasta] = rangoPeriodo();
      const r = informe(datos, desde, hasta);
      exportar(t('Informe'), [t('Concepto'), t('Importe')], [
        [t('Desde'), desde], [t('Hasta'), hasta], [t('Tickets'), r.tickets], [t('Facturado (IVA incl.)'), r.facturado / 100], [t('IVA repercutido'), r.iva / 100],
        [t('Ingresos (sin IVA)'), r.ingresos / 100], [t('Costo mercancía vendida'), r.cogs / 100], [t('Gastos operativos'), r.gastos / 100], [t('Beneficio neto'), r.beneficio / 100], [t('Margen neto %'), r.margen],
      ], [
        { nombre: t('Productos'), columnas: ['SKU', t('Producto'), t('Unidades'), t('Ingresos'), t('Costo'), t('Beneficio')], filas: r.topProductos.map((p) => [p.sku, p.nombre, p.unidades, p.ingresos / 100, p.costo / 100, (p.ingresos - p.costo) / 100]) },
        { nombre: t('Gastos por categoría'), columnas: [t('Categoría'), t('Importe')], filas: r.porCategoria.map(([c, v]) => [t(c), v / 100]) },
      ]);
    };
  },

  ajustes() {
    const form = $('#form-ajustes');
    let logo = datos.ajustes.logo;
    const leerForm = () => {
      const f = Object.fromEntries(new FormData(form));
      const marcado = (n) => form.elements[n].checked;
      return {
        negocio: f.negocio.trim(), nif: f.nif.trim(), direccion: f.direccion.trim(), moneda: f.moneda.trim(), iva: Number(f.iva),
        tema: f.tema, idioma: f.idioma, imagenes: marcado('imagenes'), logo,
        factura: {
          titulo: f.titulo.trim(), color: f.color, plantilla: f.plantilla, logoPos: f.logoPos,
          mostrarLogo: marcado('mostrarLogo'), mostrarSku: marcado('mostrarSku'), mostrarMetodo: marcado('mostrarMetodo'),
          cabecera: f.cabecera.trim(), pie: f.pie.trim(), notas: f.notas.trim(),
        },
      };
    };
    const previa = () => ($('#vista-factura').srcdoc = factura(ventaEjemplo(), leerForm()));
    form.oninput = previa;
    $('#elegir-logo').onclick = () => $('#archivo-logo').click();
    $('#archivo-logo').onchange = async (e) => {
      try {
        logo = await leerImagen(e.target.files[0], 400, 'image/png');
        $('#logo-vista').innerHTML = `<img src="${logo}" alt="${t('Logo')}">`;
        $('#quitar-logo').hidden = false;
        previa();
      } catch (err) {
        avisar(err.message, true);
      }
    };
    $('#quitar-logo').onclick = () => {
      logo = '';
      $('#logo-vista').innerHTML = `<small>${t('Sin logo')}</small>`;
      $('#quitar-logo').hidden = true;
      previa();
    };
    $('#restablecer-factura').onclick = () => {
      const ini = facturaInicial();
      for (const [k, v] of Object.entries(ini)) {
        const campo = form.elements[k];
        if (campo.type === 'checkbox') campo.checked = v;
        else campo.value = v;
      }
      previa();
    };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const nuevos = leerForm();
      if (!Number.isInteger(nuevos.iva) || nuevos.iva < 0 || nuevos.iva > 100) return avisar(t('IVA no válido.'), true);
      if (await guardar({ ...datos, ajustes: nuevos })) {
        aplicarAjustes();
        ir();
        avisar(t('Ajustes guardados'));
      }
    };
    previa();
  },
};

// ---------- Utilidades de pantalla ----------
function factura(venta, ajustes) {
  return htmlFactura(venta, ajustes, { t, esc, dinero: (c) => formatoDinero(c, ajustes.moneda, locale()), fecha });
}

function ventaEjemplo() {
  const lineas = [{ sku: 'SKU-0001', nombre: t('Producto de ejemplo'), precio: 4625, cantidad: 2 }, { sku: 'SKU-0002', nombre: t('Otro producto'), precio: 1240, cantidad: 1 }];
  return { numero: `FAC-${new Date().getFullYear()}-0001`, fecha: new Date().toISOString(), cliente: t('Cliente mostrador'), metodo: 'Efectivo', iva: datos.ajustes.iva, lineas, ...totalesTicket(lineas, datos.ajustes.iva) };
}

function rangoPeriodo() {
  const h = new Date();
  if (periodo === 'anterior') return [diaLocal(new Date(h.getFullYear(), h.getMonth() - 1, 1)), diaLocal(new Date(h.getFullYear(), h.getMonth(), 0))];
  if (periodo === 'anio') return [`${h.getFullYear()}-01-01`, `${h.getFullYear()}-12-31`];
  if (periodo === 'todo') return ['0000-01-01', '9999-12-31'];
  return [diaLocal(new Date(h.getFullYear(), h.getMonth(), 1)), diaLocal(new Date(h.getFullYear(), h.getMonth() + 1, 0))];
}

function formularioProducto(p) {
  const dlg = $('#dialogo');
  let imagen = p?.imagen || '';
  dlg.innerHTML = `
    <form method="dialog" id="form-producto">
      <h2>${p ? t('Editar producto') : t('Nuevo producto')}</h2>
      ${conImagenes() ? `<div class="foto-campo"><div id="foto-vista">${miniatura({ imagen }, 'foto-grande')}</div>
        <div class="acciones"><button type="button" id="elegir-foto">${t('Elegir imagen')}</button><button type="button" class="peligro" id="quitar-foto" ${imagen ? '' : 'hidden'}>${t('Quitar')}</button></div>
        <input type="file" id="archivo-foto" accept="image/*" hidden></div>` : ''}
      <div class="dos">
        <label>${t('Nombre')}<input name="nombre" required value="${esc(p?.nombre)}"></label>
        <label>${t('SKU / Código')}<input name="sku" required value="${esc(p?.sku)}"></label>
        <label>${t('Categoría')}<input name="categoria" value="${esc(p?.categoria)}"></label>
        <label>${t('Stock actual')}<input name="stock" type="number" min="0" step="1" required value="${p?.stock ?? 0}"></label>
        <label>${t('Costo de compra')}<input name="costo" inputmode="decimal" required value="${p ? decimal(p.costo) : ''}" placeholder="0,00"></label>
        <label>${t('Precio de venta (IVA incl.)')}<input name="precio" inputmode="decimal" required value="${p ? decimal(p.precio) : ''}" placeholder="0,00"></label>
        <label>${t('Stock mínimo (alerta)')}<input name="minimo" type="number" min="0" step="1" required value="${p?.minimo ?? 0}"></label>
      </div>
      <p class="error" id="error-producto"></p>
      <div class="acciones" style="justify-content:space-between">
        ${p ? `<button type="button" class="peligro" id="borrar">${t('Eliminar')}</button>` : '<span></span>'}
        <div class="acciones"><button type="button" id="cancelar">${t('Cancelar')}</button><button class="primario">${t('Guardar')}</button></div>
      </div>
    </form>`;
  dlg.showModal();
  $('#cancelar').onclick = () => dlg.close();
  if (conImagenes()) {
    const pintarFoto = () => {
      $('#foto-vista').innerHTML = miniatura({ imagen }, 'foto-grande');
      $('#quitar-foto').hidden = !imagen;
    };
    $('#elegir-foto').onclick = () => $('#archivo-foto').click();
    $('#archivo-foto').onchange = async (e) => {
      try {
        imagen = await leerImagen(e.target.files[0], 320, 'image/jpeg');
        pintarFoto();
      } catch (err) {
        $('#error-producto').textContent = err.message;
      }
    };
    $('#quitar-foto').onclick = () => {
      imagen = '';
      pintarFoto();
    };
  }
  if (p) $('#borrar').onclick = async () => {
    if (!confirm(t('¿Eliminar "{n}"? Las facturas ya emitidas no cambian.', { n: p.nombre }))) return;
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
    if (imagen) nuevo.imagen = imagen;
    const error = validarProducto(nuevo, datos.productos);
    if (error) return ($('#error-producto').textContent = error);
    const productos = p ? datos.productos.map((x) => (x.id === p.id ? nuevo : x)) : [...datos.productos, nuevo];
    if (await guardar({ ...datos, productos })) { dlg.close(); avisar(t('Producto guardado')); ir(); }
  };
}

function formularioGasto(g) {
  const dlg = $('#dialogo');
  dlg.innerHTML = `
    <form method="dialog" id="form-gasto">
      <h2>${g ? t('Editar gasto') : t('Nuevo gasto')}</h2>
      <label>${t('Concepto')}<input name="concepto" required value="${esc(g?.concepto)}" placeholder="${t('Ej.: Alquiler octubre')}"></label>
      <div class="dos">
        <label>${t('Fecha')}<input name="fecha" type="date" required value="${g?.fecha || diaLocal(new Date())}"></label>
        <label>${t('Importe (IVA incl.)')}<input name="importe" inputmode="decimal" required value="${g ? decimal(g.importe) : ''}" placeholder="0,00"></label>
        <label>${t('Categoría')}<select name="categoria">${opciones(CATEGORIAS_GASTO, g?.categoria)}</select></label>
        <label>${t('Método de pago')}<select name="metodo">${opciones(['Transferencia', 'Tarjeta', 'Efectivo', 'Domiciliación'], g?.metodo)}</select></label>
      </div>
      <p class="error" id="error-gasto"></p>
      <div class="acciones" style="justify-content:space-between">
        ${g ? `<button type="button" class="peligro" id="borrar">${t('Eliminar')}</button>` : '<span></span>'}
        <div class="acciones"><button type="button" id="cancelar">${t('Cancelar')}</button><button class="primario">${t('Guardar')}</button></div>
      </div>
    </form>`;
  dlg.showModal();
  $('#cancelar').onclick = () => dlg.close();
  if (g) $('#borrar').onclick = async () => {
    if (!confirm(t('¿Eliminar el gasto "{n}"?', { n: g.concepto }))) return;
    if (await guardar({ ...datos, gastos: datos.gastos.filter((x) => x.id !== g.id) })) { dlg.close(); ir(); }
  };
  $('#form-gasto').onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const nuevo = { id: g?.id || 'g' + Date.now().toString(36), concepto: f.concepto.trim(), fecha: f.fecha, categoria: f.categoria, metodo: f.metodo, importe: aCentimos(f.importe) };
    const error = validarGasto(nuevo);
    if (error) return ($('#error-gasto').textContent = error);
    const gastos = g ? datos.gastos.map((x) => (x.id === g.id ? nuevo : x)) : [...datos.gastos, nuevo];
    if (await guardar({ ...datos, gastos })) { dlg.close(); avisar(t('Gasto guardado')); ir(); }
  };
}

async function exportar(nombre, columnas, filas, otrasHojas = []) {
  try {
    const r = await window.api.exportarExcel({ nombre, hojas: [{ nombre, columnas, filas }, ...otrasHojas] });
    if (r) avisar(t('Excel guardado'));
  } catch (e) {
    avisar(t('No se pudo exportar: {e}', { e: e.message }), true);
  }
}

function actualizarContador() {
  $('#contador-productos').textContent = datos.productos.length;
}

// Tema, idioma, logo y menú lateral según los ajustes guardados.
function aplicarAjustes() {
  const a = datos.ajustes;
  document.documentElement.dataset.tema = a.tema;
  document.documentElement.lang = a.idioma;
  fijarIdioma(a.idioma);
  $('#nombre-negocio').textContent = a.negocio.toUpperCase();
  $('#logo').innerHTML = a.logo ? `<img src="${a.logo}" alt="">` : '▣';
  $('#logo').classList.toggle('con-imagen', !!a.logo);
  $('#estado-local').textContent = '● ' + t('Guardado local');
  const menu = [['resumen', 'Resumen Diario'], ['inventario', 'Inventario & Catálogo'], ['venta', 'Punto de Venta'], ['ventas', 'Ventas & Facturas'], ['gastos', 'Gastos Operativos'], ['informes', 'Informes & Rentabilidad'], ['ajustes', 'Ajustes']];
  $('nav').innerHTML = menu.map(([v, texto]) => `<a href="#${v}" data-vista="${v}">${esc(t(texto))}${v === 'inventario' ? ' <span class="chip" id="contador-productos">0</span>' : ''}</a>`).join('');
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
  fijarTraductor(t);
  datos = normalizar(await window.api.leerDatos());
  aplicarAjustes();
  window.addEventListener('hashchange', ir);
  ir();
})();
