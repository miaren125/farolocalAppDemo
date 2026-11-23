/* PWA: registra el service worker, avisa cuando no hay conexión y ajusta el marco de celular en pantallas anchas. */
(function () {
  "use strict";
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).catch(() => { /* sin SW la app funciona igual, solo no abre offline */ });
    });
  }
  function estado() {
    const a = document.getElementById("aviso-offline");
    if (a) a.hidden = navigator.onLine;
  }
  window.addEventListener("online", estado);
  window.addEventListener("offline", estado);
  document.addEventListener("DOMContentLoaded", estado);

  // En pantallas anchas el teléfono mide 422×894; si la ventana es más baja se reduce para que quepa completo.
  function ajustarMarco() {
    const t = document.getElementById("telefono");
    if (!t) return;
    const marco = window.innerWidth >= 600 && window.innerHeight >= 560;
    const e = marco ? Math.min(1, (window.innerHeight - 20) / 894) : 1;
    t.style.transform = e < 1 ? `scale(${e.toFixed(3)})` : "";
  }
  window.addEventListener("resize", ajustarMarco);
  document.addEventListener("DOMContentLoaded", ajustarMarco);
})();
