/* RF04 / RF05 — Ruta Faro, ruta alternativa y navegación simulada (Figma 37:442, 54:1580, 54:1700).
   1) Buscador "¿A DÓNDE VAS?": sugerencias de Puntos Faro y cruces de la zona.
   2) Vista previa: línea Miel sobre el mapa + tarjeta con tiempo y distancia, "INICIAR RUTA" y "OTRA RUTA".
   3) "INICIAR RUTA" acepta la ruta (POST /api/rutas/aceptar: suma el contador de cada Faro), obtiene los cupones de los
      Faros del camino (POST /api/cupones/<id>/obtener) y pasa a la navegación, que avanza en simulado (no hay GPS).
   La posición del peatón es simulada y solo vive en memoria: no se guarda ubicación.                              */
(function () {
  "use strict";
  const { h, $ } = App;
  const RITMO = 80;                  // m/min (≈ 4.8 km/h), igual que el servidor

  let fase = "idle";                 // "idle" | "previa" | "nav"
  let datos = null;                  // última respuesta de /api/rutas
  let sel = 0;                       // 0 = Ruta Faro, 1 = alternativa
  let enCurso = 0;                   // evita que una respuesta vieja pise a una nueva
  let destinoNombre = "";
  let nav = null;                    // { r, p, auto, timer, cupones: Map(negocio_id → [titulos]) }
  let sugs = [];                     // sugerencias en pantalla
  let activa = -1;                   // sugerencia resaltada con el teclado

  // ---------------------------------------------------------------- utilidades
  const quitarAcentos = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const nodo = (id) => App.mapa.nodo(id);
  const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} KM` : `${Math.round(m)} M`);
  const mins = (m) => Math.max(1, Math.round(m / RITMO));
  const fila = (clase, ...hijos) => h("div", { class: clase }, ...hijos);
  const dato = (etiqueta, valor, clase) => h("p", { class: clase }, h("span", { class: "ruta-et", text: etiqueta }), " " + valor);

  /** Nombres de calles: columna = primera parte de "Av. Rosales y Calle 1", fila = segunda. */
  function nombreCalle(a, b) {
    const A = nodo(a), B = nodo(b);
    if (A.col === B.col && A.fila !== B.fila) return String(A.nombre).split(" y ")[0];
    if (A.fila === B.fila && A.col !== B.col) return String(A.nombre).split(" y ")[1] || "la calle";
    return "la diagonal";
  }
  const metrosEntre = (a, b) => {
    const e = App.mapa.zona.aristas.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    return e ? e.metros : Math.hypot(nodo(a).x - nodo(b).x, nodo(a).y - nodo(b).y);
  };

  /** Giro en el cruce b al ir de a hacia c: "recto" | "derecha" | "izquierda" | "vuelta" (con y hacia abajo, cruz > 0 = derecha). */
  function giro(a, b, c) {
    const A = nodo(a), B = nodo(b), C = nodo(c);
    const v1 = [B.x - A.x, B.y - A.y], v2 = [C.x - B.x, C.y - B.y];
    const ang = (Math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]) * 180) / Math.PI;
    if (Math.abs(ang) < 25) return "recto";
    if (Math.abs(ang) > 150) return "vuelta";
    return ang > 0 ? "derecha" : "izquierda";
  }

  /** Próxima maniobra desde la posición p de la ruta: { j, tipo, texto } (j = índice del cruce donde ocurre). */
  function maniobra(r, p) {
    const ns = r.nodos;
    for (let j = p + 1; j < ns.length - 1; j++) {
      const g = giro(ns[j - 1], ns[j], ns[j + 1]);
      if (g !== "recto") {
        const calle = nombreCalle(ns[j], ns[j + 1]).toUpperCase();
        const texto = g === "derecha" ? `GIRAR A LA DERECHA EN ${calle}` : g === "izquierda" ? `GIRAR A LA IZQUIERDA EN ${calle}` : `DAR LA VUELTA EN ${calle}`;
        return { j, tipo: g, texto };
      }
    }
    return { j: ns.length - 1, tipo: "recto", texto: `SEGUIR POR ${nombreCalle(ns[p], ns[p + 1]).toUpperCase()} HASTA TU DESTINO` };
  }
  const restante = (r, p) => { let m = 0; for (let i = p; i < r.nodos.length - 1; i++) m += metrosEntre(r.nodos[i], r.nodos[i + 1]); return m; };

  // ---------------------------------------------------------------- buscador y sugerencias
  function candidatos(q) {
    const z = App.mapa.zona;
    if (!z) return [];
    const t = quitarAcentos(q.trim());
    const faros = z.faros.map((f) => ({ nombre: f.nombre, nodo: f.nodo_id, faro: true, abierto: f.abierto }));
    const vistos = new Set(faros.map((f) => f.nodo));
    const cruces = z.nodos.filter((n) => !vistos.has(n.id)).map((n) => ({ nombre: n.nombre, nodo: n.id, faro: false }));
    if (!t) return faros.slice(0, 4);
    const coincide = (c) => quitarAcentos(c.nombre).includes(t);
    return [...faros.filter(coincide), ...cruces.filter(coincide)].slice(0, 5);
  }

  function pintarSugerencias() {
    const ul = $("sugerencias"), inp = $("buscador");
    if (document.activeElement !== inp || fase === "nav") { ul.hidden = true; inp.setAttribute("aria-expanded", "false"); return; }
    sugs = candidatos(inp.value);
    activa = -1;
    App.vaciar(ul);
    if (!sugs.length) {
      ul.appendChild(h("li", { class: "sug-vacia", role: "option", "aria-disabled": "true", text: "No encontramos ese lugar en la zona." }));
    } else {
      sugs.forEach((s, i) => ul.appendChild(h("li", { role: "option", id: "sug-" + i, "aria-selected": "false" },
        h("button", { type: "button", class: "sug-item", onPointerdown: (ev) => ev.preventDefault(), onClick: () => elegir(s) },
          h("span", { class: "sug-nombre", text: s.nombre.toUpperCase() }),
          s.faro ? h("span", { class: "sug-faro", text: "FARO" }) : null))));
    }
    ul.hidden = false;
    inp.setAttribute("aria-expanded", "true");
  }
  function resaltar(i) {
    activa = i;
    $("sugerencias").querySelectorAll("[role=option]").forEach((li, k) => li.setAttribute("aria-selected", String(k === i)));
    $("buscador").setAttribute("aria-activedescendant", i >= 0 ? "sug-" + i : "");
  }

  function elegir(s) {
    $("sugerencias").hidden = true;
    $("buscador").blur();
    App.estado.destino = s.nodo;
    destinoNombre = s.nombre;
    $("buscador").value = s.nombre.toUpperCase();
    $("buscador-limpiar").hidden = false;
    App.mods.mapa.limpiar();
    App.pintarPuntos();
    calcular();
  }

  // ---------------------------------------------------------------- vista previa
  async function calcular() {
    const e = App.estado, tarjeta = $("ruta-tarjeta");
    if (e.destino === null) return;
    if (e.destino === e.pos) {
      App.toast("Ya estás en ese punto. Elige otro destino.", "info");
      limpiarRuta(true);
      return;
    }
    const mio = ++enCurso;
    fase = "previa";
    App.vaciar(tarjeta).appendChild(h("p", { class: "ruta-cargando", text: "CALCULANDO TU RUTA FARO…" }));
    tarjeta.hidden = false;
    App.ajustarInferior();
    try {
      const r = await Faro.post("/api/rutas", { origen_nodo: e.pos, destino_nodo: e.destino, hora: e.hora });
      if (mio !== enCurso) return;
      datos = r; sel = 0;
      pintarPrevia(true);
    } catch (x) {
      if (mio !== enCurso) return;
      datos = null; App.mapa.limpiarRutas();
      App.vaciar(tarjeta).append(
        h("div", { class: "ruta-error", role: "alert" }, App.icono("alerta", 22), h("span", { text: x.mensaje || "No pudimos calcular la ruta." })),
        fila("ruta-botones", h("button", { class: "pill-dorada", type: "button", onClick: calcular, text: "REINTENTAR" })));
      App.ajustarInferior();
    }
  }

  function pintarPrevia(encuadrar) {
    const tarjeta = App.vaciar($("ruta-tarjeta")), r = datos.rutas[sel];
    App.mapa.dibujarRutas(datos.rutas, { activa: sel });
    App.pintarPuntos();
    const abiertos = r.faros_abiertos, mas = r.mas_larga_que_corta_m;
    const hayOtra = datos.rutas.length > 1;
    tarjeta.append(
      dato("TIEMPO ESTIMADO:", `${r.minutos} ${r.minutos === 1 ? "MIN" : "MINS"}`, "ruta-tiempo"),
      dato("DISTANCIA:", km(r.metros), "ruta-dist"),
      h("p", { class: "ruta-extra", text: `${sel === 1 ? "Ruta alternativa · " : ""}${abiertos} ${abiertos === 1 ? "Faro abierto" : "Faros abiertos"} en tu camino · ${mas > 0 ? "+" + Math.round(mas) + " m vs la más corta" : "es la más corta"}` }),
      fila("ruta-botones",
        h("button", { class: "pill-dorada", type: "button", onClick: iniciar, text: "INICIAR RUTA" }),
        h("button", { class: "pill-dorada", type: "button", "aria-disabled": String(!hayOtra), onClick: () => {
          if (!hayOtra) { App.toast("Esta es la única ruta posible entre esos puntos.", "info"); return; }
          sel = sel === 0 ? 1 : 0; pintarPrevia(false);
        }, text: "OTRA RUTA" })));
    $("ruta-tarjeta").hidden = false;
    App.ajustarInferior();
    const encuadra = () => App.mapa.encuadrar(r.puntos, { relleno: 50 });
    if (encuadrar) setTimeout(() => { App.ajustarInferior(); encuadra(); }, 30); else encuadra();
  }

  // ---------------------------------------------------------------- aceptar y navegar
  async function iniciar() {
    if (!datos) return;
    const r = datos.rutas[sel];
    const ids = r.faros_en_ruta.map((f) => f.id);
    const botones = $("ruta-tarjeta").querySelectorAll("button");
    botones.forEach((b) => { b.disabled = true; });
    const cupones = new Map();
    try {
      if (ids.length) await Faro.post("/api/rutas/aceptar", { faros: ids });
      // cupones de los Faros que están en la ruta: se obtienen solos y quedan en MIS CUPONES
      const todos = await Faro.get("/api/cupones", { hora: datos.hora });
      const mios = todos.filter((c) => ids.includes(c.negocio_id));
      await Promise.all(mios.map(async (c) => {
        try { await App.mods.cupones.obtenerEnSilencio(c.id); } catch (_) { return; }
        cupones.set(c.negocio_id, [...(cupones.get(c.negocio_id) || []), c.titulo]);
      }));
    } catch (e) {
      App.toast(e.mensaje || "No pudimos registrar la ruta, pero puedes seguirla.", "error");
    }
    if (cupones.size) {
      const n = [...cupones.values()].reduce((a, v) => a + v.length, 0);
      App.toast(n === 1 ? "Obtuviste 1 cupón. Lo ves en MIS CUPONES." : `Obtuviste ${n} cupones. Los ves en MIS CUPONES.`);
    }
    fase = "nav";
    nav = { r, p: 0, auto: false, timer: null, cupones };
    App.mods.cupones.recargar();
    App.mapa.dibujarRutas([r], { activa: 0 });
    App.mapa.marcarCupones(r.faros_en_ruta.filter((f) => cupones.has(f.id)).map((f) => f.nodo_id));
    $("buscador").readOnly = true;
    $("buscador-limpiar").hidden = true;
    pintarNav();
    App.mapa.centrarNodo(r.nodos[0], Math.max(App.mapa.zoom, 1.0));
  }

  function pintarNav() {
    const { r, p } = nav, tarjeta = App.vaciar($("ruta-tarjeta"));
    const llego = p >= r.nodos.length - 1;
    const m = llego ? { tipo: "llegada", texto: "HAS LLEGADO A TU DESTINO" } : maniobra(r, p);
    const rest = restante(r, p);
    const flecha = h("span", { class: "nav-flecha nav-flecha--" + m.tipo, "aria-hidden": "true" });
    flecha.appendChild(App.icono(m.tipo === "recto" ? "recto" : m.tipo === "llegada" ? "llegada" : m.tipo === "vuelta" ? "vuelta" : "giro", 33));
    tarjeta.append(
      h("div", { class: "nav-cab" }, flecha, h("p", { class: "nav-texto", role: "status", "aria-live": "polite", text: m.texto }),
        h("button", { class: "nav-x", type: "button", "aria-label": "Terminar la ruta", onClick: () => terminar() }, App.icono("cerrar", 22))),
      dato("TIEMPO ESTIMADO:", llego ? "0 MINS" : `${mins(rest)} ${mins(rest) === 1 ? "MIN" : "MINS"}`, "ruta-dist"),
      dato("DISTANCIA:", llego ? "0 M" : km(rest), "ruta-dist"),
      fila("nav-acciones",
        llego
          ? h("button", { class: "pill-dorada", type: "button", onClick: () => terminar(), text: "TERMINAR" })
          : [h("button", { class: "pill-borde", type: "button", onClick: () => avanzar(), text: "SIMULAR AVANCE" }),
             h("button", { class: "pill-borde", type: "button", "aria-pressed": String(nav.auto), onClick: alternarAuto, text: nav.auto ? "AUTO: SÍ" : "AUTO: NO" })]));
    tarjeta.hidden = false;
    App.ajustarInferior();
  }

  function avanzar() {
    if (!nav || nav.p >= nav.r.nodos.length - 1) return;
    nav.p += 1;
    const id = nav.r.nodos[nav.p];
    App.estado.pos = id;                          // posición simulada, solo en memoria
    App.pintarPuntos();
    App.mapa.centrarNodo(id, Math.max(App.mapa.zoom, 1.0));
    const f = App.mapa.zona.faros.find((x) => x.nodo_id === id);
    if (f) {
      const cup = nav.cupones.get(f.id);
      App.toast(cup ? `Estás junto a ${f.nombre}: tienes un cupón.` : `Estás junto a ${f.nombre}.`, "info");
    }
    if (nav.p >= nav.r.nodos.length - 1) pararAuto();
    pintarNav();
  }
  function pararAuto() { if (nav) { clearInterval(nav.timer); nav.timer = null; nav.auto = false; } }
  function alternarAuto() {
    if (!nav) return;
    if (nav.auto) pararAuto(); else { nav.auto = true; nav.timer = setInterval(avanzar, 2000); }
    pintarNav();
  }

  function terminar() {
    pararAuto();
    nav = null;
    limpiarRuta(true);
  }

  /** Vuelve al estado inicial: sin ruta, sin destino, buscador vacío. */
  function limpiarRuta(borrarTexto) {
    enCurso++;
    fase = "idle"; datos = null; sel = 0;
    App.estado.destino = null;
    if (App.mapa) { App.mapa.limpiarRutas(); App.mapa.marcarCupones([]); }
    App.pintarPuntos();
    App.vaciar($("ruta-tarjeta")); $("ruta-tarjeta").hidden = true;
    const inp = $("buscador");
    inp.readOnly = false;
    if (borrarTexto) inp.value = "";
    $("buscador-limpiar").hidden = !inp.value;
    $("sugerencias").hidden = true;
    App.ajustarInferior();
  }

  App.mods.ruta = {
    init() {
      const inp = $("buscador");
      inp.addEventListener("focus", () => { if (fase !== "nav") { inp.select(); pintarSugerencias(); } });
      inp.addEventListener("input", () => { $("buscador-limpiar").hidden = !inp.value; if (fase === "previa") { /* se edita el destino: la ruta anterior sigue hasta elegir otro */ } pintarSugerencias(); });
      inp.addEventListener("blur", () => { setTimeout(() => { $("sugerencias").hidden = true; inp.setAttribute("aria-expanded", "false"); }, 120); });
      inp.addEventListener("keydown", (ev) => {
        const ul = $("sugerencias");
        if (ev.key === "ArrowDown" && !ul.hidden) { ev.preventDefault(); resaltar(Math.min(sugs.length - 1, activa + 1)); }
        else if (ev.key === "ArrowUp" && !ul.hidden) { ev.preventDefault(); resaltar(Math.max(0, activa - 1)); }
        else if (ev.key === "Enter") { ev.preventDefault(); const s = sugs[activa >= 0 ? activa : 0]; if (s && !ul.hidden) elegir(s); }
        else if (ev.key === "Escape") { ul.hidden = true; inp.blur(); }
      });
      $("buscador-limpiar").addEventListener("click", () => { limpiarRuta(true); inp.focus(); });
    },
    alMostrar() {
      const t = $("ruta-tarjeta");
      t.hidden = fase === "idle";
      App.mapa.setModo("punto");
      if (fase === "previa" && datos) { App.mapa.dibujarRutas(datos.rutas, { activa: sel }); }
      if (fase === "nav" && nav) App.mapa.dibujarRutas([nav.r], { activa: 0 });
    },
    fase: () => fase,
    activa: () => fase !== "idle",
    onPunto() { /* en vista previa y navegación los toques sueltos en el mapa no cambian nada */ },
    /** Fija el destino (desde la ficha de un Faro o desde "Ir aquí") y calcula. */
    irA(n) {
      const z = App.mapa.zona, f = z && z.faros.find((x) => x.nodo_id === n);
      pararAuto(); nav = null;
      App.estado.destino = n;
      destinoNombre = f ? f.nombre : nodo(n).nombre;
      $("buscador").readOnly = false;
      $("buscador").value = destinoNombre.toUpperCase();
      $("buscador-limpiar").hidden = false;
      App.mods.mapa.limpiar();
      App.irA("mapa", { enfocar: false });
      return calcular();
    },
    setOrigen(n) {
      App.estado.pos = n;
      App.pintarPuntos();
      if (App.mapa) App.mapa.centrarNodo(n);
      if (fase === "previa") calcular();
    },
    /** Si cambia la hora simulada y hay una vista previa, se recalcula. */
    recalcular() { if (fase === "previa" && App.estado.destino !== null) calcular(); },
  };
})();
