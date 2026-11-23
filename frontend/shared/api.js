/* FaroLocal — cliente de la API. Sin dependencias; expone window.Faro.
   - Envía el token (JWT) en Authorization si hay sesión.
   - 401 con sesión → limpia la sesión y vuelve al inicio de la sección con aviso.
   - Errores del servidor {error, campo} → ApiError con .mensaje y .campo.            */
(function () {
  "use strict";

  const CLAVE_TOKEN = "faro.token";
  const CLAVE_USUARIO = "faro.usuario";
  const CLAVE_AVISO = "faro.aviso";

  class ApiError extends Error {
    constructor(mensaje, { status = 0, campo = null } = {}) {
      super(mensaje);
      this.name = "ApiError";
      this.mensaje = mensaje;
      this.status = status;
      this.campo = campo;
    }
  }

  // ---------------------------------------------------------------- sesión
  function leer(clave) {
    try { return localStorage.getItem(clave); } catch (_) { return null; }
  }
  function escribir(clave, valor) {
    try { localStorage.setItem(clave, valor); } catch (_) { /* modo privado: la sesión dura la pestaña */ memoria[clave] = valor; }
  }
  function borrar(clave) {
    try { localStorage.removeItem(clave); } catch (_) { /* nada */ }
    delete memoria[clave];
  }
  const memoria = {};

  function token() { return leer(CLAVE_TOKEN) || memoria[CLAVE_TOKEN] || null; }
  function usuario() {
    const j = leer(CLAVE_USUARIO) || memoria[CLAVE_USUARIO];
    try { return j ? JSON.parse(j) : null; } catch (_) { return null; }
  }
  function guardarSesion(resp) {
    escribir(CLAVE_TOKEN, resp.token);
    escribir(CLAVE_USUARIO, JSON.stringify(resp.usuario));
  }
  function cerrarSesion() {
    borrar(CLAVE_TOKEN);
    borrar(CLAVE_USUARIO);
  }

  // Avisos que sobreviven a una redirección (p. ej. "tu sesión expiró")
  function guardarAviso(texto) { try { sessionStorage.setItem(CLAVE_AVISO, texto); } catch (_) { /* nada */ } }
  function tomarAviso() {
    try {
      const t = sessionStorage.getItem(CLAVE_AVISO);
      sessionStorage.removeItem(CLAVE_AVISO);
      return t;
    } catch (_) { return null; }
  }

  // ---------------------------------------------------------------- rutas por rol
  const INICIO_POR_ROL = { peaton: "/app/", comercio: "/portal/comercio/", admin: "/portal/admin/" };

  function inicioSeccion() {
    const p = location.pathname;
    if (p.startsWith("/portal")) return "/portal/";
    if (p.startsWith("/app")) return "/app/";
    return "/";
  }

  function irSegunRol(u) {
    const dest = INICIO_POR_ROL[(u || usuario() || {}).rol];
    location.replace(dest || "/");
  }

  // ---------------------------------------------------------------- fetch
  /**
   * api(ruta, { metodo, cuerpo, params, sinSesion })
   *  - ruta: "/api/..." ; params: objeto para query string (ignora null/undefined/"")
   *  - devuelve el JSON; lanza ApiError en error HTTP o de red.
   */
  async function api(ruta, opciones = {}) {
    const { metodo = "GET", cuerpo, params, sinSesion = false } = opciones;
    let url = ruta;
    if (params) {
      const q = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v !== null && v !== undefined && v !== "") q.set(k, v); });
      const s = q.toString();
      if (s) url += (url.includes("?") ? "&" : "?") + s;
    }
    const cab = { Accept: "application/json" };
    const t = sinSesion ? null : token();
    if (t) cab.Authorization = "Bearer " + t;
    let init = { method: metodo, headers: cab };
    if (cuerpo !== undefined) {
      cab["Content-Type"] = "application/json";
      init.body = JSON.stringify(cuerpo);
    }

    let resp;
    try {
      resp = await fetch(url, init);
    } catch (_) {
      throw new ApiError("No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.", { status: 0 });
    }

    let datos = null;
    const tipo = resp.headers.get("content-type") || "";
    if (tipo.includes("application/json")) {
      try { datos = await resp.json(); } catch (_) { datos = null; }
    }

    if (resp.ok) {
      // el service worker marca las respuestas servidas desde su caché (modo sin conexión)
      if (datos && typeof datos === "object" && resp.headers.get("X-Desde-Cache")) datos.__cache = true;
      return datos;
    }

    const mensaje = (datos && datos.error) || (resp.status >= 500
      ? "Ocurrió un problema en el servidor. Inténtalo de nuevo en un momento."
      : "No se pudo completar la acción.");

    // 401 con sesión activa = token vencido o inválido. (Un login incorrecto no envía token.)
    if (resp.status === 401 && t) {
      cerrarSesion();
      guardarAviso(mensaje);
      location.href = inicioSeccion();
    }
    throw new ApiError(mensaje, { status: resp.status, campo: (datos && datos.campo) || null });
  }

  const get = (ruta, params) => api(ruta, { params });
  const post = (ruta, cuerpo) => api(ruta, { metodo: "POST", cuerpo: cuerpo === undefined ? {} : cuerpo });
  const put = (ruta, cuerpo) => api(ruta, { metodo: "PUT", cuerpo });
  const del = (ruta) => api(ruta, { metodo: "DELETE" });

  // ---------------------------------------------------------------- auth
  async function login(correo, password) {
    const r = await api("/api/auth/login", { metodo: "POST", cuerpo: { correo, password }, sinSesion: true });
    guardarSesion(r);
    return r.usuario;
  }
  async function registro(datos) {
    const r = await api("/api/auth/registro", { metodo: "POST", cuerpo: datos, sinSesion: true });
    guardarSesion(r);
    return r.usuario;
  }
  /** Verifica el token contra el servidor y devuelve el usuario (o null si no hay sesión válida). */
  async function sesionActual() {
    if (!token()) return null;
    try {
      const u = await api("/api/auth/yo", { /* un 401 aquí redirige a la sección */ });
      escribir(CLAVE_USUARIO, JSON.stringify(u));
      return u;
    } catch (e) {
      if (e.status === 0) return usuario(); // sin red: confía en lo guardado
      return null;
    }
  }
  /**
   * Para páginas protegidas: devuelve el usuario si su rol está permitido;
   * si no hay sesión muestra el acceso (devuelve null); si el rol no corresponde, lo manda a su inicio.
   */
  async function exigirRol(roles) {
    const u = await sesionActual();
    if (!u) return null;
    if (!roles.includes(u.rol)) { irSegunRol(u); return undefined; }
    return u;
  }

  // ---------------------------------------------------------------- errores en formularios
  /** Marca el campo que devolvió el servidor y/o muestra el mensaje general en `aviso`. */
  function mostrarError(form, e, avisoEl) {
    limpiarErrores(form, avisoEl);
    const msg = e instanceof ApiError ? e.mensaje : "Ocurrió un error inesperado.";
    const campo = e && e.campo && form.elements[e.campo];
    if (campo && form.querySelector(`[data-error-de="${e.campo}"]`)) {
      campo.setAttribute("aria-invalid", "true");
      form.querySelector(`[data-error-de="${e.campo}"]`).textContent = msg;
      campo.focus();
    } else if (avisoEl) {
      avisoEl.textContent = msg;
      avisoEl.hidden = false;
    }
  }
  function limpiarErrores(form, avisoEl) {
    form.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));
    form.querySelectorAll("[data-error-de]").forEach((el) => { el.textContent = ""; });
    if (avisoEl) { avisoEl.hidden = true; avisoEl.textContent = ""; }
  }

  /** Escapa texto para insertarlo con innerHTML (preferir textContent siempre que se pueda). */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Al corregir un campo se borra su mensaje de error (no se queda un error viejo junto a un dato ya válido).
  function limpiarCampo(ev) {
    const el = ev.target;
    if (!(el instanceof Element) || !el.name) return;
    const form = el.closest("form");
    if (!form) return;
    const campo = el.name === "servicio" ? "servicios" : el.name;   // casillas de servicios del portal
    const sitio = form.querySelector(`[data-error-de="${campo}"]`);
    if (sitio) sitio.textContent = "";
    el.removeAttribute("aria-invalid");
  }
  document.addEventListener("input", limpiarCampo);
  document.addEventListener("change", limpiarCampo);

  window.Faro = Object.assign(window.Faro || {}, {
    ApiError, api, get, post, put, del,
    token, usuario, login, registro, sesionActual, exigirRol, cerrarSesion,
    guardarAviso, tomarAviso, irSegunRol, inicioSeccion, INICIO_POR_ROL,
    mostrarError, limpiarErrores, esc,
  });
})();
