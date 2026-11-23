/* FaroLocal — mapa nocturno SVG propio (sin tiles ni librerías: funciona sin internet). Estilo plano: sin brillos, halos ni pulsos.
   Dibuja el grafo de GET /api/zona como un mapa de noche parecido al del Figma:
     · manzanas y calles curvas (Bézier cuadráticas con curvatura determinista); avenidas más anchas que las calles
     · calles de relleno decorativas (no navegables) y lotes sugeridos, siempre iguales (semilla fija)
     · iluminación = color y grosor del tramo: bien iluminada (gris azulado claro, ancha) · luz media (intermedia) ·
       poca luz (oscura, delgada y con punteado fino); nunca depende solo del color
     · tramos con reportes aprobados: pequeño triángulo dorado plano
     · Puntos Faro: círculo plano de ~20 px (abierto = Miel relleno · cerrado = Pizarra con borde Dorado fino)
     · ruta Faro (Miel con borde Medianoche) y ruta alternativa (Marfil punteada)
     · gestos: arrastrar, pellizcar, rueda del ratón, botones +/− y recentrar (pointer events)

   Uso (API pública, compartida con el portal):
     const mapa = Faro.Mapa.crear(contenedor, { leyenda: true, onPunto, onFaro, onTramo });
     mapa.cargar(zona);                       // objeto devuelto por /api/zona
     mapa.marcarPunto("origen", nodoId);      // "origen" | "destino" | "negocio" | null para quitar
     mapa.marcarCupones([nodoId, ...]);       // insignia de cupón sobre los Faros con cupón (navegación)
     mapa.dibujarRutas([ruta1, ruta2], { activa: 0 });   // cada ruta trae .nodos (ids) y/o .puntos [{x,y}]
     mapa.seleccionarFaro(id) / mapa.resaltarTramo(aristaId)
     mapa.centrarNodo(id, k) / mapa.encuadrar(puntos) / mapa.recentrar() / mapa.setInset({arriba, abajo})
   Eventos:
     onPunto({ nodo, nombre, x, y })  toque en el mapa (se ajusta al cruce más cercano)
     onFaro(faro)                     toque/Enter en un Punto Faro
     onTramo(arista)                  toque en una calle, solo si modo === "tramo"       */
