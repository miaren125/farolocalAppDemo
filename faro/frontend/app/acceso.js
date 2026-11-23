/* RF01 — splash, inicio de sesión y registro (Figma 1:7, 14:34, 27:31, 27:62).
   Valida en interfaz lo mismo que el servidor; los errores del servidor se muestran junto al campo correcto. */
(function () {
  "use strict";
  const { $ } = App;
  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const TEXTOS = { login: "INICIAR SESIÓN", registro: "REGISTRO" };
  const forms = () => ({ login: $("form-login"), registro: $("form-registro") });

  function mostrar(cual, enfocar = true) {
    const f = forms();
    Object.keys(f).forEach((k) => { f[k].hidden = k !== cual; Faro.limpiarErrores(f[k], f[k].querySelector(".aviso-error")); });
    $("acceso-titulo").textContent = TEXTOS[cual];
    $("vista-acceso").scrollTop = 0;
    if (enfocar) f[cual].querySelector("input").focus({ preventScroll: true });
  }

  function modalError(titulo, texto, pie) {
    $("error-titulo").textContent = titulo;
    $("error-texto").textContent = texto;
    $("error-pie").textContent = pie || "";
    $("error-pie").hidden = !pie;
    App.abrirDialogo($("dlg-error"));
  }

  function marcar(form, nombre, msg) {
    const c = form.elements[nombre];
    c.setAttribute("aria-invalid", "true");
    form.querySelector(`[data-error-de="${nombre}"]`).textContent = msg;
    return c;
  }

  function validarLogin(f) {
    Faro.limpiarErrores(f);
    let primero = null;
    if (!EMAIL.test(f.correo.value.trim())) primero = marcar(f, "correo", "Escribe el correo con el que te registraste.");
    if (!f.password.value) primero = primero || marcar(f, "password", "Escribe tu contraseña.");
    if (primero) primero.focus();
    return !primero;
  }
  function validarRegistro(f) {
    Faro.limpiarErrores(f, $("registro-aviso"));
    let primero = null;
    const falla = (n, m) => { const c = marcar(f, n, m); primero = primero || c; };
    if (f.nombre.value.trim().length < 2) falla("nombre", "Escribe tu nombre (mínimo 2 letras).");
    if (!EMAIL.test(f.correo.value.trim())) falla("correo", "Escribe un correo válido.");
    if (f.telefono.value.replace(/\D/g, "").length !== 10) falla("telefono", "El teléfono debe tener 10 dígitos.");
    if (f.password.value.length < 8) falla("password", "La contraseña debe tener al menos 8 caracteres.");
    if (primero) primero.focus();
    return !primero;
  }

  async function enviar(form, validar, accion, onError) {
    if (!validar(form)) return;
    const boton = form.querySelector("button[type=submit]"), texto = boton.textContent;
    boton.disabled = true; boton.textContent = "UN MOMENTO…";
    try { await accion(); }
    catch (e) { onError(e); }
    finally { boton.disabled = false; boton.textContent = texto; }
  }

  /** Muestra el acceso. onExito(usuario) se llama al entrar o registrarse. */
  App.montarAcceso = function (onExito) {
    $("vista-acceso").hidden = false;
    const aviso = Faro.tomarAviso();
    $("aviso-sesion").hidden = !aviso;
    if (aviso) $("aviso-sesion").textContent = aviso;
    mostrar("login", false);

    document.querySelectorAll("[data-ir]").forEach((b) => { b.onclick = () => mostrar(b.dataset.ir); });
    document.querySelectorAll("[data-proximamente]").forEach((b) => { b.onclick = () => App.toast("Próximamente. " + b.dataset.proximamente, "info"); });
    $("error-cerrar").onclick = () => App.cerrarDialogo($("dlg-error"));

    const { login, registro } = forms();
    login.onsubmit = (ev) => {
      ev.preventDefault();
      enviar(login, validarLogin, async () => onExito(await Faro.login(login.correo.value.trim(), login.password.value)), (e) => {
        if (e.campo && login.elements[e.campo]) Faro.mostrarError(login, e, null);
        else if (e.status === 401 || e.status === 400 || e.status === 403) modalError("DATOS INVÁLIDOS", "USUARIO O CONTRASEÑA INCORRECTOS", "FAVOR DE VERIFICAR LOS DATOS");
        else modalError("NO SE PUDO ENTRAR", String(e.mensaje || "Ocurrió un error inesperado.").toUpperCase(), "INTENTA DE NUEVO");
      });
    };
    registro.onsubmit = (ev) => {
      ev.preventDefault();
      enviar(registro, validarRegistro, async () => onExito(await Faro.registro({
        nombre: registro.nombre.value.trim(), correo: registro.correo.value.trim(),
        telefono: registro.telefono.value.trim(), password: registro.password.value, rol: "peaton",
      })), (e) => Faro.mostrarError(registro, e, $("registro-aviso")));
    };
  };
})();
