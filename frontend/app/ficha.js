/* RF03 — ficha del Punto Faro (hoja inferior) y vista "Mapa" (RF02). */
(function () {
  "use strict";
  const { h, $ } = App;

  async function abrir(id) {
    const dlg = $("dlg-ficha"), cuerpo = $("ficha-cuerpo");
    App.vaciar(cuerpo).appendChild(h("p", { class: "suave", text: "Cargando ficha…" }));
    App.abrirDialogo(dlg);
    dlg.onclose = () => { dlg.onclose = null; if (App.mapa) App.mapa.seleccionarFaro(null); };
    try {
      const f = await Faro.get("/api/faros/" + id, { hora: App.estado.hora });
      pintar(f);
    } catch (e) {
      App.vaciar(cuerpo).append(
        h("div", { class: "aviso aviso-error", role: "alert", text: e.mensaje }),
        h("button", { class: "btn btn-secundario btn-bloque", type: "button", onClick: () => App.cerrarDialogo(dlg), text: "Cerrar" }));
    }
  }

  function pintar(f) {
    const cuerpo = $("ficha-cuerpo");
    const cerrar = () => App.cerrarDialogo($("dlg-ficha"));
    App.vaciar(cuerpo);
    cuerpo.append(
      h("div", { class: "ficha-cab" },
        h("img", { class: "ficha-lampara", src: "/assets/linterna.png", alt: "", style: f.abierto ? "" : "opacity:.45" }),
        h("div", { style: "flex:1;min-width:0" }, h("h2", { id: "ficha-titulo", text: f.nombre }), h("p", { class: "suave", style: "margin:0", text: `${f.giro} · ${f.direccion}` })),
        App.badgeAbierto(f.abierto)),
      h("p", { style: "margin:12px 0 0" }, h("strong", { text: App.horario(f) }), f.abierto ? "" : ` · cerrado a las ${App.hora12(App.estado.hora)}`),
      h("h3", { text: "Servicios para peatones" }),
      f.servicios.length
        ? h("ul", { class: "chips" }, f.servicios.map((s) => h("li", { text: s })))
        : h("p", { class: "suave", text: "Sin servicios registrados." }),
      h("h3", { text: "Cupones" }),
      f.cupones.length
        ? h("ul", { class: "lista" }, f.cupones.map((c) => h("li", { class: "item" },
            h("div", {}, h("strong", { text: c.titulo }), h("br"), h("span", { class: "suave", text: `${c.descripcion} Válido hasta ${App.fechaCorta(c.fin)}.` })),
            h("button", { class: "btn btn-chico", type: "button", onClick: () => App.mods.cupones.obtener(c.id), text: App.mods.cupones.tengo(c.id) ? "Ver código" : "Obtener" }))))
        : h("p", { class: "suave", text: "Este Punto Faro no tiene cupones vigentes." }),
      h("div", { class: "acciones" },
        h("button", { class: "btn btn-bloque", type: "button", onClick: () => { cerrar(); App.mods.ruta.irA(f.nodo_id); }, text: "Ruta Faro hasta aquí" }),
        h("div", { class: "acciones fila-2", style: "margin-top:0" },
          h("button", { class: "btn btn-secundario", type: "button", onClick: () => { cerrar(); App.mods.ruta.setOrigen(f.nodo_id); App.toast("Tu posición ahora es " + f.nombre + "."); }, text: "Estoy aquí" }),
          h("button", { class: "btn btn-secundario", type: "button", onClick: cerrar, text: "Cerrar" }))));
  }

  // ---------------- vista "Mapa": punto tocado (tarjeta sobre el mapa)
  function puntoTocado(nodo) {
    const cont = $("mapa-punto");
    App.vaciar(cont);
    if (nodo === null) { cont.hidden = true; App.ajustarInferior(); return; }
    cont.hidden = false;
    cont.append(h("div", { class: "punto-tocado" },
      h("p", {}, h("strong", { text: "Punto elegido: " }), App.nombreNodo(nodo)),
      h("div", { class: "fila" },
        h("button", { class: "btn btn-chico", type: "button", onClick: () => App.mods.ruta.irA(nodo), text: "Ir aquí" }),
        h("button", { class: "btn btn-secundario btn-chico", type: "button", onClick: () => { App.mods.ruta.setOrigen(nodo); App.toast("Tu posición ahora es " + App.nombreNodo(nodo) + "."); puntoTocado(null); App.estado.destino = null; App.pintarPuntos(); }, text: "Estoy aquí" }))));
    App.ajustarInferior();
  }

  App.mods.mapa = {
    alMostrar() { puntoTocado(null); },
    onPunto(p) { if (App.mods.ruta.activa()) return; App.estado.destino = p.nodo; App.pintarPuntos(); puntoTocado(p.nodo); },
    onFaro(f) { if (!App.mods.ruta.activa()) { App.estado.destino = f.nodo_id; App.pintarPuntos(); } puntoTocado(null); abrir(f.id); },
    limpiar() { puntoTocado(null); },
  };
  App.mods.ficha = { abrir };
})();
