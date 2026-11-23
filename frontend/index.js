/* Selector de acceso: si ya hay sesión válida entra directo a la sección que corresponde. */
(async function () {
  const aviso = Faro.tomarAviso();
  if (aviso) { const a = document.getElementById("aviso"); a.textContent = aviso; a.hidden = false; }
  // Si ya hay sesión válida, entra directo a la sección que le corresponde.
  const u = await Faro.sesionActual();
  if (u) { Faro.irSegunRol(u); return; }
  document.getElementById("estado").textContent = "Elige si usarás la app como peatón o el portal para negocios.";
  document.getElementById("opciones").hidden = false;
})();
