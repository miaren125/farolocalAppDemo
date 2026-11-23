"""Auditoría automática de accesibilidad (WCAG 2.1 A/AA, incluye contraste de color) con axe-core + Playwright,
más mediciones de tiempo de carga/respuesta (RNF < 3 s) y tamaño de los objetivos táctiles.

Requisitos: pip install playwright ; axe-core descargado:
    curl -L https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js -o axe.min.js
Uso (servidor corriendo con la base recién sembrada):
    FARO_URL=http://localhost:5000 python3 tools/auditoria_accesibilidad.py ruta/a/axe.min.js
Es una ayuda automática: NO sustituye una revisión manual ni pruebas con lector de pantalla.
"""
import json
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("FARO_URL", "http://localhost:5000").rstrip("/")
AXE = sys.argv[1]
MOVIL = {"width": 390, "height": 844}
ESCRITORIO = {"width": 1280, "height": 900}
resultados = []   # (pantalla, [violaciones])


def auditar(pg, nombre):
    pg.wait_for_timeout(500)
    r = pg.evaluate("""async () => {
        const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } });
        return r.violations.map(v => ({ id: v.id, impacto: v.impact, ayuda: v.help, nodos: v.nodes.slice(0, 4).map(n => n.target.join(' ') + ' :: ' + (n.any[0] ? n.any[0].message : n.failureSummary)) }));
    }""")
    resultados.append((nombre, r))
    print(f"  {'OK ' if not r else 'FALLA'} {nombre}" + ("" if not r else f"  ({len(r)} tipos de problema)"))
    for v in r:
        print(f"      - [{v['impacto']}] {v['id']}: {v['ayuda']}")
        for n in v["nodos"]:
            print(f"          {n[:210]}")


def login(pg, ruta, correo, pwd):
    pg.goto(BASE + ruta)
    pg.fill("#l-correo", correo); pg.fill("#l-pass", pwd)
    pg.click("#panel-login button[type=submit]")


def objetivos_pequenos(pg, selector, minimo=44):
    """Elementos tocables visibles que miden menos de `minimo` px en alguna dimensión."""
    return pg.evaluate("""([sel, min]) => [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null).map(e => {
        const r = e.getBoundingClientRect(); return { el: (e.id || e.className || e.tagName).toString().slice(0, 40) + ' ' + (e.textContent || '').trim().slice(0, 18), w: Math.round(r.width), h: Math.round(r.height) };
    }).filter(x => x.w < min || x.h < min)""", [selector, minimo])


