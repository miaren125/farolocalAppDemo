"""Capturas REALES de la app del peatón rediseñada (celular 390×844 @2x y escritorio 1440×900).
Guarda en docs/capturas/ con el prefijo "movil-" / "escritorio-". Se detiene si hay errores de JS o de CSP.

Requisitos: pip install playwright  (usa Microsoft Edge; cambia FARO_NAVEGADOR=chrome si prefieres Chrome)
Uso (servidor corriendo y base sembrada):  python tools/capturas_movil.py
"""
import os
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("FARO_URL", "http://localhost:5000").rstrip("/")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "capturas")
CANAL = os.environ.get("FARO_NAVEGADOR", "msedge")
problemas = []


def vigilar(pg):
    pg.on("pageerror", lambda e: problemas.append(f"error de JS: {e}"))
    pg.on("console", lambda m: problemas.append(f"consola: {m.text}") if m.type == "error" or "Content Security Policy" in m.text else None)


def foto(pg, nombre):
    pg.wait_for_timeout(500)
    pg.screenshot(path=os.path.join(OUT, nombre + ".png"))
    print("  captura", nombre)


TACTIL = {"v": False}


def tocar_mapa(pg, x, y):
    """Toca un punto del mapa en coordenadas de la ventana."""
    if TACTIL["v"]:
        pg.touchscreen.tap(x, y)
    else:
        pg.mouse.click(x, y)


def recorrido(pw, prefijo, ctx_args):
    try:
        _recorrido(pw, prefijo, ctx_args)
    except Exception:
        raise


