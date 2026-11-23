/* RF08 — MIS CUPONES (Figma 27:331 / 40:941): los cupones que el peatón ya obtuvo (GET /api/cupones/mios), cada uno con chevron
   a su detalle: título, vigencia, negocio y el código personal (FARO-XXXXXX) en grande con su QR.
   Los cupones llegan solos al aceptar una ruta Faro (ruta.js) o al pulsar "Obtener" en la ficha de un Faro.        */
(function () {
  "use strict";
  const { h, $ } = App;
  let mios = [];                      // cupones obtenidos (los más recientes primero)
  const tengo = (id) => mios.some((m) => m.cupon_id === id);

  async function leer() { mios = await Faro.get("/api/cupones/mios"); return mios; }
  const precargar = () => leer().catch(() => { /* sin conexión: se vuelve a intentar al abrir la lista */ });

  /** Pide el cupón (el servidor devuelve el mismo código mientras no se haya canjeado). */
  async function obtenerEnSilencio(id) {
    const r = await Faro.post(`/api/cupones/${id}/obtener`);
    await precargar();
    return r;
  }
  async function obtener(id) {
    try {
      const r = await obtenerEnSilencio(id);
      const m = mios.find((x) => x.codigo === r.codigo) || { codigo: r.codigo, titulo: r.cupon.titulo, negocio: r.cupon.negocio, fin: r.cupon.fin, descripcion: r.cupon.descripcion, direccion: "", canjeado: false };
      detalle(m);
      if (App.estado.vista === "cupones") cargar();
    } catch (e) { App.toast(e.mensaje, "error"); }
  }

  /** QR del código (librería local vendor/qrcode.js, MIT). Si no cargó, la pantalla muestra solo el código. */
  function qrSvg(texto) {
    if (typeof qrcode !== "function") return null;
    try {
      const qr = qrcode(0, "M");
      qr.addData(texto); qr.make();
      const n = qr.getModuleCount(), margen = 4, NS = "http://www.w3.org/2000/svg";
      let d = "";
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) d += `M${x + margen} ${y + margen}h1v1h-1z`;
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", `0 0 ${n + 2 * margen} ${n + 2 * margen}`);
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Código QR del cupón " + texto);
      svg.setAttribute("shape-rendering", "crispEdges");
      const fondo = document.createElementNS(NS, "rect");
      fondo.setAttribute("width", n + 2 * margen); fondo.setAttribute("height", n + 2 * margen); fondo.setAttribute("fill", "#fff");
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d); p.setAttribute("fill", "#000");
      svg.append(fondo, p);
      return svg;
    } catch (_) { return null; }
  }

  function detalle(m) {
    const cuerpo = App.vaciar($("cupon-cuerpo"));
    cuerpo.append(...[
      h("h2", { id: "cupon-titulo", class: "cupon-titulo", text: m.titulo }),
      h("p", { class: "cupon-negocio", text: m.negocio.toUpperCase() }),
      m.descripcion ? h("p", { class: "suave", style: "margin:0 0 4px", text: m.descripcion }) : null,
      h("p", { class: "cupon-vigencia" }, h("span", { class: "ruta-et", text: "VIGENCIA:" }), ` HASTA EL ${App.fechaCorta(m.fin).toUpperCase()}`),
      m.canjeado ? h("p", { class: "cupon-canjeado", text: "ESTE CUPÓN YA FUE CANJEADO" }) : null,
      h("div", { class: "qr" }, qrSvg(m.codigo)),
      h("p", { class: "codigo", "aria-label": "Código " + m.codigo.split("").join(" "), text: m.codigo }),
      h("p", { class: "suave", style: "text-align:center", text: "Muéstralo en caja. Es personal y el comercio lo valida una sola vez." }),
      h("div", { class: "acciones" },
        h("button", { class: "btn btn-secundario", type: "button", text: "COPIAR CÓDIGO", onClick: async (ev) => {
          try { await navigator.clipboard.writeText(m.codigo); ev.target.textContent = "CÓDIGO COPIADO ✓"; } catch (_) { App.toast("No se pudo copiar. Anótalo o toma captura.", "error"); }
        } }),
        h("button", { class: "btn", type: "button", text: "LISTO", onClick: () => App.cerrarDialogo($("dlg-cupon")) }))].filter(Boolean));
    App.abrirDialogo($("dlg-cupon"));
  }

  function pintar() {
    const ul = App.vaciar($("cupones-lista"));
    $("cupones-vacio").hidden = mios.length > 0;
    mios.forEach((m) => ul.appendChild(h("li", { class: "fila-fig" },
      h("button", { class: "fila-fig__cuerpo fila-fig__btn", type: "button", "aria-label": `Ver el cupón de ${m.negocio}: ${m.titulo}`, onClick: () => detalle(m) },
        h("span", { class: "cupon-txt" },
          h("strong", { text: m.negocio.toUpperCase() }),
          h("span", { text: String(m.direccion || m.titulo).replace(/,\s*zona piloto$/i, "").toUpperCase() + (m.canjeado ? " · CANJEADO" : "") })),
        h("span", { class: "chevron-fig", "aria-hidden": "true" }, App.icono("chevron", 34))))));
  }

  async function cargar() {
    const err = $("cupones-error");
    App.mostrarError(err, null);
    try { await leer(); pintar(); } catch (e) { App.mostrarError(err, e); }
  }

  App.mods.cupones = { alMostrar: cargar, obtener, obtenerEnSilencio, tengo, precargar, recargar() { if (App.estado.vista === "cupones") cargar(); else precargar(); } };
})();