with sync_playwright() as p:
    b = p.chromium.launch(channel=os.environ.get("FARO_NAVEGADOR", "msedge"), headless=True)

    print("== APP DEL PEATÓN (390 px) ==")
    ctx = b.new_context(viewport=MOVIL, locale="es-MX", bypass_csp=True)   # bypass_csp solo para inyectar axe
    pg = ctx.new_page()
    pg.goto(BASE + "/app/"); pg.add_script_tag(path=AXE); pg.wait_for_selector("#panel-login")
    auditar(pg, "app · acceso (iniciar sesión)")
    pg.click("#tab-registro"); auditar(pg, "app · acceso (crear cuenta)")
    pg.click("#tab-login")
    t0 = time.time()
    pg.fill("#l-correo", "peaton@farolocal.mx"); pg.fill("#l-pass", "Peaton123"); pg.click("#panel-login button[type=submit]")
    pg.wait_for_selector("#vista-app:not([hidden]) .faro-mapa__faro")
    t_login_mapa = time.time() - t0
    pg.add_script_tag(path=AXE)
    auditar(pg, "app · mapa")
    pg.locator(".faro-mapa__faro").nth(1).click(); pg.wait_for_selector("#dlg-ficha[open] #ficha-titulo")
    auditar(pg, "app · ficha del Faro")
    t0 = time.time()
    pg.get_by_role("button", name="Ruta Faro hasta aquí").click(); pg.wait_for_selector("#ruta-resultado .resumen")
    t_ruta = time.time() - t0
    auditar(pg, "app · ruta calculada")
    pg.click('[data-vista=cupones]'); pg.wait_for_selector("#cupones-lista .cupon"); auditar(pg, "app · cupones")
    pg.locator("#cupones-lista .cupon button").first.click(); pg.wait_for_selector("#dlg-cupon[open] .qr svg"); auditar(pg, "app · código de cupón + QR")
    pg.click("#dlg-cupon .btn:last-child")
    pg.click('[data-vista=contactos]'); pg.wait_for_selector("#contactos-lista .item"); auditar(pg, "app · contactos y bandeja")
    pg.click("#contacto-nuevo"); pg.wait_for_selector("#dlg-contacto[open]"); auditar(pg, "app · formulario de contacto")
    pg.click("#contacto-cancelar")
    pg.click('[data-vista=reportar]'); pg.wait_for_selector("#reporte-tramo"); auditar(pg, "app · reportar zona")
    box = pg.locator("#sos-boton").bounding_box()
    pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2); pg.mouse.down(); pg.wait_for_timeout(2400); pg.mouse.up()
    pg.wait_for_selector("#dlg-sos[open] #sos-cuenta:not([hidden])"); auditar(pg, "app · SOS (cuenta regresiva)")
    pg.click("#sos-cancelar"); pg.click("#sos-cerrar-cancelado")
    print("\n  Objetivos táctiles < 44 px (app, vista Mapa):")
    pg.click('[data-vista=mapa]')
    chicos = objetivos_pequenos(pg, "button, a.btn, input, select, textarea, .faro-mapa__faro")
    for c in chicos:
        print("     ", c)
    if not chicos:
        print("      (ninguno)")
    ctx.close()

    print("\n== PORTAL (1280 px) ==")
    ctx = b.new_context(viewport=ESCRITORIO, locale="es-MX", bypass_csp=True)
    pg = ctx.new_page()
    pg.goto(BASE + "/portal/"); pg.add_script_tag(path=AXE); pg.wait_for_selector("#panel-login"); auditar(pg, "portal · acceso")
    pg.fill("#l-correo", "esquina@farolocal.mx"); pg.fill("#l-pass", "Comercio123"); pg.click("#panel-login button[type=submit]")
    pg.wait_for_selector("#v-panel:not([hidden]) .contador-caja")
    for hash_, nombre, esperar in (("panel", "comercio · panel", ".contador-caja"), ("negocio", "comercio · mi negocio", "#n-ubicacion"),
                                   ("cupones", "comercio · cupones", "#cupones-filas tr"), ("validar", "comercio · validar cupón", "#v-codigo")):
        pg.click(f"[data-vista={hash_}]"); pg.wait_for_selector(esperar); pg.add_script_tag(path=AXE); auditar(pg, nombre)
    pg.click("#cupon-nuevo") if False else None
    ctx.close()
    ctx = b.new_context(viewport=ESCRITORIO, locale="es-MX", bypass_csp=True)
    pg = ctx.new_page()
    login(pg, "/portal/", "admin@farolocal.mx", "Admin123!")
    pg.wait_for_selector("#v-resumen:not([hidden]) .contador-caja")
    for hash_, nombre, esperar in (("resumen", "admin · resumen", ".contador-caja"), ("negocios", "admin · validar negocios", "#negocios-filas .btn-enlace"),
                                   ("reportes", "admin · moderar reportes", "#reportes-filas .btn-enlace")):
        pg.click(f"[data-vista={hash_}]"); pg.wait_for_selector(esperar); pg.add_script_tag(path=AXE); auditar(pg, nombre)
    ctx.close()

    print("\n== TIEMPOS (RNF < 3 s) ==")
    ctx = b.new_context(viewport=MOVIL, locale="es-MX")
    pg = ctx.new_page()
    t0 = time.time(); pg.goto(BASE + "/app/", wait_until="load"); pg.wait_for_selector("#panel-login")
    t_carga = time.time() - t0
    nav = pg.evaluate("(() => { const n = performance.getEntriesByType('navigation')[0]; return { dom: Math.round(n.domContentLoadedEventEnd), carga: Math.round(n.loadEventEnd) }; })()")
    print(f"  carga de /app/ hasta ver el acceso: {t_carga:.2f} s  (DOMContentLoaded {nav['dom']} ms, load {nav['carga']} ms)")
    print(f"  iniciar sesión → mapa con Faros: {t_login_mapa:.2f} s")
    print(f"  Faro → 'Ruta Faro hasta aquí' → ruta en pantalla: {t_ruta:.2f} s")
    tiempos = []
    for _ in range(10):
        t0 = time.time()
        tok = pg.evaluate("fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({correo:'peaton@farolocal.mx',password:'Peaton123'})}).then(r=>r.json()).then(j=>j.token)")
        tiempos.append(time.time() - t0)
    print(f"  POST /api/auth/login (incluye hash de contraseña): mediana {sorted(tiempos)[5] * 1000:.0f} ms, máx {max(tiempos) * 1000:.0f} ms")
    rutas = []
    for _ in range(10):
        t0 = time.time()
        pg.evaluate("""(t) => fetch('/api/rutas',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({origen_nodo:0,destino_nodo:47,hora:'23:30'})}).then(r=>r.json())""", tok)
        rutas.append(time.time() - t0)
    print(f"  POST /api/rutas (Dijkstra, ruta larga 0→47): mediana {sorted(rutas)[5] * 1000:.0f} ms, máx {max(rutas) * 1000:.0f} ms")
    ctx.close()
    b.close()

malas = [(n, v) for n, v in resultados if v]
print(f"\nResumen axe: {len(resultados) - len(malas)} de {len(resultados)} pantallas sin violaciones WCAG A/AA detectables automáticamente.")
sys.exit(1 if malas else 0)
