/* RF09 — REPORTAR ZONA (Figma 27:351, 40:666, 40:697, 40:735), en dos pasos:
   1) NEGOCIO O REFERENCIA + "¿CUÁL ES EL MOTIVO?" (chips) + SIGUIENTE.
   2) "UBICA EL NEGOCIO": se toca el tramo (calle) en el mapa y ENVIAR.
   El reporte queda "Pendiente" hasta que un administrador lo apruebe; solo los aprobados afectan las rutas.
   La referencia se guarda como descripción (máx. 250); el tramo se guarda como arista_id.                      */
(function () {
  "use strict";
  const { h, $ } = App;
  const MAX = 250;
  let tramo = null;       // arista elegida
  let tipos = [];

  const LUZ = { 1: "poca luz", 2: "luz media", 3: "bien iluminada" };
  // texto de cada chip; el servidor exige estos cuatro tipos (el segundo se llama "Tramo problemático" en el diseño)
  const ETIQUETA = { "Tramo sin iluminación": "TRAMO PROBLEMÁTICO" };
  const etiqueta = (t) => ETIQUETA[t] || t.toUpperCase();

  function describir(a) {
    const A = App.mapa.nodo(a.a), B = App.mapa.nodo(a.b);
    return `${A.nombre} ↔ ${B.nombre} (${App.metros(a.metros)}, ${LUZ[a.luz] || ""})`;
  }

  function contador() {
    const t = $("reporte-ref"), c = $("reporte-ref-cuenta");
    c.textContent = `${t.value.length} / ${MAX}`;
    c.classList.toggle("lleno", t.value.length >= MAX - 20);
  }

  function elegirTipo(t) {
    $("reporte-tipo").value = t;
    $("reporte-chips").querySelectorAll(".chip-fig").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.tipo === t)));
    $("reporte-tipo-error").textContent = "";
  }

  async function cargarTipos() {
    if (tipos.length) return;
    try {
      tipos = await Faro.get("/api/tipos-reporte");
      App.vaciar($("reporte-chips")).append(...tipos.map((t) => h("button", {
        type: "button", class: "chip-fig", role: "radio", "aria-checked": "false", "data-tipo": t, onClick: () => elegirTipo(t), text: etiqueta(t),
      })));
    } catch (e) { App.toast(e.mensaje, "error"); }
  }

  async function mios() {
    const ul = $("reportes-lista"), err = $("reportes-error");
    App.mostrarError(err, null);
    try {
      const lista = await Faro.get("/api/reportes/mios");
      App.vaciar(ul);
      if (!lista.length) { ul.appendChild(App.estadoVacio("Aún no has enviado reportes", "Cuando reportes una calle, aquí verás si fue revisado.")); return; }
      lista.forEach((r) => ul.appendChild(h("li", { class: "item" },
        h("div", {}, h("strong", { text: r.tipo }), h("br"), h("span", { class: "suave", text: r.descripcion })),
        App.badgeEstado(r.estado))));
    } catch (e) { App.mostrarError(err, e); }
  }

  // ---------------- paso 1 → paso 2
  function siguiente(ev) {
    ev.preventDefault();
    const f = ev.target;
    Faro.limpiarErrores(f, $("reporte-aviso"));
    let primero = null;
    const ref = f.descripcion.value.trim();
    if (ref.length < 5) {
      f.descripcion.setAttribute("aria-invalid", "true");
      f.querySelector('[data-error-de="descripcion"]').textContent = "Escribe el negocio o una referencia (mínimo 5 caracteres).";
      primero = f.descripcion;
    }
    if (!f.tipo.value) {
      $("reporte-tipo-error").textContent = "Elige el motivo del reporte.";
      primero = primero || $("reporte-chips").querySelector(".chip-fig");
    }
    if (primero) { if (primero) primero.focus(); return; }
    pasoMapa();
  }

  function pasoMapa() {
    $("vista-reportar").hidden = true;
    $("zona-mapa").hidden = false;
    $("vista-app").dataset.cab = "mapa";
    $("reporte-sup").hidden = false;
    $("buscador-caja").hidden = true;
    tramo = null; pintarTramo();
    App.mapa.setModo("tramo");
    App.mapa.limpiarRutas();
    App.estado.destino = null; App.pintarPuntos();
    App.ajustarInferior();
    setTimeout(() => { App.mapa.medir(); App.ajustarInferior(); App.mapa.centrarNodo(App.estado.pos, 0.62, false); }, 0);
    $("reporte-titulo").focus({ preventScroll: true });
  }

  function pintarTramo() {
    $("reporte-tramo").textContent = tramo ? "TRAMO: " + describir(tramo).toUpperCase() : "";
    $("reporte-tramo-error").textContent = "";
    $("reporte-pista").hidden = !!tramo;
    App.mapa.resaltarTramo(tramo ? tramo.id : null);
    $("reporte-tarjeta").hidden = false;
    App.ajustarInferior();
  }

  async function enviar() {
    const f = $("form-reporte");
    if (!tramo) { $("reporte-tramo-error").textContent = "Elige el tramo: toca la calle en el mapa."; return; }
    const b = $("reporte-enviar");
    b.disabled = true; b.textContent = "ENVIANDO…";
    try {
      await Faro.post("/api/reportes", { arista_id: tramo.id, tipo: f.tipo.value, descripcion: f.descripcion.value.trim() });
      limpiar();
      App.irA("acceso", { enfocar: false });
      App.aviso("REPORTE ENVIADO", "UN ADMINISTRADOR LO REVISARÁ", "GRACIAS POR CUIDAR TU ZONA");
    } catch (e) {
      $("reporte-tramo-error").textContent = e.mensaje || "No se pudo enviar el reporte.";
      if (e.campo === "descripcion" || e.campo === "tipo") { volverAlFormulario(); Faro.mostrarError(f, e, $("reporte-aviso")); }
    } finally { b.disabled = false; b.textContent = "ENVIAR"; }
  }

  function volverAlFormulario() {
    salir();
    $("vista-reportar").hidden = false;
    $("zona-mapa").hidden = true;
    $("vista-app").dataset.cab = "logo";
    App.estado.vista = "reportar";
  }

  function limpiar() {
    const f = $("form-reporte");
    f.reset(); elegirTipo(""); contador(); Faro.limpiarErrores(f, $("reporte-aviso"));
    salir();
  }

  function salir() {
    tramo = null;
    $("reporte-sup").hidden = true; $("reporte-tarjeta").hidden = true;
    if (App.mapa && App.mapa.zona) { App.mapa.resaltarTramo(null); App.mapa.setModo("punto"); }
    App.ajustarInferior();
  }

  App.mods.reportar = {
    init() {
      $("form-reporte").addEventListener("submit", siguiente);
      $("reporte-ref").addEventListener("input", contador);
      $("reporte-enviar").addEventListener("click", enviar);
      $("reportes-abrir").addEventListener("click", () => { mios(); App.abrirDialogo($("dlg-reportes")); });
      $("reportes-cerrar").addEventListener("click", () => App.cerrarDialogo($("dlg-reportes")));
    },
    alMostrar() { salir(); $("zona-mapa").hidden = true; contador(); cargarTipos(); },
    onTramo(a) { tramo = a; pintarTramo(); setTimeout(() => { App.ajustarInferior(); const A = App.mapa.nodo(a.a), B = App.mapa.nodo(a.b); App.mapa.encuadrar([A, B], { relleno: 90 }); }, 40); },
    salir,
  };
})();
