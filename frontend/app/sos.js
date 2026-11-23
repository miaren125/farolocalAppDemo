/* RF07 — SOS: mantener 2 s → cuenta regresiva de 10 s con cancelar → aviso SIMULADO a contactos + enlace tel:911.
   No se conecta con servicios de emergencia ni envía mensajes reales. Un solo gesto (mantener) activa la alerta. */
(function () {
  "use strict";
  const { h, $ } = App;
  const MANTENER_MS = 2000;
  const CUENTA_S = 10;

  let tMantener = null, presionando = false;
  let aid = null, fin = 0, intervalo = null, estado = "inactivo"; // inactivo | cuenta | enviado | cancelado | error
  let ultimoEntero = null;

  // ---------------- botón: mantener 2 s
  function iniciarMantener(ev) {
    if (presionando || estado !== "inactivo") return;
    presionando = true;
    const b = $("sos-boton");
    b.classList.add("presionando");
    tMantener = setTimeout(() => {
      presionando = false; b.classList.remove("presionando");
      if (navigator.vibrate) navigator.vibrate(200);
      activar();
    }, MANTENER_MS);
  }
  function soltar() {
    if (!presionando) return;
    presionando = false;
    clearTimeout(tMantener);
    $("sos-boton").classList.remove("presionando");
    App.toast("Mantén el botón SOS presionado 2 segundos para activarlo.", "info");
  }

  // ---------------- flujo de la alerta
  const TITULOS = { cuenta: "ENVIANDO ALERTA", enviado: "ALERTA ENVIADA", cancelado: "ALERTA CANCELADA", error: "NO SE ENVIÓ" };
  function panel(nombre, titulo) {
    ["cuenta", "enviado", "cancelado", "error"].forEach((p) => { $("sos-" + p).hidden = p !== nombre; });
    $("dlg-sos").dataset.fase = nombre;
    $("sos-titulo").textContent = titulo || TITULOS[nombre];
    $("sos-x").hidden = nombre === "cuenta";            // durante la cuenta regresiva solo se sale con "Cancelar, fue falsa alarma"
  }

  async function activar() {
    estado = "cuenta"; aid = null;
    const dlg = $("dlg-sos");
    panel("cuenta");
    $("sos-numero").textContent = String(CUENTA_S);
    $("sos-para").textContent = "Preparando alerta…";
    $("sos-cancelar").disabled = true;
    App.abrirDialogo(dlg);
    try {
      const [r, nombres] = await Promise.all([Faro.post("/api/sos", { nodo: App.estado.pos }), App.mods.contactos.nombres()]);
      aid = r.id;
      $("sos-para").textContent = r.sin_contactos
        ? "NO TIENES CONTACTOS GUARDADOS: NADIE RECIBIRÁ EL AVISO. LLAMA AL 911 SI NECESITAS AYUDA."
        : "SE AVISARÁ A: " + nombres.join(", ").toUpperCase();
      $("sos-cancelar").disabled = false;
      $("sos-cancelar").focus();
      fin = Date.now() + (r.cancelable_segundos || CUENTA_S) * 1000;
      ultimoEntero = null;
      intervalo = setInterval(tic, 200);
      tic();
    } catch (e) {
      estado = "error";
      $("sos-error-texto").textContent = String(e.mensaje || "").toUpperCase() + " SI ESTÁS EN PELIGRO, LLAMA AL 911.";
      panel("error");
    }
  }

  function tic() {
    const restante = Math.max(0, Math.ceil((fin - Date.now()) / 1000));
    if (restante !== ultimoEntero) {
      ultimoEntero = restante;
      $("sos-numero").textContent = String(restante);
      $("sos-anuncio").textContent = restante <= 3 || restante === 10 || restante === 5 ? `${restante}` : "";
      $("sos-progreso").style.setProperty("--p", String(restante / CUENTA_S));
    }
    if (Date.now() >= fin) confirmar();
  }

  async function confirmar() {
    clearInterval(intervalo); intervalo = null;
    if (estado !== "cuenta") return;
    estado = "enviado";
    try {
      const r = await Faro.post(`/api/sos/${aid}/confirmar`);
      const lista = $("sos-enviados");
      App.vaciar(lista);
      r.contactos.forEach((c) => lista.appendChild(h("li", { text: c.nombre.toUpperCase() })));
      $("sos-enviado-texto").textContent = r.contactos.length
        ? "AVISAMOS A TUS CONTACTOS. ES UNA SIMULACIÓN: NO SE MANDAN MENSAJES REALES."
        : "NO TIENES CONTACTOS GUARDADOS, ASÍ QUE NADIE RECIBIÓ EL AVISO. PUEDES LLAMAR AL 911.";
      panel("enviado", r.contactos.length ? null : "SIN CONTACTOS");
      $("sos-911").focus();
    } catch (e) {
      estado = "error";
      $("sos-error-texto").textContent = String(e.mensaje || "").toUpperCase() + " SI ESTÁS EN PELIGRO, LLAMA AL 911.";
      panel("error");
    }
    App.mods.contactos.refrescarAlertas();
  }

  async function cancelar() {
    if (estado !== "cuenta") return;
    clearInterval(intervalo); intervalo = null;
    estado = "cancelado";
    $("sos-cancelar").disabled = true;
    try {
      await Faro.post(`/api/sos/${aid}/cancelar`);
      $("sos-cancelado-texto").textContent = "NO SE AVISÓ A NADIE. QUÉ BUENO QUE ESTÁS BIEN.";
    } catch (e) {
      // no se llamó a "confirmar", así que tampoco se avisó a nadie
      $("sos-cancelado-texto").textContent = "CANCELASTE LA ALERTA. NO SE AVISÓ A NADIE" + (e.status === 0 ? " (SIN CONEXIÓN: NO PUDIMOS REGISTRAR LA CANCELACIÓN)." : ".");
    }
    panel("cancelado");
    $("sos-cerrar-cancelado").focus();
    App.mods.contactos.refrescarAlertas();
  }

  function cerrar() {
    clearInterval(intervalo); intervalo = null;
    estado = "inactivo"; aid = null;
    App.cerrarDialogo($("dlg-sos"));
  }

  App.mods.sos = {
    init() {
      const b = $("sos-boton");
      b.addEventListener("pointerdown", (e) => { e.preventDefault(); iniciarMantener(e); });
      ["pointerup", "pointerleave", "pointercancel"].forEach((t) => b.addEventListener(t, soltar));
      b.addEventListener("contextmenu", (e) => e.preventDefault());
      // teclado: mantener Espacio o Enter 2 s
      b.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); iniciarMantener(e); } });
      b.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") soltar(); });
      b.addEventListener("blur", soltar);

      $("sos-cancelar").addEventListener("click", cancelar);
      ["sos-x", "sos-cerrar-enviado", "sos-cerrar-cancelado", "sos-cerrar-error"].forEach((id) => $(id).addEventListener("click", cerrar));
      $("sos-reintentar").addEventListener("click", () => { clearInterval(intervalo); activar(); });
      // Esc no debe cerrar el SOS por accidente
      $("dlg-sos").addEventListener("cancel", (e) => e.preventDefault());
    },
  };
})();
