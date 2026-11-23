/* Portal de comercio — RF10 registrar/editar negocio, RF11 panel, RF12 cupones, RF13 validar cupón. */
(function () {
  "use strict";
  const { h, $ } = P;

  let negocio = null;       // negocio del titular (o null si aún no registra)
  let router = null;
  let mapa = null, nodoSel = null;
  const sesionValidados = [];

  const esAprobado = () => negocio && negocio.estado === "aprobado";

  async function cargarNegocio() {
    negocio = await Faro.get("/api/negocio");
    const pendiente = $("lateral-aviso");
    if (pendiente) pendiente.remove();
  }

  // ------------------------------------------------------------------ estado del negocio (reutilizado)
  function bloqueEstado() {
    if (!negocio) return h("div", { class: "aviso aviso-info" }, "Aún no registras tu negocio. ", h("a", { href: "#negocio", text: "Registrarlo ahora" }));
    const caja = h("div", { class: "panel-caja", style: "margin-bottom:16px" },
      h("div", { class: "fila-estado" }, h("strong", { text: negocio.nombre + " " }), P.estadoNegocio(negocio.estado),
        negocio.estado === "aprobado" ? P.abierto(negocio.abierto) : null));
    if (negocio.estado === "pendiente") caja.appendChild(h("p", { class: "suave", text: "Un administrador está revisando tu negocio. Aún no aparece en el mapa ni puedes publicar cupones." }));
    if (negocio.estado === "aprobado") caja.appendChild(h("p", { class: "suave", text: "Tu negocio aparece en el mapa como Punto Faro. Si cambias nombre, ubicación, horario o servicios, volverá a revisión." }));
    if (negocio.estado === "rechazado") caja.append(
      h("p", { class: "motivo" }, h("strong", { text: "Motivo del rechazo: " }), negocio.motivo_rechazo || "Sin motivo registrado."),
      h("p", { class: "suave", text: "Corrige los datos indicados y guarda: tu negocio se enviará de nuevo a revisión." }));
    return caja;
  }

  // ------------------------------------------------------------------ RF11 panel
  async function pintarPanel() {
    P.mostrarAviso($("error-general"), null);
    P.vaciar($("panel-estado")).appendChild(bloqueEstado());
    const cont = P.vaciar($("panel-contadores"));
    if (!negocio) return;
    try {
      const d = await Faro.get("/api/negocio/panel");
      negocio = d.negocio;
      P.vaciar($("panel-estado")).appendChild(bloqueEstado());
      [[d.vistas, "Vistas de tu ficha", "Veces que abrieron tu Punto Faro"],
       [d.rutas, "Rutas que pasan por tu negocio", "Rutas Faro calculadas por tu esquina"],
       [d.canjes, "Cupones canjeados", "Códigos validados en caja"],
       [d.cupones_activos, "Cupones activos", "Vigentes hoy"]].forEach(([n, t, s]) =>
        cont.appendChild(h("div", { class: "contador-caja" }, h("span", { class: "n", text: String(n) }), h("span", { class: "t", text: t }), h("span", { class: "d", text: s }))));
    } catch (e) { P.mostrarAviso($("error-general"), e.mensaje); }
  }

  // ------------------------------------------------------------------ RF10 negocio
  const form = () => $("form-negocio");

  function marcarUbicacion(nodo) {
    nodoSel = nodo;
    $("n-nodo").value = nodo === null ? "" : String(nodo);
    $("n-ubicacion").textContent = nodo === null ? "Toca el cruce donde está tu negocio." : "Ubicación elegida: " + mapa.nodo(nodo).nombre;
    mapa.marcarPunto("negocio", nodo);
    $("n-nodo-e").textContent = "";
  }

  function alternar24h() {
    const on = $("n-24h").checked;
    const f = form();
    if (on) { f.abre.value = "00:00"; f.cierra.value = "00:00"; }
    f.abre.disabled = f.cierra.disabled = on;
  }

  async function pintarNegocio() {
    P.mostrarAviso($("error-general"), null);
    const f = form();
    P.limpiarErrores(f, $("negocio-aviso"));
    if (!mapa) {
      mapa = Faro.Mapa.crear($("mapa-negocio"), { leyenda: true, onPunto: (p) => marcarUbicacion(p.nodo), onFaro: (x) => marcarUbicacion(x.nodo_id) });
      try { mapa.cargar(await P.zona()); } catch (e) { P.mostrarAviso($("error-general"), e.mensaje); return; }
    }
    P.vaciar($("negocio-estado")).appendChild(negocio ? bloqueEstado() : h("span"));
    $("negocio-titulo").textContent = negocio ? "Mi negocio" : "Registrar mi negocio";
    $("negocio-guardar").textContent = negocio ? "Guardar cambios" : "Enviar a revisión";
    f.nombre.value = negocio ? negocio.nombre : "";
    f.giro.value = negocio ? negocio.giro : "";
    f.direccion.value = negocio ? negocio.direccion : "";
    f.abre.value = negocio ? negocio.abre : "09:00";
    f.cierra.value = negocio ? negocio.cierra : "22:00";
    $("n-24h").checked = !!negocio && negocio.abre === negocio.cierra;
    alternar24h();
    const marcados = new Set(negocio ? negocio.servicios : []);
    f.querySelectorAll('input[name="servicio"]').forEach((c) => { c.checked = marcados.has(c.value); });
    marcarUbicacion(negocio ? negocio.nodo_id : null);
  }

  function leerServicios() {
    const marcados = [...form().querySelectorAll('input[name="servicio"]:checked')].map((c) => c.value);
    if (!negocio) return marcados;
    // conserva el orden guardado: el servidor compara la lista para saber si hubo cambios importantes
    const previos = negocio.servicios.filter((s) => marcados.includes(s));
    return previos.concat(marcados.filter((s) => !previos.includes(s)));
  }

  function validarNegocio(f) {
    P.limpiarErrores(f, $("negocio-aviso"));
    let primero = null;
    const falla = (c, m) => { const el = P.errorLocal(f, c, m); primero = primero || el; };
    if (f.nombre.value.trim().length < 3) falla("nombre", "Escribe el nombre del negocio (mínimo 3 caracteres).");
    if (f.giro.value.trim().length < 3) falla("giro", "Escribe el giro del negocio (por ejemplo, Abarrotes).");
    if (f.direccion.value.trim().length < 5) falla("direccion", "Escribe la dirección (mínimo 5 caracteres).");
    if (!f.abre.value) falla("abre", "Escribe la hora de apertura.");
    if (!f.cierra.value) falla("cierra", "Escribe la hora de cierre.");
    if (leerServicios().length === 0) { P.errorLocal(f, "servicios", "Elige al menos un servicio de apoyo para peatones."); primero = primero || f.querySelector('input[name="servicio"]'); }
    if (nodoSel === null) { P.errorLocal(f, "nodo_id", "Marca la ubicación del negocio en el mapa."); primero = primero || $("mapa-negocio"); }
    if (primero && primero.focus) primero.focus();
    return !primero;
  }

  async function guardarNegocio(ev) {
    ev.preventDefault();
    const f = form(), aviso = $("negocio-aviso");
    if (!validarNegocio(f)) return;
    const datos = {
      nombre: f.nombre.value.trim(), giro: f.giro.value.trim(), direccion: f.direccion.value.trim(),
      abre: f.abre.value, cierra: f.cierra.value, nodo_id: nodoSel, servicios: leerServicios(),
    };
    if (negocio && negocio.estado === "aprobado") {
      const cambio = datos.nombre !== negocio.nombre || datos.nodo_id !== negocio.nodo_id || datos.abre !== negocio.abre
        || datos.cierra !== negocio.cierra || datos.servicios.join("|") !== negocio.servicios.join("|");
      if (cambio && !(await P.confirmar("Tu negocio volverá a revisión",
        "Cambiaste el nombre, la ubicación, el horario o los servicios. Mientras un administrador lo revisa, dejarás de aparecer en el mapa.", "Guardar y reenviar"))) return;
    }
    const b = $("negocio-guardar"), texto = b.textContent;
    b.disabled = true; b.textContent = "Guardando…";
    try {
      const r = negocio ? await Faro.put("/api/negocio", datos) : await Faro.post("/api/negocio", datos);
      await cargarNegocio();
      P.refrescarZona();
      P.toast(!negocio || r.estado === "pendiente" ? "Negocio enviado a revisión." : "Cambios guardados.");
      router.ir("panel");
    } catch (e) { P.errorCampo(f, e, aviso); }
    finally { b.disabled = false; b.textContent = texto; }
  }

  // ------------------------------------------------------------------ RF12 cupones
  let cupones = [], editando = null;

  function estadoCupon(c) {
    const hoy = P.hoyISO();
    if (!c.activo) return ["cerrado", "Desactivado"];
    if (c.fin < hoy) return ["cerrado", "Vencido"];
    if (c.inicio > hoy) return ["pendiente", "Programado"];
    return ["aprobado", "Vigente"];
  }

  async function pintarCupones() {
    P.mostrarAviso($("error-general"), null);
    const bloqueo = $("cupones-bloqueo");
    const puede = esAprobado();
    $("cupon-nuevo").disabled = !puede;
    bloqueo.hidden = puede;
    bloqueo.textContent = !negocio ? "Primero registra tu negocio. Los cupones se publican cuando un administrador lo aprueba."
      : "Solo un negocio aprobado puede publicar cupones. Estado actual: " + { pendiente: "en revisión", rechazado: "rechazado" }[negocio.estado] + ".";
    const tb = P.vaciar($("cupones-filas"));
    try {
      cupones = await Faro.get("/api/negocio/cupones");
    } catch (e) { P.mostrarAviso($("error-general"), e.mensaje); return; }
    if (!cupones.length) { tb.appendChild(h("tr", {}, h("td", { colspan: "5", class: "vacio", text: "Aún no tienes cupones." }))); return; }
    cupones.forEach((c) => {
      const [clase, txt] = estadoCupon(c);
      tb.appendChild(h("tr", {},
        h("td", {}, h("strong", { text: c.titulo }), h("br"), h("span", { class: "suave", text: c.descripcion })),
        h("td", { text: `${P.fechaCorta(c.inicio)} — ${P.fechaCorta(c.fin)}` }),
        h("td", {}, P.estado(clase, txt)),
        h("td", { text: String(c.canjes) }),
        h("td", {}, h("div", { class: "acciones" },
          h("button", { class: "btn btn-secundario", type: "button", "aria-label": "Editar " + c.titulo, onClick: () => abrirCupon(c), text: "Editar" }),
          h("button", { class: "btn btn-secundario", type: "button", "aria-label": (c.activo ? "Desactivar " : "Activar ") + c.titulo, onClick: () => alternarCupon(c), text: c.activo ? "Desactivar" : "Activar" }),
          h("button", { class: "btn btn-peligro", type: "button", "aria-label": "Eliminar " + c.titulo, onClick: () => borrarCupon(c), text: "Eliminar" })))));
    });
  }

  function abrirCupon(c) {
    editando = c || null;
    const f = $("form-cupon");
    P.limpiarErrores(f, $("cupon-aviso"));
    $("cupon-titulo").textContent = c ? "Editar cupón" : "Nuevo cupón";
    f.titulo.value = c ? c.titulo : "";
    f.descripcion.value = c ? c.descripcion : "";
    const en30 = new Date(); en30.setDate(en30.getDate() + 30);
    f.inicio.value = c ? c.inicio : P.hoyISO();
    f.fin.value = c ? c.fin : en30.toISOString().slice(0, 10);
    P.abrir($("dlg-cupon"));
    f.titulo.focus();
  }

  async function guardarCupon(ev) {
    ev.preventDefault();
    const f = ev.target, aviso = $("cupon-aviso");
    P.limpiarErrores(f, aviso);
    let primero = null;
    const falla = (c, m) => { const el = P.errorLocal(f, c, m); primero = primero || el; };
    if (f.titulo.value.trim().length < 3) falla("titulo", "Escribe el título (mínimo 3 caracteres).");
    if (f.descripcion.value.trim().length < 3) falla("descripcion", "Describe el cupón (mínimo 3 caracteres).");
    if (!f.inicio.value) falla("inicio", "Elige la fecha de inicio.");
    if (!f.fin.value) falla("fin", "Elige la fecha de fin.");
    else if (f.inicio.value && f.fin.value <= f.inicio.value) falla("fin", "La fecha de fin debe ser posterior a la de inicio.");
    if (primero) { primero.focus(); return; }
    const datos = { titulo: f.titulo.value.trim(), descripcion: f.descripcion.value.trim(), inicio: f.inicio.value, fin: f.fin.value };
    const b = f.querySelector("button[type=submit]");
    b.disabled = true;
    try {
      if (editando) await Faro.put("/api/negocio/cupones/" + editando.id, Object.assign(datos, { activo: !!editando.activo }));
      else await Faro.post("/api/negocio/cupones", datos);
      P.cerrar($("dlg-cupon"));
      P.toast(editando ? "Cupón actualizado." : "Cupón publicado.");
      pintarCupones();
    } catch (e) { P.errorCampo(f, e, aviso); }
    finally { b.disabled = false; }
  }

  async function alternarCupon(c) {
    try { await Faro.post(`/api/negocio/cupones/${c.id}/activo`); P.toast(c.activo ? "Cupón desactivado." : "Cupón activado."); pintarCupones(); }
    catch (e) { P.toast(e.mensaje, "error"); }
  }
  async function borrarCupon(c) {
    if (!(await P.confirmar("¿Eliminar cupón?", `«${c.titulo}» dejará de estar disponible y se borrarán sus códigos.`, "Eliminar", true))) return;
    try { await Faro.del("/api/negocio/cupones/" + c.id); P.toast("Cupón eliminado."); pintarCupones(); }
    catch (e) { P.toast(e.mensaje, "error"); }
  }

  // ------------------------------------------------------------------ RF13 validar
  function pintarHistorial() {
    const ul = P.vaciar($("validar-historial"));
    if (!sesionValidados.length) { ul.appendChild(h("li", { class: "suave", text: "Todavía no has validado cupones en esta sesión." })); return; }
    sesionValidados.forEach((v) => ul.appendChild(h("li", {}, P.estado(v.ok ? "aprobado" : "rechazado", v.ok ? "Canjeado" : "No válido"),
      " ", h("strong", { text: v.codigo }), h("span", { class: "suave", text: " · " + v.detalle + " · " + v.hora }))));
  }

  async function validar(ev) {
    ev.preventDefault();
    const f = ev.target, res = P.vaciar($("validar-resultado"));
    P.limpiarErrores(f);
    const codigo = f.codigo.value.trim().toUpperCase();
    f.codigo.value = codigo;
    if (!codigo) { P.errorLocal(f, "codigo", "Escribe el código del cupón."); f.codigo.focus(); return; }
    if (!/^FARO-[0-9A-F]{6}$/.test(codigo)) { P.errorLocal(f, "codigo", "El código tiene el formato FARO-XXXXXX (6 letras o números)."); f.codigo.focus(); return; }
    const b = f.querySelector("button[type=submit]");
    b.disabled = true;
    try {
      const r = await Faro.post("/api/negocio/cupones/validar", { codigo });
      const hora = new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
      if (r.valido) {
        res.appendChild(h("div", { class: "resultado ok" }, "✓ Cupón válido y canjeado", h("small", { text: r.titulo })));
        f.codigo.value = "";
      } else res.appendChild(h("div", { class: "resultado mal" }, "✕ Cupón no válido", h("small", { text: r.motivo })));
      sesionValidados.unshift({ codigo, ok: r.valido, detalle: r.valido ? r.titulo : r.motivo, hora });
      pintarHistorial();
    } catch (e) { P.errorCampo(f, e); }
    finally { b.disabled = false; f.codigo.focus(); }
  }

  // ------------------------------------------------------------------ arranque
  P.alListo = async function () {
    try { await cargarNegocio(); }
    catch (e) { P.mostrarAviso($("error-general"), e.mensaje); }
    router = P.router({
      panel: { titulo: "Panel", alMostrar: pintarPanel },
      negocio: { titulo: "Mi negocio", alMostrar: pintarNegocio },
      cupones: { titulo: "Cupones", alMostrar: pintarCupones },
      validar: { titulo: "Validar cupón", alMostrar: () => { $("validar-resultado").textContent = ""; pintarHistorial(); } },
    }, () => (negocio ? "panel" : "negocio"));
    form().addEventListener("submit", guardarNegocio);
    $("n-24h").addEventListener("change", alternar24h);
    $("cupon-nuevo").addEventListener("click", () => abrirCupon(null));
    $("cupon-cancelar").addEventListener("click", () => P.cerrar($("dlg-cupon")));
    $("form-cupon").addEventListener("submit", guardarCupon);
    $("form-validar").addEventListener("submit", validar);
    $("v-codigo").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase(); });
  };
})();
