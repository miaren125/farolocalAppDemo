/* App del peatón — arranque: acceso (RF01), mapa (RF02), pestañas, hora simulada, perfil y módulos. */
(function () {
  "use strict";
  const { $ } = App;

  function mostrarAcceso() {
    $("vista-app").hidden = true;
    App.montarAcceso((u) => (u.rol === "peaton" ? iniciar(u) : Faro.irSegunRol(u)));
  }

  function horaActual() {
    const d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  let arrancada = false;
  async function iniciar(u) {
    $("vista-acceso").hidden = true; $("vista-app").hidden = false;
    App.estado.usuario = u;
    $("rapido-nombre").textContent = String(u.nombre || "").toUpperCase();
    $("perfil-avatar").textContent = App.iniciales(u.nombre);
    $("perfil-titulo").textContent = u.nombre;
    $("perfil-correo").textContent = u.correo || "";
    if (arrancada) { App.irA("mapa", { enfocar: false }); return; }
    arrancada = true;

    // menú de perfil: aquí vive "Cerrar sesión"
    const abrirPerfil = () => { App.mods.contactos.refrescarAlertas(); App.abrirDialogo($("dlg-perfil")); };
    $("perfil-btn").addEventListener("click", abrirPerfil);
    $("rapido-editar").addEventListener("click", abrirPerfil);
    document.querySelectorAll("[data-ir-vista]").forEach((b) => b.addEventListener("click", () => App.irA(b.dataset.irVista)));
    $("perfil-cerrar-hoja").addEventListener("click", () => App.cerrarDialogo($("dlg-perfil")));
    $("salir").addEventListener("click", () => { Faro.cerrarSesion(); location.href = "/app/"; });

    document.querySelectorAll(".nav-b").forEach((b) => b.addEventListener("click", () => {
      if (App.estado.vista === "reportar" && b.dataset.vista !== "reportar") App.mods.reportar.salir();
      App.irA(b.dataset.vista);
    }));

    // mapa: cada pestaña decide qué hacer con un toque
    App.mapa = Faro.Mapa.crear($("mapa"), {
      leyenda: true,
      onPunto: (p) => { const v = App.mods[App.estado.vista]; if (v && v.onPunto) v.onPunto(p); },
      onFaro: (f) => { const v = App.mods[App.estado.vista]; if (v && v.onFaro) v.onFaro(f); },
      onTramo: (a) => { if (App.estado.vista === "reportar") App.mods.reportar.onTramo(a); },
    });
    App.observarCapas();

    // hora simulada: chip arriba + hoja con selector
    const hora = $("hora");
    const pintarHora = () => { $("hora-texto").textContent = App.hora12(App.estado.hora); };
    hora.value = App.estado.hora = horaActual();
    pintarHora();
    // misma regla que el servidor (backend/app.py: esta_abierto); solo se usa con el mapa guardado sin conexión
    const abiertoA = (a, c, h) => (a === c ? true : a < c ? a <= h && h < c : h >= a || h < c);
    async function cargarZona(primera) {
      App.mostrarError($("error-mapa"), null);
      $("mapa").setAttribute("aria-busy", "true");
      try {
        const z = await Faro.get("/api/zona", { hora: App.estado.hora });
        if (z.__cache) { z.faros.forEach((f) => { f.abierto = abiertoA(f.abre, f.cierra, App.estado.hora); }); z.hora = App.estado.hora; }
        App.mapa.cargar(z); App.pintarPuntos();
        if (primera) App.mapa.centrarNodo(App.estado.pos, 0.62, false);
      }
      catch (e) { App.mostrarError($("error-mapa"), e); }
      finally { $("mapa").setAttribute("aria-busy", "false"); }
    }
    async function cambioHora() {
      App.estado.hora = hora.value || horaActual();
      if (!hora.value) hora.value = App.estado.hora;
      pintarHora();
      await cargarZona(false);
      App.mods.ruta.recalcular();
      App.mods.cupones.recargar();
    }
    $("hora-chip").addEventListener("click", () => App.abrirDialogo($("dlg-hora")));
    hora.addEventListener("change", cambioHora);
    $("hora-ahora").addEventListener("click", () => { hora.value = horaActual(); cambioHora(); });
    $("hora-listo").addEventListener("click", () => App.cerrarDialogo($("dlg-hora")));

    ["ruta", "contactos", "reportar", "sos"].forEach((m) => App.mods[m].init());
    App.mods.cupones.precargar();
    App.irA("mapa", { enfocar: false });
    await cargarZona(true);
    App.ajustarInferior();
  }

  (async function () {
    App.pintarIconos();
    // splash: el logo se queda 1,5 s mientras se revisa si ya hay sesión
    const [, u] = await Promise.all([new Promise((r) => setTimeout(r, 1500)), Faro.exigirRol(["peaton"])]);
    if (u === undefined) return;          // redirigido a otra sección
    $("splash").hidden = true;
    if (u === null) return mostrarAcceso();
    iniciar(u);
  })();
})();
