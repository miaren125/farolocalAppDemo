/* Portal — utilidades de interfaz (window.P). Todo el DOM se arma con h()/textContent: nunca HTML del servidor. */
(function () {
  "use strict";
  const P = (window.P = { usuario: null, alListo: null });

  P.h = function h(tag, props, ...hijos) {
    const e = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    (function agregar(lista) {
      lista.forEach((x) => {
        if (x === null || x === undefined || x === false) return;
        if (Array.isArray(x)) agregar(x);
        else e.appendChild(x instanceof Node ? x : document.createTextNode(String(x)));
      });
    })(hijos);
    return e;
  };
  const h = P.h;
  P.$ = (id) => document.getElementById(id);
  P.vaciar = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  // ---------------------------------------------------------------- formatos
  P.fecha = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? "—" : d.toLocaleString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };
  P.fechaCorta = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
  };
  P.hoyISO = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  P.horario = (n) => (n.abre === n.cierra ? "Abierto las 24 horas" : `${n.abre} a ${n.cierra}`);
  P.estado = (clase, texto) => h("span", { class: "estado estado-" + clase, text: texto });
  P.estadoNegocio = (e) => P.estado(e, { pendiente: "Pendiente", aprobado: "Aprobado", rechazado: "Rechazado" }[e] || e);
  P.abierto = (a) => P.estado(a ? "abierto" : "cerrado", a ? "Abierto ahora" : "Cerrado ahora");

  // ---------------------------------------------------------------- avisos
  let tToast = null, elToast = null;
  P.toast = (msg, tipo = "ok") => {
    if (!elToast) {
      elToast = h("div", { class: "toast", popover: "manual", role: "status", "aria-live": "polite" });
      document.body.appendChild(elToast);
    }
    elToast.textContent = msg;
    elToast.className = "toast toast-" + tipo;
    try { elToast.hidePopover(); elToast.showPopover(); } catch (_) { /* sin popover */ }
    clearTimeout(tToast);
    tToast = setTimeout(() => { try { elToast.hidePopover(); } catch (_) { /* nada */ } }, 5000);
  };

  P.mostrarAviso = (cont, texto) => { if (!texto) { cont.hidden = true; cont.textContent = ""; } else { cont.textContent = texto; cont.hidden = false; } };

  /** Muestra el error de la API junto al campo `e.campo` (si existe) o, si no, en `aviso`. */
  P.errorCampo = (form, e, aviso) => {
    P.limpiarErrores(form, aviso);
    const msg = (e && (e.mensaje || e.message)) || "Ocurrió un error inesperado.";
    const sitio = e && e.campo ? form.querySelector(`[data-error-de="${e.campo}"]`) : null;
    if (sitio) {
      sitio.textContent = msg;
      const campo = form.querySelector(`[name="${e.campo}"]`);
      if (campo) { campo.setAttribute("aria-invalid", "true"); if (campo.type !== "hidden") campo.focus(); }
      else { const primero = sitio.parentElement.querySelector("input,select,textarea"); if (primero) primero.focus(); }
    } else if (aviso) P.mostrarAviso(aviso, msg);
    else P.toast(msg, "error");
  };
  P.errorLocal = (form, campo, msg) => {
    const sitio = form.querySelector(`[data-error-de="${campo}"]`);
    if (sitio) sitio.textContent = msg;
    const el = form.querySelector(`[name="${campo}"]`);
    if (el) el.setAttribute("aria-invalid", "true");
    return el || sitio;
  };
  P.limpiarErrores = (form, aviso) => {
    form.querySelectorAll("[aria-invalid]").forEach((x) => x.removeAttribute("aria-invalid"));
    form.querySelectorAll("[data-error-de]").forEach((x) => { x.textContent = ""; });
    if (aviso) P.mostrarAviso(aviso, null);
  };

  // ---------------------------------------------------------------- diálogos
  P.abrir = (dlg) => { if (!dlg.open) dlg.showModal(); };
  P.cerrar = (dlg) => { if (dlg.open) dlg.close(); };
  document.addEventListener("click", (e) => { if (e.target instanceof HTMLDialogElement) e.target.close(); });

  P.confirmar = (titulo, texto, boton = "Sí, continuar", peligro = false) => new Promise((res) => {
    const dlg = h("dialog", { class: "modal", "aria-labelledby": "cf-t" });
    const fin = (v) => { dlg.close(); dlg.remove(); res(v); };
    dlg.append(h("h2", { id: "cf-t", text: titulo }), h("p", { text: texto }),
      h("div", { class: "acciones-fila" },
        h("button", { class: "btn btn-secundario", type: "button", onClick: () => fin(false), text: "Cancelar" }),
        h("button", { class: "btn " + (peligro ? "btn-peligro" : ""), type: "button", onClick: () => fin(true), text: boton })));
    dlg.addEventListener("close", () => { dlg.remove(); res(false); });
    document.body.appendChild(dlg);
    dlg.showModal();
  });

  // ---------------------------------------------------------------- vistas por hash (#panel, #cupones…)
  /** vistas: {nombre: {titulo, alMostrar()}}; el elemento es #v-nombre y el enlace del menú [data-vista=nombre]. */
  P.router = (vistas, porDefecto) => {
    function mostrar() {
      let n = location.hash.replace("#", "");
      if (!vistas[n]) n = typeof porDefecto === "function" ? porDefecto() : porDefecto;
      Object.keys(vistas).forEach((k) => {
        P.$("v-" + k).hidden = k !== n;
        const a = document.querySelector(`[data-vista="${k}"]`);
        if (a) a.setAttribute("aria-current", k === n ? "page" : "false");
      });
      document.title = `FaroLocal — ${vistas[n].titulo}`;
      if (vistas[n].alMostrar) vistas[n].alMostrar();
      const t = P.$("v-" + n).querySelector("h1");
      if (t) { t.setAttribute("tabindex", "-1"); }
    }
    window.addEventListener("hashchange", mostrar);
    mostrar();
    return { ir: (n) => { if (location.hash === "#" + n) mostrar(); else location.hash = n; } };
  };

  /** Zona (grafo) compartida; se pide una sola vez. */
  let zonaP = null;
  P.zona = () => (zonaP = zonaP || Faro.get("/api/zona").catch((e) => { zonaP = null; throw e; }));
  P.refrescarZona = () => { zonaP = null; return P.zona(); };
})();