def _recorrido(pw, prefijo, ctx_args):
    TACTIL["v"] = bool(ctx_args.get("has_touch"))
    nav = pw.chromium.launch(channel=CANAL)
    ctx = nav.new_context(locale="es-MX", **ctx_args)
    pg = ctx.new_page()
    vigilar(pg)
    print(prefijo)
    pg.goto(BASE + "/app/")
    pg.wait_for_selector("#l-correo")
    foto(pg, f"{prefijo}-01-login")
    pg.click("#tab-registro")
    foto(pg, f"{prefijo}-02-registro")
    pg.click("#tab-login")
    pg.fill("#l-correo", "peaton@farolocal.mx")
    pg.fill("#l-pass", "Peaton123")
    pg.click("#panel-login button[type=submit]")
    pg.wait_for_selector(".nav")
    pg.evaluate("document.getElementById('hora').value='22:28'; document.getElementById('hora').dispatchEvent(new Event('change'))")
    pg.wait_for_timeout(900)
    foto(pg, f"{prefijo}-03-mapa")

    # leyenda
    pg.click(".faro-mapa__btn--ley")
    foto(pg, f"{prefijo}-04-mapa-leyenda")
    pg.click(".faro-mapa__btn--ley")

    # ficha de un Faro (toque real sobre el primero abierto)
    # primer Faro abierto cuyo centro sea realmente tocable (no tapado por los botones del mapa)
    centro = pg.evaluate("""() => {
      for (const d of document.querySelectorAll('.faro-mapa__faro.es-abierto .faro-mapa__disco')) {
        const r = d.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        const e = document.elementFromPoint(x, y);
        if (e && e.closest('.faro-mapa__faro')) return {x, y};
      }
      return null;
    }""")
    tocar_mapa(pg, centro["x"], centro["y"])
    pg.wait_for_selector("#dlg-ficha[open] #ficha-titulo")
    foto(pg, f"{prefijo}-05-ficha")
    pg.click("#dlg-ficha .btn-bloque")          # Ruta Faro hasta aquí
    pg.wait_for_selector(".resumen__min")
    pg.wait_for_timeout(1400)
    foto(pg, f"{prefijo}-06-ruta")
    pg.click("#ruta-resultado details summary")
    foto(pg, f"{prefijo}-07-ruta-detalles")
    # trayecto largo: suele traer ruta alternativa
    pg.evaluate("App.mods.ruta.irA(44)")
    pg.wait_for_selector(".resumen__min")
    pg.wait_for_timeout(1500)
    foto(pg, f"{prefijo}-08-ruta-larga")
    if pg.locator("#ruta-resultado .pestanas button").count() > 1:
        pg.click("#ruta-resultado .pestanas button:nth-child(2)")
        pg.wait_for_timeout(900)
        foto(pg, f"{prefijo}-08b-ruta-alternativa")

    pg.click('[data-vista="cupones"]')
    pg.wait_for_selector(".tarjeta.cupon")
    foto(pg, f"{prefijo}-09-cupones")
    pg.click(".tarjeta.cupon .btn")
    pg.wait_for_selector("#dlg-cupon[open] .codigo")
    foto(pg, f"{prefijo}-10-cupon-codigo")
    pg.click("#dlg-cupon .btn:not(.btn-secundario)")

    pg.click('[data-vista="contactos"]')
    pg.wait_for_selector("#contactos-lista li")
    foto(pg, f"{prefijo}-11-contactos")
    pg.click("#contacto-nuevo")
    foto(pg, f"{prefijo}-12-contacto-nuevo")
    pg.click("#form-contacto button[type=submit]")
    foto(pg, f"{prefijo}-13-contacto-error")
    pg.click("#contacto-cancelar")

    pg.click('[data-vista="reportar"]')
    pg.wait_for_selector("#reporte-sup:not([hidden])")
    foto(pg, f"{prefijo}-14-reportar-elegir")
    # toque real sobre una calle: punto medio de un tramo
    punto = pg.evaluate("""() => {
      const m = document.querySelector('#mapa').getBoundingClientRect();
      for (const l of document.querySelectorAll('.faro-mapa__tramo line')) {
        const r = l.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
        if (x < m.x + 60 || x > m.right - 20 || y < m.y + 80 || y > m.bottom - 260) continue;
        const e = document.elementFromPoint(x, y);
        if (e && e.closest('.faro-mapa__tramo')) return {x, y};
      }
      return null;
    }""")
    tocar_mapa(pg, punto["x"], punto["y"])
    pg.wait_for_selector("#reporte-tarjeta:not([hidden])")
    pg.wait_for_timeout(700)
    pg.click('.chip-tipo >> nth=0')
    pg.fill("#reporte-desc", "La luminaria de esta cuadra no enciende desde hace días.")
    foto(pg, f"{prefijo}-15-reportar-formulario")

    # SOS: mantener presionado 2 s
    pg.click('[data-vista="mapa"]')
    pg.wait_for_timeout(700)               # el SOS se desliza al quitar la tarjeta inferior
    b = pg.locator("#sos-boton").bounding_box()
    cx, cy = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
    pg.mouse.move(cx, cy)
    pg.mouse.down()
    pg.wait_for_timeout(1000)
    foto(pg, f"{prefijo}-16-sos-mantener")
    pg.wait_for_timeout(1300)
    pg.mouse.up()
    try:
        pg.wait_for_selector("#dlg-sos[open] #sos-cancelar:not([disabled])", timeout=8000)
    except Exception:
        pg.screenshot(path=os.path.join(OUT, "_debug.png")); print(pg.evaluate("[document.getElementById('dlg-sos').open, document.getElementById('dlg-sos').dataset.fase, document.getElementById('sos-error-texto').textContent]")); raise
    pg.wait_for_timeout(2200)
    foto(pg, f"{prefijo}-17-sos-cuenta")
    pg.click("#sos-cancelar")
    pg.wait_for_selector("#sos-cancelado:not([hidden])")
    foto(pg, f"{prefijo}-18-sos-cancelado")
    pg.click("#sos-cerrar-cancelado")

    # SOS completo: cuenta regresiva hasta el aviso simulado
    pg.mouse.move(cx, cy)
    pg.mouse.down()
    pg.wait_for_timeout(2300)
    pg.mouse.up()
    pg.wait_for_selector("#sos-enviado:not([hidden])", timeout=20000)
    foto(pg, f"{prefijo}-19-sos-enviado")
    pg.click("#sos-cerrar-enviado")

    # de madrugada: Faros cerrados
    pg.click('[data-vista="mapa"]')
    pg.evaluate("document.getElementById('hora').value='03:00'; document.getElementById('hora').dispatchEvent(new Event('change'))")
    pg.wait_for_timeout(900)
    foto(pg, f"{prefijo}-22-mapa-0300-cerrados")
    pg.evaluate("document.getElementById('hora').value='22:28'; document.getElementById('hora').dispatchEvent(new Event('change'))")
    pg.wait_for_timeout(500)

    # hoja de hora y perfil
    pg.click("#hora-chip")
    foto(pg, f"{prefijo}-20-hora")
    pg.click("#hora-listo")
    pg.click("#perfil-btn")
    foto(pg, f"{prefijo}-21-perfil")
    nav.close()


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as pw:
        recorrido(pw, "movil", dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True))
        recorrido(pw, "escritorio", dict(viewport={"width": 1440, "height": 900}, device_scale_factor=1))
    if problemas:
        print("\nPROBLEMAS:")
        for p in dict.fromkeys(problemas):
            print(" -", p)
        sys.exit(1)
    print("\nOK: sin errores de JS ni de CSP")
