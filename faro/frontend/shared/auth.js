/* FaroLocal — formulario de acceso compartido (RF01): iniciar sesión y crear cuenta.
   Faro.Auth.montar(contenedor, { rolRegistro: "peaton" | "comercio", titulo, onExito(usuario) })
   Valida en interfaz lo mismo que el servidor; los errores del servidor se muestran junto al campo. */
(function () {
  "use strict";
  const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  function campo({ id, etiqueta, tipo = "text", nombre, auto, modo, ayuda, maxlen, conBoton }) {
    return `
      <div class="campo">
        <label for="${id}">${etiqueta}</label>
        <div class="${conBoton ? "con-boton" : ""}">
          <input class="entrada" id="${id}" name="${nombre}" type="${tipo}" autocomplete="${auto || "off"}"
                 ${modo ? `inputmode="${modo}"` : ""} ${maxlen ? `maxlength="${maxlen}"` : ""}
                 aria-describedby="${id}-error ${ayuda ? id + "-ayuda" : ""}" required>
          ${conBoton ? `<button type="button" class="btn-enlace" data-ver="${id}" aria-pressed="false">Mostrar</button>` : ""}
        </div>
        ${ayuda ? `<span class="ayuda" id="${id}-ayuda">${ayuda}</span>` : ""}
        <div class="campo-error" id="${id}-error" data-error-de="${nombre}" role="alert"></div>
      </div>`;
  }

  function montar(cont, opc = {}) {
    const rol = opc.rolRegistro || "peaton";
    const esComercio = rol === "comercio";
    cont.innerHTML = `
      <div class="pestanas" role="tablist" aria-label="Acceso">
        <button type="button" role="tab" id="tab-login" aria-selected="true" aria-controls="panel-login">Iniciar sesión</button>
        <button type="button" role="tab" id="tab-registro" aria-selected="false" aria-controls="panel-registro" tabindex="-1">Crear cuenta</button>
      </div>
      <div class="aviso aviso-info" id="aviso-sesion" role="status" hidden></div>

      <form id="panel-login" role="tabpanel" aria-labelledby="tab-login" novalidate>
        <div class="aviso aviso-error" data-aviso role="alert" hidden></div>
        ${campo({ id: "l-correo", etiqueta: "Correo electrónico", tipo: "email", nombre: "correo", auto: "email" })}
        ${campo({ id: "l-pass", etiqueta: "Contraseña", tipo: "password", nombre: "password", auto: "current-password", conBoton: true })}
        <button class="btn btn-bloque" type="submit">Entrar</button>
      </form>

      <form id="panel-registro" role="tabpanel" aria-labelledby="tab-registro" novalidate hidden>
        <div class="aviso aviso-error" data-aviso role="alert" hidden></div>
        ${campo({ id: "r-nombre", etiqueta: esComercio ? "Nombre del titular" : "Tu nombre", nombre: "nombre", auto: "name", maxlen: 80 })}
        ${campo({ id: "r-correo", etiqueta: "Correo electrónico", tipo: "email", nombre: "correo", auto: "email" })}
        ${campo({ id: "r-tel", etiqueta: "Teléfono celular", tipo: "tel", nombre: "telefono", auto: "tel-national", modo: "numeric", ayuda: "10 dígitos, sin lada internacional.", maxlen: 14 })}
        ${campo({ id: "r-pass", etiqueta: "Contraseña", tipo: "password", nombre: "password", auto: "new-password", ayuda: "Mínimo 8 caracteres.", conBoton: true })}
        <button class="btn btn-bloque" type="submit">${esComercio ? "Crear cuenta de comercio" : "Crear mi cuenta"}</button>
      </form>`;

    const $ = (s) => cont.querySelector(s);
    const tabs = { login: $("#tab-login"), registro: $("#tab-registro") };
    const forms = { login: $("#panel-login"), registro: $("#panel-registro") };
    const avisoSesion = $("#aviso-sesion");

    const aviso = Faro.tomarAviso();
    if (aviso) { avisoSesion.textContent = aviso; avisoSesion.hidden = false; }

    function mostrar(cual) {
      Object.keys(tabs).forEach((k) => {
        const on = k === cual;
        tabs[k].setAttribute("aria-selected", on);
        tabs[k].tabIndex = on ? 0 : -1;
        forms[k].hidden = !on;
      });
      avisoSesion.hidden = true;
      forms[cual].querySelector("input").focus();
    }
    tabs.login.addEventListener("click", () => mostrar("login"));
    tabs.registro.addEventListener("click", () => mostrar("registro"));
    cont.querySelector(".pestanas").addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { mostrar("registro"); tabs.registro.focus(); }
      if (e.key === "ArrowLeft") { mostrar("login"); tabs.login.focus(); }
    });

    cont.querySelectorAll("[data-ver]").forEach((b) => b.addEventListener("click", () => {
      const i = document.getElementById(b.dataset.ver);
      const ver = i.type === "password";
      i.type = ver ? "text" : "password";
      b.textContent = ver ? "Ocultar" : "Mostrar";
      b.setAttribute("aria-pressed", ver);
    }));

    // -------- validación en interfaz (misma que el servidor)
    function marcar(form, nombre, msg) {
      const c = form.elements[nombre];
      c.setAttribute("aria-invalid", "true");
      form.querySelector(`[data-error-de="${nombre}"]`).textContent = msg;
      return c;
    }
    function validarLogin(f) {
      Faro.limpiarErrores(f);
      let primero = null;
      if (!EMAIL.test(f.correo.value.trim())) primero = primero || marcar(f, "correo", "Escribe un correo válido.");
      if (!f.password.value) primero = primero || marcar(f, "password", "Escribe tu contraseña.");
      if (primero) primero.focus();
      return !primero;
    }
    function validarRegistro(f) {
      Faro.limpiarErrores(f);
      let primero = null;
      const falla = (n, m) => { const c = marcar(f, n, m); primero = primero || c; };
      if (f.nombre.value.trim().length < 2) falla("nombre", "Escribe tu nombre (mínimo 2 letras).");
      if (!EMAIL.test(f.correo.value.trim())) falla("correo", "Escribe un correo válido.");
      if (f.telefono.value.replace(/\D/g, "").length !== 10) falla("telefono", "El teléfono debe tener 10 dígitos.");
      if (f.password.value.length < 8) falla("password", "La contraseña debe tener al menos 8 caracteres.");
      if (primero) primero.focus();
      return !primero;
    }

    async function enviar(form, validar, accion) {
      const aviso = form.querySelector("[data-aviso]");
      aviso.hidden = true;
      if (!validar(form)) return;
      const boton = form.querySelector("button[type=submit]");
      const texto = boton.textContent;
      boton.disabled = true; boton.textContent = "Un momento…"; form.classList.add("cargando");
      try {
        const u = await accion();
        if (opc.onExito) opc.onExito(u);
      } catch (e) {
        Faro.mostrarError(form, e, aviso);
      } finally {
        boton.disabled = false; boton.textContent = texto; form.classList.remove("cargando");
      }
    }

    forms.login.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = forms.login;
      enviar(f, validarLogin, () => Faro.login(f.correo.value.trim(), f.password.value));
    });
    forms.registro.addEventListener("submit", (e) => {
      e.preventDefault();
      const f = forms.registro;
      enviar(f, validarRegistro, () => Faro.registro({
        nombre: f.nombre.value.trim(),
        correo: f.correo.value.trim(),
        telefono: f.telefono.value.trim(),
        password: f.password.value,
        rol,
      }));
    });

    $("#l-correo").focus();
  }

  window.Faro = Object.assign(window.Faro || {}, { Auth: { montar } });
})();
