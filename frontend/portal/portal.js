/* Portal — arranque compartido.
   · /portal/            → acceso (comercio y administración), luego redirige según el rol
   · /portal/comercio/ y /portal/admin/ → exigen su rol, muestran el encabezado y llaman a P.alListo(usuario) */
(function () {
  "use strict";
  const seccion = document.body.dataset.seccion; // "comercio" | "admin" | undefined (acceso)

  async function arrancar() {
    if (!seccion) {
      const u = await Faro.sesionActual();
      if (u) return Faro.irSegunRol(u);
      Faro.Auth.montar(document.getElementById("acceso"), { rolRegistro: "comercio", onExito: Faro.irSegunRol });
      return;
    }
    const u = await Faro.exigirRol([seccion]);
    if (u === undefined) return;
    if (u === null) { location.replace("/portal/"); return; }
    P.usuario = u;
    document.getElementById("nombre-usuario").textContent = u.nombre;
    document.getElementById("salir").addEventListener("click", () => { Faro.cerrarSesion(); location.href = "/portal/"; });
    document.getElementById("panel").hidden = false;
    if (P.alListo) P.alListo(u);
  }
  arrancar();
})();
