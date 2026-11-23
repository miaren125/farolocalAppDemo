/* App del peatón — núcleo: estado compartido y utilidades de interfaz.
   Cada pantalla vive en su propio archivo (ruta.js, sos.js, ...) y se registra en window.App.
   Todo el DOM se construye con h() / textContent: nunca se inserta texto del servidor como HTML. */
(function () {
  "use strict";

  const App = (window.App = {
    estado: {
      usuario: null,
      hora: "",          // "HH:MM" simulada (siempre se envía al servidor)
      pos: 19,           // posición simulada del peatón (nodo). Solo en memoria: no se guarda ubicación.
      destino: null,     // nodo elegido como destino
      vista: "mapa",
    },
    mapa: null,
  });

  /** h("div", {class:"x", onClick: fn, "aria-label": "..."}, hijo1, [hijo2, hijo3], "texto") */
  App.h = function h(tag, props, ...hijos) {
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
  const h = App.h;

  App.vaciar = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  App.$ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- formatos
  App.nombreNodo = (id) => {
    const n = App.mapa && App.mapa.nodo(id);
    return n ? n.nombre : "Punto de la zona";
  };
  App.horario = (f) => (f.abre === f.cierra ? "Abierto las 24 horas" : `Horario: ${f.abre} a ${f.cierra}`);
  App.metros = (m) => `${Math.round(m)} m`;
  App.hora12 = (hhmm) => {
    const [hh, mm] = String(hhmm || "00:00").split(":").map(Number);
    return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${hh < 12 ? "AM" : "PM"}`;
  };
  App.fecha = (iso) => {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  };
  App.fechaCorta = (iso) => {
    const d = new Date(iso + "T00:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  };
  App.estado_ = (clase, texto) => h("span", { class: "estado estado-" + clase, text: texto });
  App.badgeAbierto = (abierto) => App.estado_(abierto ? "abierto" : "cerrado", abierto ? "Abierto" : "Cerrado");
  App.badgeEstado = (e) => App.estado_(e, { pendiente: "Pendiente", aprobado: "Aprobado", rechazado: "Rechazado" }[e] || e);

  // ---------------------------------------------------------------- avisos
  // Todo vive dentro del marco del teléfono (position: absolute): nada de capa superior del navegador ni popover.
  let tToast = null;
  App.toast = (msg, tipo = "ok") => {
    const t = App.$("toast");
    t.textContent = msg;
    t.className = "toast toast-" + tipo + " visible" + (App.estado.vista === "mapa" ? "" : " toast-abajo");   // sobre el mapa va arriba para no tapar la tarjeta
    clearTimeout(tToast);
    tToast = setTimeout(() => t.classList.remove("visible"), 4200);
  };

  /** Muestra un error de API dentro de un contenedor .aviso-error (o lo oculta si e es null). */
  App.mostrarError = (cont, e) => {
    if (!e) { cont.hidden = true; cont.textContent = ""; return; }
    cont.textContent = e.mensaje || "Ocurrió un error inesperado.";
    cont.hidden = false;
  };

  // ---------------------------------------------------------------- hojas inferiores (bottom sheets)
  // <dialog> no modal (show) dentro del marco + velo propio; Esc y toque en el velo cierran (salvo el SOS).
  const abiertos = [];
  function actualizarVelo() {
    App.$("velo").hidden = abiertos.filter((d) => d.dataset.fondo !== "no").length === 0;
  }
  App.abrirDialogo = (dlg) => {
    if (dlg.open) return;
    dlg._previo = document.activeElement;
    dlg.show();
    abiertos.push(dlg);
    actualizarVelo();
    dlg.setAttribute("tabindex", "-1");
    const foco = dlg.querySelector("[autofocus]") || dlg;
    try { foco.focus({ preventScroll: true }); } catch (_) { /* nada */ }
    dlg.scrollTop = 0;
  };
  App.cerrarDialogo = (dlg) => { if (dlg.open) dlg.close(); };
  // "close" no burbujea: se escucha en captura
  document.addEventListener("close", (e) => {
    const d = e.target;
    if (!(d instanceof HTMLDialogElement)) return;
    const i = abiertos.indexOf(d);
    if (i >= 0) abiertos.splice(i, 1);
    actualizarVelo();
    if (d._previo && document.contains(d._previo)) { try { d._previo.focus({ preventScroll: true }); } catch (_) { /* nada */ } }
  }, true);
  document.addEventListener("click", (e) => {
    if (e.target === App.$("velo")) { const d = abiertos[abiertos.length - 1]; if (d && d.dataset.fondo !== "no" && d.dataset.bloquea !== "si") d.close(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const d = abiertos[abiertos.length - 1];
    if (d && d.dataset.fondo !== "no" && d.dataset.bloquea !== "si") d.close();
  });

  /** Aviso centrado en tarjeta Cobalto con X (mismo estilo que "DATOS INVÁLIDOS" de Figma). */
  App.aviso = (titulo, texto, pie) => {
    App.$("error-titulo").textContent = titulo;
    App.$("error-texto").textContent = texto || "";
    App.$("error-texto").hidden = !texto;
    App.$("error-pie").textContent = pie || "";
    App.$("error-pie").hidden = !pie;
    App.$("error-cerrar").onclick = () => App.cerrarDialogo(App.$("dlg-error"));
    App.abrirDialogo(App.$("dlg-error"));
  };

  /** Confirmación con hoja propia. Devuelve Promise<boolean>. */
  App.confirmar = (titulo, texto, textoBoton = "Sí, continuar") => new Promise((res) => {
    const dlg = App.$("dlg-confirmar");
    App.$("confirmar-titulo").textContent = titulo;
    App.$("confirmar-texto").textContent = texto;
    const ok = App.$("confirmar-ok"), no = App.$("confirmar-no");
    ok.textContent = textoBoton;
    const fin = (v) => { ok.onclick = no.onclick = null; dlg.onclose = null; if (dlg.open) dlg.close(); res(v); };
    ok.onclick = () => fin(true);
    no.onclick = () => fin(false);
    dlg.onclose = () => fin(false);
    App.abrirDialogo(dlg);
  });

  // ---------------------------------------------------------------- iconos SVG propios (trazo, 24×24)
  const ICONOS = {
    mapa: ["M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z", "M9 4v13.5M15 6.5V20"],
    ruta: ["M8.2 18H14a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h5.8", "circle:6,18,2.2", "circle:18,6,2.2"],
    cupones: ["M4 8a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2.2a2 2 0 0 0 0 3.6V16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2.2a2 2 0 0 0 0-3.6z", "M14.5 8.2v1.4M14.5 11.3v1.4M14.5 14.4v1.4"],
    contactos: ["circle:9,8,3", "M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5", "M16 5.4a2.8 2.8 0 0 1 0 5.4M17.3 14.1c2 .6 3.7 2.3 3.7 4.9"],
    reportar: ["M6 21V4", "M6 5h11.5l-2.2 4 2.2 4H6"],
    editar: ["M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6", "M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"],
    borrar: ["M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13", "M10.5 11v6M13.5 11v6"],
    faro: ["M5 21h14M9 21V9M15 21V9M7 9h10l-1.5-4h-7z", "M9 13h6"],
    luz: ["circle:12,10,4.5", "M12 2.5v1.2M4.7 5.6l.9.9M19.3 5.6l-.9.9M9.5 17.5h5M10.3 20h3.4"],
    camino: ["M4 18l5-12M20 18l-5-12M12 7v2M12 12v2M12 17v2"],
    alerta: ["M10.3 3.9 1.8 18.1a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z", "M12 9.5v4", "M12 17.2h.01"],
    casa: ["M3 10.5 12 3l9 7.5", "M5 9.5V21h14V9.5", "M9.5 21v-6h5v6"],
    cuadricula: ["M3.5 3.5h7v7h-7z", "M13.5 3.5h7v7h-7z", "M3.5 13.5h7v7h-7z", "M13.5 13.5h7v7h-7z"],
    usuarios: ["circle:9,7.5,3.6", "M2.5 20v-1.5a4.5 4.5 0 0 1 4.5-4.5h4a4.5 4.5 0 0 1 4.5 4.5V20", "M16 4.2a3.6 3.6 0 0 1 0 6.9", "M18.5 14.3a4.5 4.5 0 0 1 3 4.2V20"],
    premio: ["circle:12,9,6", "M8.5 14 7 22l5-3 5 3-1.5-8"],
    cerrar: ["M5 5l14 14M19 5 5 19"],
    menos: ["circle:12,12,10", "M7 12h10"],
    chevron: ["M9 5l7 7-7 7"],
    flecha: ["M5 12h14M13 6l6 6-6 6"],
    giro: ["M15 14l5-5-5-5", "M4 20v-7a4 4 0 0 1 4-4h16"],
    recto: ["M12 21V4", "M6 10l6-6 6 6"],
    vuelta: ["M9 14 4 9l5-5", "M4 9h11a5 5 0 0 1 0 10h-4"],
    llegada: ["M12 21s-7-6.3-7-11.5a7 7 0 0 1 14 0C19 14.7 12 21 12 21z", "circle:12,9.5,2.4"],
  };
  App.icono = (nombre, tam = 24) => {
    const NS = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true");
    s.setAttribute("width", String(tam)); s.setAttribute("height", String(tam));
    s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", "1.6"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round");
    (ICONOS[nombre] || []).forEach((d) => {
      if (d.startsWith("circle:")) {
        const [cx, cy, r] = d.slice(7).split(",");
        const c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r);
        s.appendChild(c);
      } else {
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", d);
        s.appendChild(p);
      }
    });
    return s;
  };
  App.pintarIconos = (raiz = document) => raiz.querySelectorAll("[data-icono]").forEach((s) => {
    if (!s.firstChild) s.appendChild(App.icono(s.dataset.icono, +s.dataset.tam || 26));
  });
  App.iniciales = (nombre) => {
    const p = String(nombre || "?").trim().split(/\s+/).filter(Boolean);
    return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
  };
  App.avatar = (nombre) => h("span", { class: "avatar", "aria-hidden": "true", text: App.iniciales(nombre) });
  /** Estado vacío amable (un <li> para las listas). */
  App.estadoVacio = (titulo, texto) => h("li", { class: "vacio" },
    h("img", { src: "/assets/linterna.png", alt: "", width: "34", height: "53" }), h("strong", { text: titulo }), texto);

  /** Mide la tarjeta inferior sobre el mapa y se lo avisa al mapa y al botón SOS (que se sube para no taparla). */
  let obs = null;
  App.ajustarInferior = () => {
    const capa = App.$("capa-inf"), sup = App.$("capa-sup");
    const hayMapa = !App.$("zona-mapa").hidden;
    const abajo = hayMapa ? capa.offsetHeight : 0;
    App.$("pantalla").style.setProperty("--inf", abajo + "px");
    if (App.mapa) App.mapa.setInset({ arriba: hayMapa ? sup.offsetHeight : 0, abajo });
  };
  App.observarCapas = () => {
    if (obs || typeof ResizeObserver !== "function") return;
    obs = new ResizeObserver(() => App.ajustarInferior());
    obs.observe(App.$("capa-inf")); obs.observe(App.$("capa-sup"));
  };

  // ---------------------------------------------------------------- vistas
  // Barra inferior: Inicio (mapa y ruta) · SOS · Acceso rápido (y lo que cuelga de él: contactos, cupones, reportar).
  const VISTAS = ["mapa", "acceso", "cupones", "contactos", "reportar"];
  const CON_MAPA = new Set(["mapa"]);
  const PESTANA = { mapa: "mapa", acceso: "acceso", cupones: "acceso", contactos: "acceso", reportar: "acceso" };
  const SECCION = { acceso: "vista-acceso-rapido" };
  App.irA = (vista, { enfocar = true } = {}) => {
    if (!VISTAS.includes(vista)) return;
    App.estado.vista = vista;
    VISTAS.forEach((v) => {
      const sec = App.$(SECCION[v] || "vista-" + v);
      if (sec) sec.hidden = v !== vista;
    });
    document.querySelectorAll(".nav-b").forEach((b) => b.setAttribute("aria-current", b.dataset.vista === PESTANA[vista] ? "page" : "false"));
    App.$("zona-mapa").hidden = !CON_MAPA.has(vista);
    App.$("buscador-caja").hidden = vista !== "mapa";
    // paneles propios de cada vista con mapa
    App.$("mapa-punto").hidden = true;
    App.$("ruta-tarjeta").hidden = true;
    App.$("reporte-sup").hidden = true;
    App.$("reporte-tarjeta").hidden = true;
    App.$("vista-app").dataset.cab = vista === "mapa" ? "mapa" : "logo";   // el círculo de perfil y la hora solo van en el mapa
    if (App.mapa) { App.mapa.setModo("punto"); App.mapa.seleccionarFaro(null); }
    ["mapa", "cupones", "contactos", "reportar"].forEach((m) => {
      const mod = App.mods[m];
      if (mod && m === vista && mod.alMostrar) mod.alMostrar();
    });
    if (vista === "mapa" && App.mods.ruta) App.mods.ruta.alMostrar();
    App.ajustarInferior();
    if (App.mapa && CON_MAPA.has(vista)) setTimeout(() => { App.mapa.medir(); App.ajustarInferior(); }, 0);
    if (enfocar) {
      const sec = App.$(SECCION[vista] || "vista-" + vista);
      const tit = sec && sec.querySelector("h2");
      if (tit) tit.focus({ preventScroll: true });
    }
  };
  App.mods = {};

  /** Marca origen/destino en el mapa según el estado. */
  App.pintarPuntos = () => {
    if (!App.mapa) return;
    App.mapa.marcarPunto("origen", App.estado.pos);
    App.mapa.marcarPunto("destino", App.estado.destino);
  };
})();