(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const C = {
    marino: "#091D36", medianoche: "#010242", pizarra: "#203759", cobalto: "#1E4482", dorado: "#E7BA67",
    miel: "#FAD680", marfil: "#FDFDF1", crema: "#FFF7D0", mantequilla: "#FEEB9C",
    fondo: "#1B2433",          // suelo del mapa (gris azulado oscuro, como el Figma)
    manzana: "#202A3B",        // manzanas apenas más claras que el suelo
    lote: "#27324A",           // líneas de lotes
    nombre: "#C9D3E6",         // nombres de calle
  };
  // cuerpo de la calle según la luz: 3 = gris azulado claro y ancha · 2 = intermedio · 1 = oscuro, delgada y punteada
  const LUZ = {
    3: { nombre: "Bien iluminada", color: "#5D7191", ancho: 1 },
    2: { nombre: "Luz media", color: "#43536F", ancho: 0.86 },
    1: { nombre: "Poca luz", color: "#2D3A52", ancho: 0.72 },
  };
  const ANCHO = { avenida: 9, calle: 6, diagonal: 7, relleno: 4.5 };   // px en pantalla (no cambian con el zoom): avenidas 8–10, calles 5–6
  const K_MAX = 2.4;

  function el(nombre, attrs, hijos) {
    const n = document.createElementNS(NS, nombre);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => { if (v !== null && v !== undefined) n.setAttribute(k, v); });
    (hijos || []).forEach((h) => n.appendChild(h));
    return n;
  }
  function tit(texto) { const t = el("title"); t.textContent = texto; return t; }
  function txt(attrs, texto) { const t = el("text", attrs); t.textContent = texto; return t; }
  function html(tag, clase, attrs) {
    const n = document.createElement(tag);
    if (clase) n.className = clase;
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    return n;
  }
  /** Generador pseudoaleatorio determinista (mulberry32). */
  function azar(semilla) {
    let a = semilla >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const f1 = (n) => Math.round(n * 10) / 10;

  /** Nombres de calles a partir de "Av. Rosales y Calle 1" (columna = primera parte, fila = segunda). */
  function nombresCalles(nodos) {
    const cols = new Map(), filas = new Map();
    nodos.forEach((n) => {
      const partes = String(n.nombre).split(" y ");
      if (partes.length !== 2) return;
      if (!cols.has(n.col)) cols.set(n.col, partes[0]);
      if (!filas.has(n.fila)) filas.set(n.fila, partes[1]);
    });
    return { cols, filas };
  }

  /** Pin de ubicación (gota con punto), con la punta en (0,0). */
  function pin(relleno, escala) {
    const g = el("g", { transform: `scale(${escala})` });
    g.append(el("path", { d: "M0 0C-3-6-8-9.5-8-15a8 8 0 0 1 16 0C8-9.5 3-6 0 0z", fill: relleno, stroke: C.medianoche, "stroke-width": 1.4, "stroke-linejoin": "round" }),
      el("circle", { cx: 0, cy: -15, r: 3, fill: C.medianoche }));
    return g;
  }

  function crear(contenedor, opciones = {}) {
    const op = Object.assign({ modo: "punto", leyenda: false, onPunto: null, onFaro: null, onTramo: null }, opciones);
    let zona = null;
    let nodos = new Map();
    let curvas = new Map();          // "a-b" -> { A, B, c, a } (curva de cada tramo)
    let faroSel = null, tramoSel = null;
    let paso = 140;
    let lim = { x0: 0, x1: 1, y0: 0, y1: 1 };
    let W = 0, H = 0;
    let vista = { k: 1, tx: 0, ty: 0 };
    let inset = { arriba: 0, abajo: 0 };
    let hayVista = false;           // ya se acomodó la vista una vez (no se reinicia al recargar la zona)
    const pendientes = [];
    const puntos = { origen: null, destino: null, negocio: null };
    let cupones = [];
    const escalados = [];           // elementos que mantienen su tamaño en pantalla: { g, x, y, s, rot, oy }
    const etiquetas = [];           // nombres de calle: { g, avenida }
    let animId = 0;

    contenedor.classList.add("faro-mapa");
    contenedor.textContent = "";

    // ---------------------------------------------------------------- estructura SVG
    const svg = el("svg", { class: "faro-mapa__svg", role: "group", "aria-label": "Mapa nocturno de la zona piloto con calles y Puntos Faro" });
    const fondo = el("rect", { class: "faro-mapa__fondo", x: 0, y: 0, width: "100%", height: "100%" });
    const mundo = el("g", { class: "faro-mapa__mundo" });
    const gBloques = el("g", { "pointer-events": "none" });
    const gLotes = el("g", { "pointer-events": "none" });
    const gRelleno = el("g", { "pointer-events": "none" });
    const gCalles = el("g", { "pointer-events": "none" });
    const gLineas = el("g", { "pointer-events": "none" });
    const gNombres = el("g", { "pointer-events": "none" });
    const gTramos = el("g", { class: "faro-mapa__tramos" });
    const gSel = el("g", { "pointer-events": "none" });
    const gReportes = el("g", { "pointer-events": "none" });
    const gRutas = el("g", { class: "faro-mapa__rutas", "pointer-events": "none" });
    const gFaros = el("g", { class: "faro-mapa__faros" });
    const gCupones = el("g", { "pointer-events": "none" });
    const gPuntos = el("g", { "pointer-events": "none" });
    mundo.append(gBloques, gLotes, gRelleno, gCalles, gLineas, gNombres, gTramos, gSel, gReportes, gRutas, gFaros, gCupones, gPuntos);
    svg.append(fondo, mundo);
    contenedor.appendChild(svg);

    // ---------------------------------------------------------------- controles
    const ctl = html("div", "faro-mapa__ctl");
    const boton = (clase, etiqueta, icono, fn) => {
      const b = html("button", "faro-mapa__btn " + clase, { type: "button", "aria-label": etiqueta, title: etiqueta });
      b.innerHTML = icono;
      b.addEventListener("click", fn);
      return b;
    };
    const ICO = {
      mas: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      menos: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      centro: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
      info: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.2" fill="currentColor"/></svg>',
    };
    let bLey = null, panelLey = null;
    if (op.leyenda) {
      bLey = boton("faro-mapa__btn--ley", "Leyenda del mapa", ICO.info, () => {
        const abrir = panelLey.hidden;
        panelLey.hidden = !abrir;
        bLey.setAttribute("aria-expanded", String(abrir));
      });
      bLey.setAttribute("aria-expanded", "false");
      panelLey = leyenda();
      panelLey.hidden = true;
      ctl.appendChild(bLey);
    }
    const bMas = boton("", "Acercar el mapa", ICO.mas, () => zoomCentro(1.45));
    const bMenos = boton("", "Alejar el mapa", ICO.menos, () => zoomCentro(1 / 1.45));
    const bCentro = boton("faro-mapa__btn--centro", "Recentrar el mapa", ICO.centro, () => recentrar());
    ctl.append(bMas, bMenos, bCentro);
    contenedor.append(ctl);
    if (panelLey) contenedor.appendChild(panelLey);

    // ---------------------------------------------------------------- geometría de la vista
    const kMin = () => {
      const bw = lim.x1 - lim.x0 + 2 * paso * 0.6, bh = lim.y1 - lim.y0 + 2 * paso * 0.6;
      return Math.min(W / bw, H / bh) * 0.92;
    };
    function centroUtil() { return { x: W / 2, y: inset.arriba + (H - inset.arriba - inset.abajo) / 2 }; }
    function limitar(v) {
      const k = Math.min(K_MAX, Math.max(kMin(), v.k));
      const c = centroUtil();
      let cx = (c.x - v.tx) / k, cy = (c.y - v.ty) / k;                    // punto del mundo bajo el centro útil
      cx = Math.min(lim.x1 + paso * 0.5, Math.max(lim.x0 - paso * 0.5, cx));
      cy = Math.min(lim.y1 + paso * 0.5, Math.max(lim.y0 - paso * 0.5, cy));
      return { k, tx: c.x - cx * k, ty: c.y - cy * k };
    }
    function vistaCentrada(x, y, k) { return limitar({ k, tx: centroUtil().x - x * k, ty: centroUtil().y - y * k }); }

    function aplicar() {
      mundo.setAttribute("transform", `translate(${vista.tx.toFixed(2)} ${vista.ty.toFixed(2)}) scale(${vista.k.toFixed(4)})`);
      escalados.forEach(({ g, x, y, s, rot, oy }) => g.setAttribute("transform", `translate(${x} ${y})${rot ? ` rotate(${rot})` : ""} scale(${(s / vista.k).toFixed(4)})${oy ? ` translate(0 ${oy})` : ""}`));
      const k = vista.k;
      etiquetas.forEach(({ g, avenida }) => { g.style.display = (avenida ? k >= 0.5 : k >= 0.6) ? "" : "none"; });
      contenedor.classList.toggle("faro-mapa--zoom", k >= 1.05);
      bMas.disabled = k >= K_MAX - 0.01; bMenos.disabled = k <= kMin() + 0.01;
    }
    function fijar(v) { hayVista = true; vista = limitar(v); aplicar(); }

    function animarA(destino, ms = 380) {
      cancelAnimationFrame(animId);
      hayVista = true;
      const d = limitar(destino);
      if (ms <= 0 || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) { vista = d; aplicar(); return; }
      const o = { ...vista }, t0 = performance.now();
      const paso_ = (t) => {
        const p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
        const k = o.k * Math.pow(d.k / o.k, e);
        vista = { k, tx: o.tx + (d.tx - o.tx) * e, ty: o.ty + (d.ty - o.ty) * e };
        aplicar();
        if (p < 1) animId = requestAnimationFrame(paso_);
      };
      animId = requestAnimationFrame(paso_);
    }
    function zoomEn(px, py, factor, animar) {
      const k = Math.min(K_MAX, Math.max(kMin(), vista.k * factor));
      const r = k / vista.k;
      const v = { k, tx: px - (px - vista.tx) * r, ty: py - (py - vista.ty) * r };
      if (animar) animarA(v, 220); else fijar(v);
    }
    function zoomCentro(factor) { const c = centroUtil(); zoomEn(c.x, c.y, factor, true); }

    function siListo(fn) { if (W > 0 && H > 0) fn(); else pendientes.push(fn); }
    function ajustarTodo(animar) {
      siListo(() => {
        const k = kMin() / 0.92;
        const v = vistaCentrada((lim.x0 + lim.x1) / 2, (lim.y0 + lim.y1) / 2, k);
        if (animar) animarA(v); else { vista = v; aplicar(); }
      });
    }
    function centrarNodo(id, k, animar = true) {
      const n = nodos.get(id);
      if (!n) return;
      siListo(() => {
        const v = vistaCentrada(n.x, n.y, k || Math.max(vista.k, 0.85));
        hayVista = true;
        if (animar) animarA(v); else { vista = v; aplicar(); }
      });
    }
    /** Acomoda la vista para que quepan todos los puntos (p. ej. una ruta) en el área libre del mapa. */
    function encuadrar(pts, { animar = true, relleno = 56 } = {}) {
      if (!pts || !pts.length) return;
      siListo(() => {
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        const libreW = Math.max(80, W - 2 * relleno), libreH = Math.max(80, H - inset.arriba - inset.abajo - 2 * relleno);
        const k = Math.min(K_MAX * 0.7, libreW / Math.max(60, x1 - x0), libreH / Math.max(60, y1 - y0));
        const v = vistaCentrada((x0 + x1) / 2, (y0 + y1) / 2, k);
        hayVista = true;
        if (animar) animarA(v, 450); else { vista = v; aplicar(); }
      });
    }
    function recentrar() {
      const id = puntos.origen != null ? puntos.origen : (puntos.negocio != null ? puntos.negocio : null);
      if (id != null) centrarNodo(id, Math.max(vista.k, 0.85)); else ajustarTodo(true);
    }
    function setInset(i) {
      inset = { arriba: (i && i.arriba) || 0, abajo: (i && i.abajo) || 0 };
    }

    function medir() {
      const w = contenedor.clientWidth, h = contenedor.clientHeight;
      if (w === W && h === H) return;
      const antes = W > 0 && H > 0;
      const centro = antes ? { x: (W / 2 - vista.tx) / vista.k, y: (H / 2 - vista.ty) / vista.k } : null;
      W = w; H = h;
      if (!(W > 0 && H > 0)) return;
      if (zona) {
        if (!hayVista) { ajustarTodo(false); }
        else if (centro) { vista = limitar({ k: vista.k, tx: W / 2 - centro.x * vista.k, ty: H / 2 - centro.y * vista.k }); aplicar(); }
      }
      while (pendientes.length) pendientes.shift()();
    }
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(medir) : null;
    if (ro) ro.observe(contenedor); else window.addEventListener("resize", medir);

    // ---------------------------------------------------------------- curvas de las calles
    /** Curva cuadrática de un tramo: curvatura determinista (según los ids de sus cruces), igual en ambos sentidos. */
    function curvaDe(a) {
      const A = nodos.get(Math.min(a.a, a.b)), B = nodos.get(Math.max(a.a, a.b));
      const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
      const r = azar(A.id * 977 + B.id * 131 + 7);
      const signo = r() < 0.5 ? -1 : 1, mag = (0.05 + 0.07 * r()) * L * signo;
      return { A, B, cx: f1(mx - (dy / L) * mag), cy: f1(my + (dx / L) * mag) };
    }
    const claveArista = (a, b) => Math.min(a, b) + "-" + Math.max(a, b);
    /** Segmento "M x y Q cx cy x y" de A a B siguiendo la curva del tramo (o recta si no existe). */
    function segmento(ida, idb) {
      const cv = curvas.get(claveArista(ida, idb));
      const P = nodos.get(ida), Q = nodos.get(idb);
      if (!cv) return `L${Q.x} ${Q.y}`;
      return `Q${cv.cx} ${cv.cy} ${Q.x} ${Q.y}`;
    }
    function trazo(ids) {
      const p0 = nodos.get(ids[0]);
      let d = `M${p0.x} ${p0.y}`;
      for (let i = 1; i < ids.length; i++) d += segmento(ids[i - 1], ids[i]);
      return d;
    }
    /** Punto de la curva en t (0..1) y su ángulo en grados. */
    function puntoEn(a, t = 0.5) {
      const cv = curvas.get(claveArista(a.a, a.b));
      const { A, B, cx, cy } = cv;
      const u = 1 - t;
      const x = u * u * A.x + 2 * u * t * cx + t * t * B.x, y = u * u * A.y + 2 * u * t * cy + t * t * B.y;
      const tx = 2 * u * (cx - A.x) + 2 * t * (B.x - cx), ty = 2 * u * (cy - A.y) + 2 * t * (B.y - cy);
      let ang = (Math.atan2(ty, tx) * 180) / Math.PI;
      if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
      return { x, y, ang };
    }

    // ---------------------------------------------------------------- dibujo
    function cargar(z) {
      zona = z;
      nodos = new Map(z.nodos.map((n) => [n.id, n]));
      curvas = new Map(z.aristas.map((a) => [claveArista(a.a, a.b), curvaDe(a)]));
      const xs = z.nodos.map((n) => n.x), ys = z.nodos.map((n) => n.y);
      lim = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
      const col1 = z.nodos.find((n) => n.col === 1 && n.fila === 0), col0 = z.nodos.find((n) => n.col === 0 && n.fila === 0);
      paso = col1 && col0 ? Math.hypot(col1.x - col0.x, col1.y - col0.y) : 140;
      escalados.length = 0; etiquetas.length = 0;
      dibujarMapaBase();
      dibujarCalles();
      dibujarFaros();
      dibujarCupones();
      dibujarPuntos();
      dibujarSeleccion();
      medir();
      if (W > 0 && H > 0 && !hayVista) ajustarTodo(false);
      aplicar();
    }

    function nodoPor(c, r) { return zona.nodos.find((n) => n.col === c && n.fila === r); }

    function dibujarMapaBase() {
      gBloques.textContent = ""; gLotes.textContent = ""; gRelleno.textContent = ""; gNombres.textContent = "";
      const cols = Math.max(...zona.nodos.map((n) => n.col)) + 1, filas = Math.max(...zona.nodos.map((n) => n.fila)) + 1;
      const rnd = azar(20261129);

      // manzanas: una por cuadro entre cruces, siguiendo las mismas curvas de las calles
      for (let c = 0; c < cols - 1; c++) {
        for (let r = 0; r < filas - 1; r++) {
          const A = nodoPor(c, r), B = nodoPor(c + 1, r), Cc = nodoPor(c + 1, r + 1), D = nodoPor(c, r + 1);
          if (!A || !B || !Cc || !D) continue;
          gBloques.appendChild(el("path", { d: trazo([A.id, B.id, Cc.id, D.id, A.id]) + "Z", fill: C.manzana }));
          // lotes sugeridos: 1 a 3 líneas finas que cruzan la manzana
          const n = 1 + Math.floor(rnd() * 3);
          for (let i = 1; i <= n; i++) {
            const u = (i + (rnd() - 0.5) * 0.3) / (n + 1);
            const p = (P, Q, t) => ({ x: P.x + (Q.x - P.x) * t, y: P.y + (Q.y - P.y) * t });
            const a1 = p(A, B, u), b1 = p(D, Cc, u);
            const m = (P, Q, t) => p(P, Q, t);
            gLotes.appendChild(el("line", { x1: f1(m(a1, b1, 0.16).x), y1: f1(m(a1, b1, 0.16).y), x2: f1(m(a1, b1, 0.84).x), y2: f1(m(a1, b1, 0.84).y), stroke: C.lote, "stroke-width": 1.4, "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }));
          }
        }
      }

      // calles de relleno (no navegables): prolongan las calles hacia afuera, un anillo exterior y algunos callejones
      const relleno = (x1, y1, x2, y2, curv) => {
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
        const cx = mx - (dy / L) * curv * L, cy = my + (dx / L) * curv * L;
        gRelleno.appendChild(el("path", { d: `M${f1(x1)} ${f1(y1)}Q${f1(cx)} ${f1(cy)} ${f1(x2)} ${f1(y2)}`, fill: "none", stroke: LUZ[1].color, "stroke-width": ANCHO.relleno, "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }));
      };
      const bordes = zona.nodos.filter((n) => n.col === 0 || n.col === cols - 1 || n.fila === 0 || n.fila === filas - 1);
      const finales = [];
      bordes.forEach((n) => {
        const salidas = [];
        if (n.col === 0) salidas.push([-1, 0]);
        if (n.col === cols - 1) salidas.push([1, 0]);
        if (n.fila === 0) salidas.push([0, -1]);
        if (n.fila === filas - 1) salidas.push([0, 1]);
        salidas.forEach(([ux, uy]) => {
          const largo = paso * (0.95 + rnd() * 0.5), giro = (rnd() - 0.5) * 0.5;
          const ex = n.x + (ux * Math.cos(giro) - uy * Math.sin(giro)) * largo, ey = n.y + (ux * Math.sin(giro) + uy * Math.cos(giro)) * largo;
          relleno(n.x, n.y, ex, ey, (rnd() - 0.5) * 0.18);
          finales.push({ x: ex, y: ey, ang: Math.atan2(ey - (lim.y0 + lim.y1) / 2, ex - (lim.x0 + lim.x1) / 2) });
        });
      });
      finales.sort((a, b) => a.ang - b.ang);
      finales.forEach((p, i) => { const q = finales[(i + 1) % finales.length]; if (Math.hypot(p.x - q.x, p.y - q.y) < paso * 2.6) relleno(p.x, p.y, q.x, q.y, (rnd() - 0.5) * 0.3); });
      // callejones dentro de algunas manzanas
      for (let i = 0; i < 9; i++) {
        const c = Math.floor(rnd() * (cols - 1)), r = Math.floor(rnd() * (filas - 1));
        const A = nodoPor(c, r), B = nodoPor(c + 1, r), D = nodoPor(c, r + 1), Cc = nodoPor(c + 1, r + 1);
        if (!A || !B || !D || !Cc) continue;
        const t = 0.3 + rnd() * 0.4, vertical = rnd() < 0.5;
        const p0 = vertical ? { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t } : { x: A.x + (D.x - A.x) * t, y: A.y + (D.y - A.y) * t };
        const p1 = vertical ? { x: D.x + (Cc.x - D.x) * t, y: D.y + (Cc.y - D.y) * t } : { x: B.x + (Cc.x - B.x) * t, y: B.y + (Cc.y - B.y) * t };
        const u = 0.1, v = 0.45 + rnd() * 0.2;
        relleno(p0.x + (p1.x - p0.x) * u, p0.y + (p1.y - p0.y) * u, p0.x + (p1.x - p0.x) * v, p0.y + (p1.y - p0.y) * v, (rnd() - 0.5) * 0.2);
      }
    }

    function categoria(a) {
      const A = nodos.get(a.a), B = nodos.get(a.b);
      if (A.col !== B.col && A.fila !== B.fila) return "diagonal";
      if (A.col === B.col) {
        const nom = nombresCalles(zona.nodos).cols.get(A.col) || "";
        return /^av\./i.test(nom) ? "avenida" : "calle";
      }
      return "calle";
    }

    function dibujarCalles() {
      gCalles.textContent = ""; gLineas.textContent = ""; gTramos.textContent = ""; gReportes.textContent = ""; gNombres.textContent = "";
      escalados.splice(0, escalados.length, ...escalados.filter((e) => !e.rep && !e.calle));
      etiquetas.length = 0;
      const nom = nombresCalles(zona.nodos);
      const puestos = new Set();
      zona.aristas.forEach((a) => {
        const A = nodos.get(a.a), B = nodos.get(a.b);
        if (!A || !B) return;
        const est = LUZ[a.luz] || LUZ[2], cat = categoria(a);
        const d = trazo([Math.min(a.a, a.b), Math.max(a.a, a.b)]);
        const ancho = f1(ANCHO[cat] * est.ancho);
        gCalles.appendChild(el("path", { d, fill: "none", stroke: est.color, "stroke-width": ancho, "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" }));
        // poca luz: punteado fino sobre la calle (además de ser más oscura y delgada)
        if (a.luz === 1) gLineas.appendChild(el("path", { d, fill: "none", stroke: "#8A9DBF", "stroke-width": 1.4, "stroke-dasharray": "0.1 5", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" }));

        // nombre de la calle sobre algunos tramos (tamaño constante en pantalla)
        let texto = null, avenida = false;
        if (cat !== "diagonal") {
          if (A.col === B.col) { texto = nom.cols.get(A.col); avenida = cat === "avenida"; }
          else texto = nom.filas.get(A.fila);
        }
        if (texto) {
          const clave = texto + ":" + Math.floor((A.col + B.col + A.fila + B.fila) / 3);
          if (!puestos.has(clave) && (A.fila + A.col) % 3 === (A.col === B.col ? 1 : 0)) {
            puestos.add(clave);
            const pt = puntoEn(a);
            const g = el("g");
            g.appendChild(txt({ class: "faro-mapa__calle" + (avenida ? " faro-mapa__calle--av" : ""), "text-anchor": "middle", "dominant-baseline": "central" }, texto));
            gNombres.appendChild(g);
            escalados.push({ g, x: f1(pt.x), y: f1(pt.y), s: 1, rot: f1(pt.ang), calle: true });
            etiquetas.push({ g, avenida });
          }
        }

        // zona de toque (solo cuando se elige un tramo para reportar)
        const desc = `${est.nombre}, ${Math.round(a.metros)} m` + (a.reportes ? `, ${a.reportes} reporte(s) aprobado(s)` : "");
        if (op.modo === "tramo") {
          const g = el("g", { class: "faro-mapa__tramo", "data-arista": a.id, tabindex: "0", role: "button", "aria-label": desc + ` entre ${A.nombre} y ${B.nombre}` });
          g.appendChild(tit(`${A.nombre} → ${B.nombre}: ${desc}`));
          g.appendChild(el("path", { d, fill: "none", stroke: "transparent", "stroke-width": 44, "vector-effect": "non-scaling-stroke", "stroke-linecap": "round" }));
          g.style.cursor = "pointer";
          g.addEventListener("click", (e) => { e.stopPropagation(); if (!suprimirClick && op.onTramo) op.onTramo(a); });
          g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (op.onTramo) op.onTramo(a); } });
          gTramos.appendChild(g);
        }
        // reportes aprobados: pequeño triángulo dorado plano
        if (a.reportes > 0) {
          const pt = puntoEn(a);
          const g = el("g", { "pointer-events": "none" });
          g.append(tit(`${a.reportes} reporte(s) aprobado(s) en este tramo`),
            el("path", { d: "M0 -9 L9.5 7 H-9.5 Z", fill: C.dorado, stroke: C.medianoche, "stroke-width": 1.6, "stroke-linejoin": "round" }),
            el("path", { d: "M0 -3.2v5", stroke: C.medianoche, "stroke-width": 1.8, "stroke-linecap": "round" }),
            el("circle", { cx: 0, cy: 4.4, r: 1, fill: C.medianoche }));
          gReportes.appendChild(g);
          escalados.push({ g, x: f1(pt.x), y: f1(pt.y), s: 1, rep: true });
        }
      });
      resaltarTramo(tramoSel);
    }

    function iconoFaro(f) {
      const abierto = !!f.abierto;
      const g = el("g", { class: "faro-mapa__faro " + (abierto ? "es-abierto" : "es-cerrado"), "data-faro": f.id, tabindex: "0", role: "button" });
      g.setAttribute("aria-label", `${f.nombre}, ${f.giro}, ${abierto ? "Abierto" : "Cerrado"} a las ${zona.hora}`);
      g.style.cursor = "pointer";
      g.appendChild(tit(`${f.nombre} — ${abierto ? "Abierto" : "Cerrado"}`));
      g.appendChild(el("circle", { r: 24, fill: "transparent" }));                          // zona de toque ≥ 44 px
      g.appendChild(el("circle", { class: "faro-mapa__sel", r: 14.5, fill: "none", stroke: C.marfil, "stroke-width": 2, display: "none" }));
      // plano: abierto = relleno Miel · cerrado = relleno Pizarra con borde Dorado fino (se distinguen también por relleno)
      g.appendChild(el("circle", { class: "faro-mapa__disco", r: 10, fill: abierto ? C.miel : C.pizarra, stroke: abierto ? C.medianoche : C.dorado, "stroke-width": abierto ? 1 : 1.6 }));
      g.appendChild(txt({ y: 27, "text-anchor": "middle", class: "faro-mapa__etiqueta" }, f.nombre));
      const act = () => { seleccionarFaro(f.id); if (op.onFaro) op.onFaro(f); };
      g.addEventListener("click", (e) => { e.stopPropagation(); if (!suprimirClick) act(); });
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } });
      return g;
    }

    function dibujarFaros() {
      gFaros.textContent = "";
      escalados.splice(0, escalados.length, ...escalados.filter((e) => !e.faro));
      zona.faros.forEach((f) => {
        const n = nodos.get(f.nodo_id);
        if (!n) return;
        const g = iconoFaro(f);
        gFaros.appendChild(g);
        escalados.push({ g, x: n.x, y: n.y, s: 1, faro: true });
      });
      seleccionarFaro(faroSel);
    }

    /** Insignia de cupón (cuadro dorado con medalla) sobre los Faros que tienen cupón en la ruta. */
    function dibujarCupones() {
      gCupones.textContent = "";
      escalados.splice(0, escalados.length, ...escalados.filter((e) => !e.cupon));
      cupones.forEach((id) => {
        const n = nodos.get(id);
        if (!n) return;
        const g = el("g");
        g.append(tit("Cupón disponible en este Faro"),
          el("path", { d: "M-16 -43h32a6 6 0 0 1 6 6v19a6 6 0 0 1-6 6h-10l-6 7-6-7h-10a6 6 0 0 1-6-6v-19a6 6 0 0 1 6-6z", fill: C.dorado }),
          el("circle", { cx: 0, cy: -31, r: 5.2, fill: "none", stroke: C.marino, "stroke-width": 1.6 }),
          el("path", { d: "M-3.4 -26.4l-1.4 7 4.8-2.6 4.8 2.6-1.4-7", fill: "none", stroke: C.marino, "stroke-width": 1.6, "stroke-linejoin": "round", "stroke-linecap": "round" }));
        gCupones.appendChild(g);
        escalados.push({ g, x: n.x, y: n.y, s: 1, cupon: true });
      });
      aplicar();
    }

    function marcador(tipo, n) {
      const g = el("g", { class: "faro-mapa__marcador" });
      if (tipo === "origen") {
        g.append(tit("Tu posición: " + n.nombre), pin(C.dorado, 1));
      } else {
        const negocio = tipo === "negocio";
        g.append(tit((negocio ? "Ubicación del negocio: " : "Destino: ") + n.nombre), pin(negocio ? C.dorado : C.marfil, 1.15));
        if (negocio) g.appendChild(txt({ "text-anchor": "middle", y: -12, "font-size": 11, "font-weight": 800, fill: C.medianoche }, "★"));
      }
      return g;
    }
    function dibujarPuntos() {
      gPuntos.textContent = "";
      escalados.splice(0, escalados.length, ...escalados.filter((e) => !e.punto));
      ["destino", "origen", "negocio"].forEach((t) => {
        const n = puntos[t] != null ? nodos.get(puntos[t]) : null;
        if (!n) return;
        const g = marcador(t, n);
        gPuntos.appendChild(g);
        escalados.push({ g, x: n.x, y: n.y, s: 1, punto: true });
      });
      aplicar();
    }

    // ---------------------------------------------------------------- API pública
    function marcarPunto(tipo, nodoId) {
      puntos[tipo] = nodoId === undefined ? null : nodoId;
      if (zona) dibujarPuntos();
    }
    function marcarCupones(ids) { cupones = (ids || []).slice(); if (zona) dibujarCupones(); }

    function limpiarRutas() { gRutas.textContent = ""; }
    /** rutas: [{nodos:[ids], puntos:[{x,y}]}]; la activa va arriba, en Miel con borde Medianoche; las demás, punteadas en Marfil. */
    function dibujarRutas(rutas, { activa = 0 } = {}) {
      limpiarRutas();
      const orden = rutas.map((r, i) => ({ r, i })).sort((a, b) => (a.i === activa) - (b.i === activa));
      orden.forEach(({ r, i }) => {
        if (!r) return;
        let d = null;
        if (r.nodos && r.nodos.length > 1 && r.nodos.every((id) => nodos.has(id))) d = trazo(r.nodos);
        else if (r.puntos && r.puntos.length > 1) d = "M" + r.puntos.map((p) => `${p.x} ${p.y}`).join("L");
        if (!d) return;
        const esActiva = i === activa;
        const g = el("g", { class: "faro-mapa__ruta " + (esActiva ? "activa" : "alterna") });
        g.appendChild(tit(i === 0 ? "Ruta Faro" : "Ruta alternativa"));
        const comun = { d, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" };
        if (esActiva) {
          g.appendChild(el("path", { ...comun, stroke: C.medianoche, "stroke-width": 8.5, class: "faro-mapa__borde" }));
          g.appendChild(el("path", { ...comun, stroke: C.miel, "stroke-width": 4.5, class: "faro-mapa__traza" }));
        } else {
          g.appendChild(el("path", { ...comun, stroke: C.medianoche, "stroke-width": 7, class: "faro-mapa__borde" }));
          g.appendChild(el("path", { ...comun, stroke: C.marfil, "stroke-width": 3.5, "stroke-dasharray": "2 7", class: "faro-mapa__traza-alt" }));
        }
        gRutas.appendChild(g);
      });
    }

    function seleccionarFaro(id) {
      faroSel = id === undefined ? null : id;
      gFaros.querySelectorAll(".faro-mapa__faro").forEach((g) => {
        const sel = faroSel !== null && Number(g.getAttribute("data-faro")) === faroSel;
        g.classList.toggle("seleccionado", sel);
        g.setAttribute("aria-pressed", sel ? "true" : "false");
        const aro = g.querySelector(".faro-mapa__sel");
        if (aro) aro.setAttribute("display", sel ? "inline" : "none");
        if (sel) gFaros.appendChild(g); // al frente
      });
    }

    function dibujarSeleccion() {
      gSel.textContent = "";
      if (tramoSel === null || !zona) return;
      const a = zona.aristas.find((x) => x.id === tramoSel);
      if (!a || !nodos.get(a.a) || !nodos.get(a.b)) return;
      const d = trazo([Math.min(a.a, a.b), Math.max(a.a, a.b)]);
      const base = { d, fill: "none", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke" };
      gSel.append(el("path", { ...base, stroke: C.medianoche, "stroke-width": 12 }), el("path", { ...base, stroke: C.dorado, "stroke-width": 6 }));
    }
    function resaltarTramo(id) {
      tramoSel = id === undefined ? null : id;
      gTramos.querySelectorAll(".faro-mapa__tramo").forEach((g) => {
        const sel = tramoSel !== null && Number(g.getAttribute("data-arista")) === tramoSel;
        g.classList.toggle("seleccionado", sel);
      });
      dibujarSeleccion();
    }

    function setModo(m) {
      op.modo = m;
      gFaros.setAttribute("pointer-events", m === "tramo" ? "none" : "auto");   // al reportar un tramo los Faros no estorban
      if (zona) dibujarCalles();
    }

    // ---------------------------------------------------------------- gestos (pointer events)
    const ptrs = new Map();
    let gesto = null;
    let suprimirClick = false;
    function local(ev) {
      const r = svg.getBoundingClientRect();
      const s = r.width / (svg.clientWidth || r.width || 1);      // el marco del teléfono puede estar reducido con transform: scale()
      return { x: (ev.clientX - r.left) / s, y: (ev.clientY - r.top) / s, s };
    }
    svg.addEventListener("pointerdown", (ev) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      cancelAnimationFrame(animId);
      const p = local(ev);
      ptrs.set(ev.pointerId, { x: p.x, y: p.y });
      if (ptrs.size === 1) gesto = { tipo: "mover", movido: false, x0: p.x, y0: p.y, v0: { ...vista } };
      else if (ptrs.size === 2) {
        const [a, b] = [...ptrs.values()];
        gesto = { tipo: "pinch", movido: true, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, v0: { ...vista }, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      }
    });
    svg.addEventListener("pointermove", (ev) => {
      if (!ptrs.has(ev.pointerId) || !gesto) return;
      const p = local(ev);
      ptrs.set(ev.pointerId, { x: p.x, y: p.y });
      if (gesto.tipo === "pinch" && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const k = Math.min(K_MAX, Math.max(kMin(), gesto.v0.k * d / gesto.d0));
        const wx = (gesto.m0.x - gesto.v0.tx) / gesto.v0.k, wy = (gesto.m0.y - gesto.v0.ty) / gesto.v0.k;   // punto del mundo bajo los dedos al empezar
        fijar({ k, tx: m.x - wx * k, ty: m.y - wy * k });
      } else if (gesto.tipo === "mover") {
        const dx = p.x - gesto.x0, dy = p.y - gesto.y0;
        if (!gesto.movido && Math.hypot(dx, dy) > 7) {
          gesto.movido = true;
          try { svg.setPointerCapture(ev.pointerId); } catch (_) { /* nada */ }
          contenedor.classList.add("arrastrando");
        }
        if (gesto.movido) fijar({ k: gesto.v0.k, tx: gesto.v0.tx + dx, ty: gesto.v0.ty + dy });
      }
    });
    function soltar(ev) {
      if (!ptrs.has(ev.pointerId)) return;
      ptrs.delete(ev.pointerId);
      if (gesto && gesto.movido) { suprimirClick = true; setTimeout(() => { suprimirClick = false; }, 60); }
      if (ptrs.size === 1 && gesto) {            // de pellizco a arrastre con el dedo que queda
        const [p] = [...ptrs.values()];
        gesto = { tipo: "mover", movido: true, x0: p.x, y0: p.y, v0: { ...vista } };
      } else if (ptrs.size === 0) { gesto = null; contenedor.classList.remove("arrastrando"); }
    }
    svg.addEventListener("pointerup", soltar);
    svg.addEventListener("pointercancel", soltar);
    svg.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const p = local(ev);
      zoomEn(p.x, p.y, Math.exp(-ev.deltaY * 0.0016), false);
    }, { passive: false });

    // toque en el mapa vacío → cruce más cercano
    svg.addEventListener("click", (ev) => {
      if (suprimirClick || !zona || !op.onPunto) return;
      const p = local(ev);
      const x = (p.x - vista.tx) / vista.k, y = (p.y - vista.ty) / vista.k;
      if (x < lim.x0 - 70 || x > lim.x1 + 70 || y < lim.y0 - 70 || y > lim.y1 + 70) return;
      let mejor = null, d2 = Infinity;
      nodos.forEach((n) => { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < d2) { d2 = d; mejor = n; } });
      if (mejor) op.onPunto({ nodo: mejor.id, nombre: mejor.nombre, x: mejor.x, y: mejor.y });
    });

    function leyenda() {
      const d = html("div", "faro-mapa__leyenda", { role: "group", "aria-label": "Leyenda del mapa" });
      const item = (svgInner, texto) => {
        const s = html("div", "faro-mapa__leyenda-item");
        s.innerHTML = svgInner;
        const t = document.createElement("span"); t.textContent = texto; s.appendChild(t);
        return s;
      };
      const calle = (nivel) => {
        const e = LUZ[nivel];
        return `<svg width="40" height="16" viewBox="0 0 40 16" aria-hidden="true"><line x1="3" y1="8" x2="37" y2="8" stroke="${e.color}" stroke-width="${f1(9 * e.ancho)}" stroke-linecap="round"/>${nivel === 1 ? '<line x1="4" y1="8" x2="36" y2="8" stroke="#8A9DBF" stroke-width="1.4" stroke-dasharray="0.1 5" stroke-linecap="round"/>' : ""}</svg>`;
      };
      const tri = `<svg width="40" height="22" viewBox="-20 -11 40 22" aria-hidden="true"><path d="M0 -9 L9.5 7 H-9.5Z" fill="${C.dorado}" stroke="${C.medianoche}" stroke-width="1.6" stroke-linejoin="round"/><path d="M0 -3.2v5" stroke="${C.medianoche}" stroke-width="1.8" stroke-linecap="round"/><circle cy="4.4" r="1" fill="${C.medianoche}"/></svg>`;
      const disco = (ab) => `<svg width="40" height="24" viewBox="-20 -12 40 24" aria-hidden="true"><circle r="9" fill="${ab ? C.miel : C.pizarra}" stroke="${ab ? C.medianoche : C.dorado}" stroke-width="${ab ? 1 : 1.6}"/></svg>`;
      d.append(
        item(calle(3), "Bien iluminada"),
        item(calle(2), "Luz media"),
        item(calle(1), "Poca luz"),
        item(disco(true), "Faro abierto"),
        item(disco(false), "Faro cerrado"),
        item(tri, "Reporte aprobado"));
      return d;
    }

    function destruir() {
      if (ro) ro.disconnect(); else window.removeEventListener("resize", medir);
      cancelAnimationFrame(animId);
      contenedor.textContent = ""; contenedor.classList.remove("faro-mapa");
    }

    return {
      cargar, marcarPunto, marcarCupones, dibujarRutas, limpiarRutas, seleccionarFaro, resaltarTramo, setModo, destruir,
      centrarNodo, encuadrar, recentrar, setInset, medir,
      nodo: (id) => nodos.get(id),
      get zona() { return zona; },
      get zoom() { return vista.k; },
    };
  }

  // estilos del mapa (autocontenidos para que mapa.js funcione en cualquier página). Todo plano: sin sombras, filtros ni animaciones.
  const css = document.createElement("style");
  css.textContent = `
    .faro-mapa { position: relative; width: 100%; height: 100%; min-height: 340px; overflow: hidden; background: ${C.fondo}; border-radius: 14px; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
    .faro-mapa__svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
    .faro-mapa.arrastrando .faro-mapa__svg { cursor: grabbing; }
    .faro-mapa__fondo { fill: ${C.fondo}; }
    .faro-mapa__calle { font: 700 10.5px "Nunito Sans", system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; fill: ${C.nombre}; opacity: .85; paint-order: stroke; stroke: ${C.fondo}; stroke-width: 4px; stroke-linejoin: round; }
    .faro-mapa__calle--av { font-size: 11.5px; font-weight: 800; opacity: 1; }
    .faro-mapa__etiqueta { font: 800 12.5px "Nunito Sans", system-ui, sans-serif; fill: ${C.marfil}; paint-order: stroke; stroke: ${C.fondo}; stroke-width: 4.5px; stroke-linejoin: round; display: none; }
    .faro-mapa--zoom .faro-mapa__etiqueta, .faro-mapa__faro.seleccionado .faro-mapa__etiqueta { display: block; }
    .faro-mapa__faro:focus-visible, .faro-mapa__tramo:focus-visible { outline: none; }
    .faro-mapa__faro:focus-visible .faro-mapa__disco { stroke: #fff; stroke-width: 3; }
    .faro-mapa__tramo:focus-visible path { stroke: rgba(253, 253, 241, .35); }
    .faro-mapa__ctl { position: absolute; left: 14px; bottom: calc(var(--inf, 0px) + 14px); display: flex; flex-direction: column; gap: 8px; z-index: 3; }
    .faro-mapa__btn { width: 44px; height: 44px; border-radius: 50%; border: 0; background: ${C.pizarra}; color: ${C.marfil}; display: grid; place-items: center; cursor: pointer; padding: 0; }
    .faro-mapa__btn:disabled { opacity: .4; cursor: not-allowed; }
    .faro-mapa__btn:active:not(:disabled) { background: #2C4670; }
    .faro-mapa__btn[aria-expanded="true"] { background: ${C.dorado}; color: ${C.marino}; }
    .faro-mapa__leyenda { position: absolute; left: 66px; bottom: calc(var(--inf, 0px) + 14px); z-index: 3; width: 214px; padding: 10px 12px; border-radius: 18px; background: ${C.pizarra}; display: grid; gap: 2px; }
    .faro-mapa__leyenda[hidden] { display: none; }
    .faro-mapa__leyenda-item { display: flex; align-items: center; gap: 10px; font: 700 13.5px "Nunito Sans", system-ui, sans-serif; color: ${C.marfil}; min-height: 28px; }
    .faro-mapa__leyenda-item svg { flex: none; }
  `;
  document.head.appendChild(css);

  window.Faro = Object.assign(window.Faro || {}, { Mapa: { crear, LUZ } });
})();
