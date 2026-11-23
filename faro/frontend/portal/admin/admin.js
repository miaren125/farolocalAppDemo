/* Portal de administración — RF14 validar negocios (con motivo de rechazo) y RF15 moderar reportes con mapa. */
(function () {
  "use strict";
  const { h, $ } = P;

  const FILTROS = [["pendiente", "Pendientes"], ["aprobado", "Aprobados"], ["rechazado", "Rechazados"], ["", "Todos"]];
  let router = null;
  let filtroN = "pendiente", filtroR = "pendiente";
  let negocios = [], negocioSel = null;
  let reportes = [], reporteSel = null;
  let zona = null, mapaN = null, mapaR = null;

  function pestanas(cont, actual, alCambiar) {
    P.vaciar(cont);
    FILTROS.forEach(([v, t]) => cont.appendChild(h("button", {
      type: "button", "aria-pressed": String(actual === v),
      onClick: () => alCambiar(v), text: t,
    })));
  }

  // ---------------------------------------------------------------- resumen y contadores del menú
  async function resumen() {
    const r = await Faro.get("/api/admin/resumen");
    const poner = (id, n) => { const e = $(id); e.textContent = String(n); e.hidden = n === 0; };
    poner("cnt-negocios", r.negocios_pendientes);
    poner("cnt-reportes", r.reportes_pendientes);
    return r;
  }
  async function pintarResumen() {
    P.mostrarAviso($("error-general"), null);
    try {
      const r = await resumen();
      const cont = P.vaciar($("resumen-contadores"));
      [[r.negocios_pendientes, "Negocios por validar", "Esperan tu revisión", "#negocios"],
       [r.reportes_pendientes, "Reportes por moderar", "Esperan tu revisión", "#reportes"],
       [r.negocios_aprobados, "Puntos Faro aprobados", "Visibles en el mapa", null],
       [r.usuarios, "Peatones registrados", "Cuentas de la app", null]].forEach(([n, t, d, href]) => {
        const caja = h(href ? "a" : "div", { class: "contador-caja", href: href, style: href ? "text-decoration:none;color:inherit" : null },
          h("span", { class: "n", text: String(n) }), h("span", { class: "t", text: t }), h("span", { class: "d", text: d }));
        cont.appendChild(caja);
      });
    } catch (e) { P.mostrarAviso($("error-general"), e.mensaje); }
  }

  // ---------------------------------------------------------------- RF14 negocios
  async function cargarNegocios() {
    P.mostrarAviso($("error-general"), null);
    pestanas($("filtro-negocios"), filtroN, (v) => { filtroN = v; negocioSel = null; cargarNegocios(); });
    try {
      negocios = await Faro.get("/api/admin/negocios", { estado: filtroN });
      zona = zona || (await P.zona());
    } catch (e) { P.mostrarAviso($("error-general"), e.mensaje); return; }
    if (!negocios.some((n) => n.id === negocioSel)) negocioSel = negocios.length ? negocios[0].id : null;
    pintarFilasNegocios();
    pintarDetalleNegocio();
    resumen().catch(() => {});
  }

  function pintarFilasNegocios() {
    const tb = P.vaciar($("negocios-filas"));
    if (!negocios.length) { tb.appendChild(h("tr", {}, h("td", { colspan: "3", class: "vacio", text: filtroN === "pendiente" ? "No hay negocios pendientes. ¡Todo al día!" : "No hay negocios con este estado." }))); return; }
    negocios.forEach((n) => tb.appendChild(h("tr", { class: n.id === negocioSel ? "seleccionada" : null },
      h("td", {}, h("button", { class: "btn-enlace", type: "button", "aria-pressed": String(n.id === negocioSel), onClick: () => { negocioSel = n.id; pintarFilasNegocios(); pintarDetalleNegocio(); }, text: n.nombre }), h("br"), h("span", { class: "suave", text: n.giro })),
      h("td", {}, n.titular, h("br"), h("span", { class: "suave", text: n.titular_correo })),
      h("td", {}, P.estadoNegocio(n.estado)))));
  }

  function pintarDetalleNegocio() {
    const cont = P.vaciar($("negocio-detalle"));
    const n = negocios.find((x) => x.id === negocioSel);
    if (!n) { cont.appendChild(h("p", { class: "suave", text: "Elige un negocio para ver sus datos." })); mapaN = null; return; }
    const nodo = zona.nodos.find((x) => x.id === n.nodo_id);
    cont.append(...[
      h("div", { class: "encabezado-vista" }, h("h2", { text: n.nombre }), P.estadoNegocio(n.estado)),
      n.estado === "rechazado" ? h("div", { class: "motivo" }, h("strong", { text: "Motivo del rechazo: " }), n.motivo_rechazo || "—") : null,
      h("dl", { class: "detalle-lista" },
        h("dt", { text: "Giro" }), h("dd", { text: n.giro }),
        h("dt", { text: "Dirección" }), h("dd", { text: n.direccion }),
        h("dt", { text: "Ubicación" }), h("dd", { text: nodo ? nodo.nombre : "—" }),
        h("dt", { text: "Horario" }), h("dd", { text: P.horario(n) }),
        h("dt", { text: "Titular" }), h("dd", { text: `${n.titular} · ${n.titular_correo}` }),
        h("dt", { text: "Servicios" }), h("dd", {}, n.servicios.length ? h("ul", { class: "chips" }, n.servicios.map((s) => h("li", { text: s }))) : "Ninguno"),
        n.revisado_en ? [h("dt", { text: "Revisado" }), h("dd", { text: P.fecha(n.revisado_en) })] : null),
      h("div", { id: "mapa-negocio-adm", "aria-label": "Ubicación del negocio en el mapa" }),
      n.estado === "pendiente" ? h("div", { class: "acciones-fila" },
        h("button", { class: "btn btn-peligro", type: "button", onClick: () => abrirRechazo(n), text: "Rechazar…" }),
        h("button", { class: "btn", type: "button", onClick: () => aprobarNegocio(n), text: "Aprobar negocio" })) : null,
    ].filter(Boolean));
    mapaN = Faro.Mapa.crear($("mapa-negocio-adm"), { leyenda: false });
    mapaN.cargar(zona);
    mapaN.marcarPunto("negocio", n.nodo_id);
  }

  async function aprobarNegocio(n) {
    if (!(await P.confirmar("¿Aprobar este negocio?", `«${n.nombre}» aparecerá en el mapa como Punto Faro y podrá publicar cupones.`, "Aprobar"))) return;
    try { await Faro.post(`/api/admin/negocios/${n.id}/aprobar`); P.toast(`«${n.nombre}» aprobado.`); P.refrescarZona(); zona = null; cargarNegocios(); }
    catch (e) { P.toast(e.mensaje, "error"); cargarNegocios(); }
  }

  let negocioRechazo = null;
  function abrirRechazo(n) {
    negocioRechazo = n;
    const f = $("form-rechazo");
    P.limpiarErrores(f, $("rechazo-aviso"));
    f.motivo.value = "";
    $("rechazo-negocio").textContent = `Negocio: ${n.nombre}`;
    P.abrir($("dlg-rechazo"));
    f.motivo.focus();
  }
  async function rechazarNegocio(ev) {
    ev.preventDefault();
    const f = ev.target, aviso = $("rechazo-aviso");
    P.limpiarErrores(f, aviso);
    const motivo = f.motivo.value.trim();
    if (motivo.length < 5) { P.errorLocal(f, "motivo", "Escribe el motivo del rechazo (mínimo 5 caracteres). El titular lo verá."); f.motivo.focus(); return; }
    const b = f.querySelector("button[type=submit]");
    b.disabled = true;
    try {
      await Faro.post(`/api/admin/negocios/${negocioRechazo.id}/rechazar`, { motivo });
      P.cerrar($("dlg-rechazo"));
      P.toast(`«${negocioRechazo.nombre}» rechazado.`);
      cargarNegocios();
    } catch (e) { P.errorCampo(f, e, aviso); if (e.status === 409) { P.cerrar($("dlg-rechazo")); cargarNegocios(); } }
    finally { b.disabled = false; }
  }

  // ---------------------------------------------------------------- RF15 reportes
  async function cargarReportes() {
    P.mostrarAviso($("error-general"), null);
    pestanas($("filtro-reportes"), filtroR, (v) => { filtroR = v; reporteSel = null; cargarReportes(); });
    try {
      zona = await P.zona();
      reportes = await Faro.get("/api/admin/reportes", { estado: filtroR });
    } catch (e) { P.mostrarAviso($("error-general"), e.mensaje); return; }
    if (!mapaR) { mapaR = Faro.Mapa.crear($("mapa-reportes"), { leyenda: true }); }
    mapaR.cargar(zona);
    if (!reportes.some((r) => r.id === reporteSel)) reporteSel = reportes.length ? reportes[0].id : null;
    pintarFilasReportes();
    marcarTramo();
    resumen().catch(() => {});
  }

  const nombreNodo = (id) => { const n = zona.nodos.find((x) => x.id === id); return n ? n.nombre : "?"; };

  function pintarFilasReportes() {
    const tb = P.vaciar($("reportes-filas"));
    if (!reportes.length) { tb.appendChild(h("tr", {}, h("td", { colspan: "2", class: "vacio", text: filtroR === "pendiente" ? "No hay reportes pendientes." : "No hay reportes con este estado." }))); return; }
    reportes.forEach((r) => tb.appendChild(h("tr", { class: r.id === reporteSel ? "seleccionada" : null },
      h("td", {},
        h("button", { class: "btn-enlace", type: "button", "aria-pressed": String(r.id === reporteSel), onClick: () => { reporteSel = r.id; pintarFilasReportes(); marcarTramo(); }, text: r.tipo }),
        h("br"), h("span", { text: r.descripcion }), h("br"),
        h("span", { class: "suave", text: `${r.autor} · ${P.fecha(r.creado)}` }),
        r.estado === "pendiente" ? h("div", { class: "acciones", style: "margin-top:8px" },
          h("button", { class: "btn btn-chico", type: "button", "aria-label": "Aprobar reporte: " + r.tipo, onClick: () => decidirReporte(r, "aprobar"), text: "Aprobar" }),
          h("button", { class: "btn btn-peligro btn-chico", type: "button", "aria-label": "Rechazar reporte: " + r.tipo, onClick: () => decidirReporte(r, "rechazar"), text: "Rechazar" })) : null),
      h("td", {}, P.estadoNegocio(r.estado)))));
  }

  function marcarTramo() {
    const r = reportes.find((x) => x.id === reporteSel);
    $("reporte-tramo").textContent = r ? `${nombreNodo(r.a)} ↔ ${nombreNodo(r.b)}` : "Elige un reporte para ver su tramo.";
    mapaR.resaltarTramo(r ? r.arista_id : null);
  }

  async function decidirReporte(r, accion) {
    try {
      await Faro.post(`/api/admin/reportes/${r.id}/${accion}`);
      P.toast(accion === "aprobar" ? "Reporte aprobado: el tramo ahora se penaliza en las rutas." : "Reporte rechazado.");
      zona = await P.refrescarZona();    // actualiza las marcas "!" del mapa
      cargarReportes();
    } catch (e) { P.toast(e.mensaje, "error"); cargarReportes(); }
  }

  // ---------------------------------------------------------------- arranque
  P.alListo = function () {
    router = P.router({
      resumen: { titulo: "Resumen", alMostrar: pintarResumen },
      negocios: { titulo: "Validar negocios", alMostrar: cargarNegocios },
      reportes: { titulo: "Moderar reportes", alMostrar: cargarReportes },
    }, "resumen");
    $("form-rechazo").addEventListener("submit", rechazarNegocio);
    $("rechazo-cancelar").addEventListener("click", () => P.cerrar($("dlg-rechazo")));
    resumen().catch(() => {});
  };
})();
