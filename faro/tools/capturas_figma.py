"""Capturas de la app del peatón a 390×844 (@2x, táctil) para compararlas con Figma. Uso: python tools/capturas_figma.py [fase]
Requiere el servidor en http://localhost:5000 y Playwright con Edge. Sale con error si hay errores de JS o de CSP."""
import os
import sys
from playwright.sync_api import sync_playwright

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SAL = os.path.join(RAIZ, "docs", "capturas")
BASE = "http://localhost:5000"
errores = []


def nuevo(nav, ancho=390, alto=844):
    c = nav.new_context(viewport={"width": ancho, "height": alto}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="es-MX")
    p = c.new_page()
    p.on("pageerror", lambda e: errores.append("JS: " + str(e)))
    p.on("console", lambda m: errores.append("CONSOLA: " + m.text) if m.type == "error" and "401" not in m.text and "Failed to load resource" not in m.text else None)
    return c, p


def foto(p, nombre):
    p.wait_for_timeout(350)
    p.screenshot(path=os.path.join(SAL, nombre + ".png"))
    print("captura", nombre)


def entrar(p, correo="peaton@farolocal.mx", clave="Peaton123"):
    p.goto(BASE + "/app/")
    p.wait_for_selector("#form-login:not([hidden])")
    p.fill("#l-usuario", correo)
    p.fill("#l-pass", clave)
    p.click("#form-login button[type=submit]")
    p.wait_for_selector("#vista-app:not([hidden])")
    p.wait_for_timeout(900)


def fase1(nav):
    c, p = nuevo(nav)
    p.goto(BASE + "/app/")
    p.wait_for_timeout(500)
    foto(p, "01-splash")
    p.wait_for_selector("#form-login:not([hidden])")
    foto(p, "02-login")
    p.fill("#l-usuario", "peaton@farolocal.mx")
    p.fill("#l-pass", "equivocada1")
    p.click("#form-login button[type=submit]")
    p.wait_for_selector("#dlg-error[open]")
    foto(p, "03-login-error")
    p.click("#error-cerrar")
    p.click("[data-ir=registro]")
    p.wait_for_selector("#form-registro:not([hidden])")
    foto(p, "04-registro")
    p.click("#form-registro button[type=submit]")
    p.wait_for_timeout(200)
    foto(p, "05-registro-validacion")
    c.close()
    c, p = nuevo(nav)
    entrar(p)
    foto(p, "06-inicio")
    p.click("[data-vista=acceso]")
    p.wait_for_timeout(300)
    foto(p, "07-acceso-rapido")
    c.close()


def fase2(nav):
    c, p = nuevo(nav)
    entrar(p)
    foto(p, "10-mapa")
    p.click("#buscador")
    p.keyboard.type("av")
    p.wait_for_selector("#sugerencias:not([hidden])")
    foto(p, "11-buscador-sugerencias")
    p.fill("#buscador", "chiapas y calle 6")
    p.wait_for_selector("#sugerencias .sug-item")
    p.click("#sugerencias .sug-item >> nth=0")
    p.wait_for_selector("#ruta-tarjeta .ruta-botones")
    p.wait_for_timeout(700)
    foto(p, "12-vista-previa")
    if p.locator("#ruta-tarjeta [aria-disabled=false]").count():
        p.click("text=OTRA RUTA")
        p.wait_for_timeout(700)
        foto(p, "13-vista-previa-otra-ruta")
        p.click("text=OTRA RUTA")
    p.click("text=INICIAR RUTA")
    p.wait_for_selector("#ruta-tarjeta .nav-cab")
    p.wait_for_timeout(700)
    foto(p, "14-navegacion")
    for _ in range(3):
        if p.locator("text=SIMULAR AVANCE").count():
            p.click("text=SIMULAR AVANCE")
            p.wait_for_timeout(500)
    foto(p, "15-navegacion-avance")
    p.click(".nav-x")
    p.wait_for_timeout(300)
    p.locator(".faro-mapa__faro").first.dispatch_event("click")
    p.wait_for_selector("#dlg-ficha[open] #ficha-titulo")
    p.wait_for_timeout(500)
    foto(p, "16-ficha-faro")
    c.close()


def decodificar_qr(p, esperado):
    """Lee el QR de la pantalla con OpenCV (como lo haría un escáner) y compara con el código mostrado."""
    import cv2
    import numpy as np
    ruta = os.path.join(SAL, "_qr.png")
    p.locator("#cupon-cuerpo .qr").screenshot(path=ruta)
    img = cv2.imread(ruta)
    img = cv2.copyMakeBorder(img, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=(255, 255, 255))
    leido, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    os.remove(ruta)
    ok = leido == esperado
    print("QR leído con OpenCV:", repr(leido), "| esperado:", repr(esperado), "|", "OK" if ok else "NO COINCIDE")
    if not ok:
        errores.append("QR: no se pudo leer o no coincide")


