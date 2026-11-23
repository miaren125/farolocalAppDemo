/* RF06 — MIS CONTACTOS (Figma 27:200 / 54:1204): lista con círculo Crema (iniciales) y nombre en mayúsculas, máx. 5.
   AGREGAR abre el formulario; ELIMINAR activa el modo con el menos circular por fila y pide confirmación.
   También guarda la bandeja de alertas SOS (RF07), que se ve desde el perfil. */
(function () {
  "use strict";
  const { h, $ } = App;
  const MAX = 5;
  let contactos = [];
  let editando = null;
  let borrando = false;

  const fmtCel = (c) => (c.length === 10 ? `${c.slice(0, 3)} ${c.slice(3, 6)} ${c.slice(6)}` : c);

  async function cargar() {
    const err = $("contactos-error");
    App.mostrarError(err, null);
    try {
      contactos = await Faro.get("/api/contactos");
      if (!contactos.length) borrando = false;
      pintar();
    } catch (e) { App.mostrarError(err, e); }
  }

  function pintar() {
    const ul = App.vaciar($("contactos-lista"));
    $("contactos-vacio").hidden = contactos.length > 0;
    const el = $("contacto-eliminar");
    el.textContent = borrando ? "LISTO" : "ELIMINAR";
    el.setAttribute("aria-pressed", String(borrando));
    el.disabled = !contactos.length;
    el.style.opacity = contactos.length ? "" : ".55";
    contactos.forEach((c) => {
      const cuerpo = [
        h("span", { class: "avatar-fig", "aria-hidden": "true", text: App.iniciales(c.nombre) }),
        h("span", { class: "contacto-txt" }, h("strong", { text: c.nombre.toUpperCase() }), h("span", { text: fmtCel(c.celular) })),
      ];
      ul.appendChild(h("li", { class: "fila-fig" },
        borrando
          ? h("div", { class: "fila-fig__cuerpo" }, cuerpo)
          : h("button", { class: "fila-fig__cuerpo fila-fig__btn", type: "button", "aria-label": "Editar a " + c.nombre, onClick: () => abrirForm(c) }, cuerpo),
        borrando ? h("button", { class: "menos-fig", type: "button", "aria-label": "Eliminar a " + c.nombre, onClick: () => borrar(c) }, App.icono("menos", 34)) : null));
    });
  }

  function abrirForm(c) {
    editando = c || null;
    const f = $("form-contacto");
    Faro.limpiarErrores(f, $("contacto-aviso"));
    f.nombre.value = c ? c.nombre : "";
    f.celular.value = c ? c.celular : "";
    $("contacto-titulo").textContent = c ? "Editar contacto" : "Nuevo contacto";
    App.abrirDialogo($("dlg-contacto"));
    f.nombre.focus();
  }

  async function agregar() {
    if (contactos.length >= MAX) {
      // el servidor decide y explica el límite: se muestra su mensaje tal cual
      try { await Faro.post("/api/contactos", {}); } catch (e) { App.toast(e.mensaje, "error"); }
      return;
    }
    borrando = false; pintar();
    abrirForm(null);
  }

  async function guardar(ev) {
    ev.preventDefault();
    const f = ev.target, aviso = $("contacto-aviso");
    Faro.limpiarErrores(f, aviso);
    const nombre = f.nombre.value.trim(), celular = f.celular.value.replace(/\D/g, "");
    const falla = (campo, msg) => { f.elements[campo].setAttribute("aria-invalid", "true"); f.querySelector(`[data-error-de="${campo}"]`).textContent = msg; f.elements[campo].focus(); };
    if (nombre.length < 2) return falla("nombre", "Escribe el nombre del contacto (mínimo 2 letras).");
    if (celular.length !== 10) return falla("celular", "El celular debe tener 10 dígitos.");
    const b = f.querySelector("button[type=submit]");
    b.disabled = true;
    try {
      if (editando) await Faro.put("/api/contactos/" + editando.id, { nombre, celular });
      else await Faro.post("/api/contactos", { nombre, celular });
      App.cerrarDialogo($("dlg-contacto"));
      App.toast(editando ? "Contacto actualizado." : "Contacto agregado.");
      cargar();
    } catch (e) { Faro.mostrarError(f, e, aviso); }
    finally { b.disabled = false; }
  }

  async function borrar(c) {
    if (!(await App.confirmar("¿Eliminar contacto?", `${c.nombre} dejará de recibir tus avisos SOS.`, "Eliminar"))) return;
    try { await Faro.del("/api/contactos/" + c.id); App.toast("Contacto eliminado."); await cargar(); }
    catch (e) { App.toast(e.mensaje, "error"); }
  }

  // ---------------- bandeja de alertas (RF07), dentro del perfil
  const ESTADO_ALERTA = { enviada: ["aprobado", "Enviada (simulada)"], cancelada: ["cerrado", "Cancelada"], pendiente: ["pendiente", "Sin confirmar"] };
  async function cargarAlertas() {
    const ul = $("alertas-lista"), err = $("alertas-error");
    App.mostrarError(err, null);
    try {
      const lista = await Faro.get("/api/sos");
      App.vaciar(ul);
      if (!lista.length) { ul.appendChild(App.estadoVacio("Sin alertas", "No has activado ninguna alerta SOS.")); return; }
      lista.forEach((a) => {
        const [clase, txt] = ESTADO_ALERTA[a.estado] || ["pendiente", a.estado];
        const quien = a.contactos.length ? "Para: " + a.contactos.map((c) => c.nombre).join(", ") : "Sin contactos guardados";
        ul.appendChild(h("li", { class: "item" },
          h("div", {}, h("strong", { text: App.fecha(a.creado) }), h("br"), h("span", { class: "suave", text: quien })),
          App.estado_(clase, txt)));
      });
    } catch (e) { App.mostrarError(err, e); }
  }

  App.mods.contactos = {
    init() {
      $("contacto-nuevo").addEventListener("click", agregar);
      $("contacto-eliminar").addEventListener("click", () => { borrando = !borrando; pintar(); });
      $("form-contacto").addEventListener("submit", guardar);
      $("contacto-cancelar").addEventListener("click", () => App.cerrarDialogo($("dlg-contacto")));
    },
    alMostrar() { borrando = false; cargar(); },
    refrescarAlertas: cargarAlertas,
    /** Nombres para mostrar en la cuenta regresiva del SOS. */
    async nombres() { try { return (await Faro.get("/api/contactos")).map((c) => c.nombre); } catch (_) { return []; } },
  };
})();