def fase3(nav):
    import random
    # usuario nuevo: contactos y cupones vacíos
    c, p = nuevo(nav)
    p.goto(BASE + "/app/")
    p.wait_for_selector("#form-login:not([hidden])")
    p.click("[data-ir=registro]")
    correo = "prueba%d@farolocal.mx" % random.randint(1000, 99999)
    p.fill("#r-nombre", "Ana Torres"); p.fill("#r-correo", correo); p.fill("#r-tel", "6621234567"); p.fill("#r-pass", "Prueba1234")
    p.click("#form-registro button[type=submit]")
    p.wait_for_selector("#vista-app:not([hidden])")
    p.wait_for_timeout(800)
    p.click("[data-vista=acceso]"); p.click("[data-ir-vista=cupones]")
    p.wait_for_selector("#cupones-vacio:not([hidden])")
    foto(p, "20-cupones-vacio")
    p.click("[data-vista=acceso]"); p.click("[data-ir-vista=contactos]")
    p.wait_for_selector("#contactos-vacio:not([hidden])")
    foto(p, "21-contactos-vacio")
    # SOS sin contactos
    p.dispatch_event("#sos-boton", "pointerdown")
    p.wait_for_selector("#dlg-sos[open]", timeout=6000)
    p.wait_for_selector("#sos-cancelar:not([disabled])")
    foto(p, "22-sos-cuenta-sin-contactos")
    p.click("#sos-cancelar")
    p.wait_for_selector("#sos-cancelado:not([hidden])")
    foto(p, "23-sos-cancelado")
    p.click("#sos-cerrar-cancelado")
    # agrega cinco contactos
    for i, nombre in enumerate(["Mamá", "Papá", "Hermana Lucía", "Tío Beto", "Abuela Chela"]):
        p.click("#contacto-nuevo")
        p.fill("#c-nombre", nombre); p.fill("#c-celular", "66212345%02d" % (10 + i))
        p.click("#form-contacto button[type=submit]")
        p.wait_for_timeout(500)
    p.wait_for_timeout(600)
    foto(p, "24-contactos")
    p.click("#contacto-nuevo")                                  # el sexto: el servidor explica el límite
    p.wait_for_selector("#toast.visible")
    foto(p, "25-contactos-maximo")
    p.click("#contacto-eliminar")
    foto(p, "26-contactos-eliminar")
    p.click(".menos-fig >> nth=1")
    p.wait_for_selector("#dlg-confirmar[open]")
    foto(p, "27-contactos-confirmar-borrado")
    p.click("#confirmar-no")
    p.click("#contacto-eliminar")
    # SOS completo con contactos
    p.dispatch_event("#sos-boton", "pointerdown")
    p.wait_for_selector("#dlg-sos[open]", timeout=6000)
    p.wait_for_selector("#sos-cancelar:not([disabled])")
    p.wait_for_timeout(2500)
    foto(p, "28-sos-cuenta")
    p.wait_for_selector("#sos-enviado:not([hidden])", timeout=15000)
    foto(p, "29-sos-alerta-enviada")
    p.click("#sos-x")
    # cupones: se obtiene uno y se ve en la lista y en el detalle
    ids = p.evaluate("async () => (await Faro.get('/api/cupones', {hora: App.estado.hora})).slice(0, 3).map(c => c.id)")
    for i in ids:
        p.evaluate("(i) => Faro.post('/api/cupones/' + i + '/obtener')", i)
    p.click("[data-vista=acceso]"); p.click("[data-ir-vista=cupones]")
    p.wait_for_selector("#cupones-lista .fila-fig")
    foto(p, "30-cupones")
    p.click("#cupones-lista .fila-fig >> nth=0")
    p.wait_for_selector("#dlg-cupon[open] .codigo")
    p.wait_for_timeout(400)
    foto(p, "31-cupon-detalle")
    decodificar_qr(p, p.inner_text("#cupon-cuerpo .codigo"))
    p.click("text=LISTO")
    # reportar
    p.click("[data-vista=acceso]"); p.click("[data-ir-vista=reportar]")
    p.wait_for_selector("#reporte-chips .chip-fig")
    foto(p, "32-reportar")
    p.click("#form-reporte button[type=submit]")
    foto(p, "33-reportar-validacion")
    p.fill("#reporte-ref", "Tienda La Esquina, frente al parque")
    p.click("#reporte-chips .chip-fig >> nth=0")
    foto(p, "34-reportar-motivo")
    p.click("#form-reporte button[type=submit]")
    p.wait_for_selector("#reporte-sup:not([hidden])")
    p.wait_for_timeout(500)
    foto(p, "35-reportar-ubica-negocio")
    p.locator(".faro-mapa__tramo").nth(20).dispatch_event("click")
    p.wait_for_selector("#reporte-tramo:not(:empty)")
    p.wait_for_timeout(700)
    foto(p, "36-reportar-tramo-elegido")
    p.click("#reporte-enviar")
    p.wait_for_selector("#dlg-error[open]")
    foto(p, "37-reportar-enviado")
    p.click("#error-cerrar")
    p.click("#perfil-btn") if p.locator("#perfil-btn").is_visible() else p.click("#rapido-editar")
    p.wait_for_selector("#dlg-perfil[open]")
    p.wait_for_timeout(500)
    foto(p, "38-perfil-bandeja")
    c.close()


def fase4(nav):
    """Pantalla ancha (1440×900): la app se muestra dentro del marco de celular."""
    c = nav.new_context(viewport={"width": 1440, "height": 900}, locale="es-MX")
    p = c.new_page()
    p.on("pageerror", lambda e: errores.append("JS: " + str(e)))
    entrar(p)
    foto(p, "40-escritorio-marco-inicio")
    p.click("[data-vista=acceso]")
    p.wait_for_timeout(300)
    foto(p, "41-escritorio-marco-acceso-rapido")
    c.close()


if __name__ == "__main__":
    os.makedirs(SAL, exist_ok=True)
    fases = sys.argv[1:] or ["1"]
    with sync_playwright() as pw:
        nav = pw.chromium.launch(channel="msedge")
        if "1" in fases:
            fase1(nav)
        if "2" in fases:
            fase2(nav)
        if "3" in fases:
            fase3(nav)
        if "4" in fases:
            fase4(nav)
        nav.close()
    if errores:
        print("\n".join(errores))
        sys.exit(1)
    print("OK: sin errores de JS ni de CSP")
