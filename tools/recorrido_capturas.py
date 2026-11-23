"""Recorrido completo de cada rol (peatón, comercio, administración) con Playwright.
Guarda capturas REALES de la interfaz en docs/capturas/ y escribe docs/capturas/INDICE.md.

Requisitos:  pip install playwright   (usa el Microsoft Edge instalado; si no lo tienes, cambia channel="msedge" por
             channel="chrome" o ejecuta `playwright install chromium` y quita `channel`)
Uso (con la base recién sembrada y el servidor corriendo):
    python3 backend/db.py && python3 backend/app.py        # en otra terminal
    FARO_URL=http://localhost:5000 python3 tools/recorrido_capturas.py
Nota: la app tiene una política CSP estricta (sin eval), por eso aquí no se usa wait_for_function.
Si algo no funciona como se espera, el script se detiene con el error: no guarda capturas "bonitas" de algo roto.
"""
import os
import re
import sys
import time

from playwright.sync_api import expect, sync_playwright

BASE = os.environ.get("FARO_URL", "http://localhost:5000").rstrip("/")
RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(RAIZ, "docs", "capturas")
CANAL = os.environ.get("FARO_NAVEGADOR", "msedge")
MOVIL = {"width": 390, "height": 844}
ESCRITORIO = {"width": 1280, "height": 900}

indice = []   # (archivo, descripción, requisitos)
problemas = []  # errores de JavaScript y bloqueos de la política de seguridad (CSP) vistos durante el recorrido


def vigilar(ctx):
    """Anota errores de JS no controlados y violaciones de CSP en cualquier página del contexto."""
    def nueva(pg):
        pg.on("pageerror", lambda e: problemas.append(f"error de JS: {e}"))
        pg.on("console", lambda m: problemas.append(f"CSP: {m.text}") if "Content Security Policy" in m.text else None)
    ctx.on("page", nueva)
    for pg in ctx.pages:
        nueva(pg)


def captura(pg, nombre, descripcion, rf, avisos=False, **kw):
    os.makedirs(OUT, exist_ok=True)
    pg.wait_for_timeout(350)               # deja terminar animaciones/redibujados
    if not avisos:                          # quita avisos emergentes que quedaron de la acción anterior
        pg.evaluate("document.querySelectorAll('.toast').forEach(t => { try { t.hidePopover(); } catch (e) {} })")
    archivo = nombre + ".png"
    pg.screenshot(path=os.path.join(OUT, archivo), **kw)
    indice.append((archivo, descripcion, rf))
    print("  captura", archivo)


def verificar(cond, mensaje):
    if not cond:
        raise AssertionError("FALLÓ EL RECORRIDO: " + mensaje)
    print("  ok:", mensaje)


def clic_nodo(pg, svg_sel, zona, nodo_id):
    """Toca con el ratón el cruce `nodo_id` sobre el SVG del mapa (coordenadas reales de pantalla)."""
    n = next(x for x in zona["nodos"] if x["id"] == nodo_id)
    x, y = pg.evaluate("""([sel, nx, ny]) => { const s = document.querySelector(sel); s.scrollIntoView({block:'center'});
        const p = s.createSVGPoint(); p.x = nx; p.y = ny; const q = p.matrixTransform(s.getScreenCTM()); return [q.x, q.y]; }""",
                       [svg_sel, n["x"], n["y"]])
    pg.mouse.click(x, y)


def clic_tramo(pg, svg_sel, zona, arista_id):
    a = next(x for x in zona["aristas"] if x["id"] == arista_id)
    A = next(x for x in zona["nodos"] if x["id"] == a["a"]); B = next(x for x in zona["nodos"] if x["id"] == a["b"])
    x, y = pg.evaluate("""([sel, nx, ny]) => { const s = document.querySelector(sel); s.scrollIntoView({block:'center'});
        const p = s.createSVGPoint(); p.x = nx; p.y = ny; const q = p.matrixTransform(s.getScreenCTM()); return [q.x, q.y]; }""",
                       [svg_sel, (A["x"] + B["x"]) / 2, (A["y"] + B["y"]) / 2])
    pg.mouse.click(x, y)


def login(pg, ruta, correo, pwd):
    pg.goto(BASE + ruta)
    pg.fill("#l-correo", correo)
    pg.fill("#l-pass", pwd)
    pg.click("#panel-login button[type=submit]")


def poner_hora(pg, hhmm):
    pg.fill("#hora", hhmm)
    pg.dispatch_event("#hora", "change")
    pg.wait_for_timeout(700)


# ======================================================================= PEATÓN
def recorrido_peaton(b, zona):
    print("\n== PEATÓN ==")
    ctx = b.new_context(viewport=MOVIL, device_scale_factor=2, locale="es-MX", timezone_id="America/Hermosillo")
    vigilar(ctx)
    pg = ctx.new_page()

    pg.goto(BASE + "/")
    pg.wait_for_selector("#opciones:not([hidden])")
    captura(pg, "00-selector-acceso", "Selector de acceso: peatón o comercio/administración", "RF01")

    pg.goto(BASE + "/app/")
    pg.wait_for_selector("#panel-login")
    pg.fill("#l-correo", "correo-mal"); pg.click("#panel-login button[type=submit]")
    captura(pg, "peaton-01-login-validacion", "Inicio de sesión con validación en la interfaz", "RF01")
    pg.click("#tab-registro")
    pg.fill("#r-nombre", "Ana Pérez"); pg.fill("#r-correo", "ana.captura@example.com")
    pg.fill("#r-tel", "662 123 4567"); pg.fill("#r-pass", "corta")
    pg.click("#panel-registro button[type=submit]")
    captura(pg, "peaton-02-registro-validacion", "Registro de peatón con error de contraseña corta", "RF01")
    pg.fill("#r-pass", "Segura1234"); pg.click("#panel-registro button[type=submit]")
    pg.wait_for_selector("#vista-app:not([hidden]) .faro-mapa__faro")
    verificar(pg.inner_text("#nombre-usuario") == "Ana Pérez", "registro real crea la sesión de Ana Pérez")
    pg.click("#salir")

    login(pg, "/app/", "peaton@farolocal.mx", "Peaton123")
    pg.wait_for_selector("#vista-app:not([hidden]) .faro-mapa__faro")
    poner_hora(pg, "23:30")
    verificar(pg.locator(".faro-mapa__faro.es-abierto").count() == 5, "23:30: 5 Faros abiertos")
    captura(pg, "peaton-03-mapa-faros-2330", "Mapa de Puntos Faro con hora simulada 23:30", "RF02")
    poner_hora(pg, "03:00")
    verificar(pg.locator(".faro-mapa__faro.es-abierto").count() == 3, "03:00: 3 Faros abiertos")
    captura(pg, "peaton-04-mapa-faros-0300", "Mismo mapa a las 03:00: cambian los Faros abiertos", "RF02")
    poner_hora(pg, "23:30")

    # ficha (toque 1) + ruta (toque 2)
    pg.locator(".faro-mapa__faro").nth(1).click()
    pg.wait_for_selector("#dlg-ficha[open] #ficha-titulo")
    verificar("Tienda La Esquina" in pg.inner_text("#ficha-titulo"), "ficha del Faro abierta")
    captura(pg, "peaton-05-ficha-faro", "Ficha del Punto Faro: estado, horario, servicios y cupones", "RF03")
    pg.get_by_role("button", name="Ruta Faro hasta aquí").click()
    pg.wait_for_selector("#ruta-resultado .resumen")
    pg.locator("#ruta-resultado").scroll_into_view_if_needed()
    captura(pg, "peaton-06-ruta-faro-2-toques", "Ruta Faro calculada con 2 toques (Faro → Ruta hasta aquí)", "RF04")

    # ruta larga con alternativa: origen nodo 0, destino nodo 47
    pg.click('[data-vista=ruta]')
    pg.locator(".campo-punto").nth(0).click(); clic_nodo(pg, ".faro-mapa__svg", zona, 0)
    clic_nodo(pg, ".faro-mapa__svg", zona, 47)
    pg.click("#ruta-calcular"); pg.wait_for_selector("#ruta-resultado [role=radio]")
    verificar(pg.locator("#ruta-resultado [role=radio]").count() == 2, "ruta 0→47 ofrece Ruta Faro y Alternativa")
    pg.locator("#zona-mapa").scroll_into_view_if_needed()
    captura(pg, "peaton-07-ruta-faro-datos", "Ruta Faro con distancia, minutos, Faros abiertos y cuánto se alarga", "RF04")
    pg.locator("#ruta-resultado [role=radio]").nth(1).click()
    captura(pg, "peaton-08-ruta-alternativa", "Ruta alternativa dibujada en el mapa", "RF05")

    # cupones + código + QR
    pg.click('[data-vista=cupones]'); pg.wait_for_selector("#cupones-lista .cupon")
    captura(pg, "peaton-09-cupones", "Cupones vigentes", "RF08")
    tarjeta = pg.locator("#cupones-lista .cupon").filter(has_text="Tienda La Esquina")
    tarjeta.get_by_role("button").click()
    pg.wait_for_selector("#dlg-cupon[open] .qr svg")
    codigo = pg.inner_text("#dlg-cupon .codigo").strip()
    verificar(re.fullmatch(r"FARO-[0-9A-F]{6}", codigo) is not None, "código personal " + codigo)
    captura(pg, "peaton-10-cupon-codigo-qr", "Código personal del cupón con su QR", "RF08")
    pg.click("#dlg-cupon .btn:last-child")

    # contactos
    pg.click('[data-vista=contactos]'); pg.wait_for_selector("#contactos-lista .item")
    captura(pg, "peaton-11-contactos", "Contactos de confianza (máximo 5) y bandeja de alertas", "RF06")
    pg.click("#contacto-nuevo"); pg.wait_for_selector("#dlg-contacto[open]")
    pg.fill("#c-nombre", "Tía Lupe"); pg.fill("#c-celular", "123")
    pg.click("#form-contacto button[type=submit]")
    captura(pg, "peaton-12-contacto-validacion", "Formulario de contacto con validación del celular", "RF06")
    pg.fill("#c-celular", "6625550003"); pg.click("#form-contacto button[type=submit]")
    expect(pg.locator("#contactos-lista .item")).to_have_count(3)

    # reportar zona
    pg.click('[data-vista=reportar]'); pg.wait_for_selector("#reporte-tramo")
    clic_tramo(pg, ".faro-mapa__svg", zona, 5)
    pg.wait_for_selector("#form-reporte:not([hidden])")
    pg.select_option("#reporte-tipo", "Luminaria apagada")
    pg.fill("#reporte-desc", "Dos postes sin luz frente a la tienda.")
    captura(pg, "peaton-13-reportar-tramo", "Reportar una zona: tramo elegido en el mapa", "RF09")
    pg.click("#form-reporte button[type=submit]")
    pg.locator("#reportes-lista .item").first.wait_for()
    pg.locator("#reportes-lista").scroll_into_view_if_needed()
    verificar("Pendiente" in pg.inner_text("#reportes-lista"), "reporte enviado queda Pendiente")
    captura(pg, "peaton-14-reporte-enviado", "Reporte enviado: aparece en 'Mis reportes' como Pendiente", "RF09")

    # SOS: mantener 2 s → cuenta regresiva → enviado (simulado)
    pg.click('[data-vista=mapa]')
    box = pg.locator("#sos-boton").bounding_box()
    pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    pg.mouse.down(); pg.wait_for_timeout(1000)
    captura(pg, "peaton-15-sos-manteniendo", "SOS: anillo de progreso mientras se mantiene presionado (2 s)", "RF07")
    pg.wait_for_timeout(1400); pg.mouse.up()
    pg.wait_for_selector("#dlg-sos[open] #sos-cuenta:not([hidden])")
    pg.wait_for_timeout(3500)
    captura(pg, "peaton-16-sos-cuenta-regresiva", "SOS: cuenta regresiva de 10 s con 'Cancelar alerta' y enlace al 911", "RF07")
    pg.wait_for_selector("#sos-enviado:not([hidden])", timeout=15000)
    verificar("SIMULADO" in pg.inner_text("#sos-enviado-texto"), "aviso SOS marcado como simulado")
    captura(pg, "peaton-17-sos-enviado", "SOS: aviso simulado enviado a los contactos", "RF07")
    pg.click("#sos-cerrar-enviado")
    # segunda alerta: cancelada
    pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    pg.mouse.down(); pg.wait_for_timeout(2300); pg.mouse.up()
    pg.wait_for_selector("#sos-cancelar:not([disabled])")
    pg.click("#sos-cancelar"); pg.wait_for_selector("#sos-cancelado:not([hidden])")
    captura(pg, "peaton-18-sos-cancelado", "SOS cancelado durante la cuenta regresiva", "RF07")
    pg.click("#sos-cerrar-cancelado")
    pg.click('[data-vista=contactos]'); expect(pg.locator("#alertas-lista .item")).to_have_count(2)
    pg.locator("#alertas-lista").scroll_into_view_if_needed()
    captura(pg, "peaton-19-bandeja-alertas", "Bandeja de alertas: una enviada (simulada) y una cancelada", "RF07")

    # sin conexión
    pg.click('[data-vista=mapa]')
    pg.evaluate("navigator.serviceWorker.ready.then(() => true)")
    pg.reload(); pg.wait_for_selector(".faro-mapa__faro")
    ctx.set_offline(True)
    pg.reload(); pg.wait_for_selector(".faro-mapa__faro", timeout=15000)
    verificar(pg.is_visible("#aviso-offline"), "sin conexión: la app abre y avisa")
    captura(pg, "peaton-20-sin-conexion", "App abierta sin conexión (PWA) con el último mapa guardado", "RNF offline/PWA")
    ctx.set_offline(False)
    ctx.close()
    return codigo


# ======================================================================= COMERCIO
def recorrido_comercio(b, zona, codigo):
    print("\n== COMERCIO ==")
    ctx = b.new_context(viewport=ESCRITORIO, locale="es-MX", timezone_id="America/Hermosillo")
    vigilar(ctx)
    pg = ctx.new_page()

    pg.goto(BASE + "/portal/"); pg.wait_for_selector("#panel-login")
    captura(pg, "comercio-01-acceso-portal", "Acceso al portal de comercio y administración", "RF01")
    pg.click("#tab-registro")
    pg.fill("#r-nombre", "Luz Prueba"); pg.fill("#r-correo", "luz.captura@example.com")
    pg.fill("#r-tel", "6625550101"); pg.fill("#r-pass", "Segura1234")
    pg.click("#panel-registro button[type=submit]")
    pg.wait_for_selector("#v-negocio:not([hidden])")
    pg.click("#form-negocio button[type=submit]")
    captura(pg, "comercio-02-registrar-negocio-validacion", "Registro de negocio: validación de campos obligatorios", "RF10")
    f = pg.locator("#form-negocio")
    f.locator('[name=nombre]').fill("Dulcería La Luz"); f.locator('[name=giro]').fill("Dulcería")
    f.locator('[name=direccion]').fill("Calle Sonora 123, zona piloto")
    pg.check("#n-24h")
    f.locator('input[name=servicio][value="Agua"]').check(); f.locator('input[name=servicio][value="Teléfono"]').check()
    clic_nodo(pg, "#mapa-negocio .faro-mapa__svg", zona, 12)
    captura(pg, "comercio-03-registrar-negocio-mapa", "Registro de negocio con la ubicación elegida en el mapa", "RF10")
    pg.click("#form-negocio button[type=submit]")
    pg.wait_for_selector("#v-panel:not([hidden]) .panel-caja")
    verificar("Pendiente" in pg.inner_text("#panel-estado"), "negocio nuevo queda Pendiente")
    captura(pg, "comercio-04-negocio-pendiente", "Panel de un negocio recién registrado (Pendiente de revisión)", "RF10, RF11")
    ctx.close()

    # titular aprobado
    ctx = b.new_context(viewport=ESCRITORIO, locale="es-MX", timezone_id="America/Hermosillo")
    vigilar(ctx)
    pg = ctx.new_page()
    login(pg, "/portal/", "esquina@farolocal.mx", "Comercio123")
    pg.wait_for_selector("#v-panel:not([hidden]) .contador-caja")
    captura(pg, "comercio-05-panel-contadores", "Panel del comercio con contadores", "RF11")
    pg.click('[data-vista=negocio]'); pg.wait_for_selector("#n-ubicacion")
    expect(pg.locator("#n-ubicacion")).to_contain_text("Ubicación elegida")
    captura(pg, "comercio-06-editar-negocio", "Edición del negocio con ubicación en el mapa", "RF10")
    pg.click('[data-vista=cupones]'); pg.wait_for_selector("#cupones-filas tr")
    captura(pg, "comercio-07-cupones", "Gestión de cupones", "RF12")
    pg.click("#cupon-nuevo"); pg.wait_for_selector("#dlg-cupon[open]")
    pg.fill("#c-titulo", "Dulce gratis"); pg.fill("#c-desc", "Con compra de $50.")
    captura(pg, "comercio-08-cupon-nuevo", "Formulario de nuevo cupón", "RF12")
    pg.click("#form-cupon button[type=submit]")
    expect(pg.locator("#cupones-filas tr")).to_have_count(2)
    pg.click('[data-vista=validar]')
    pg.fill("#v-codigo", codigo); pg.click("#form-validar button[type=submit]")
    pg.wait_for_selector("#validar-resultado .resultado.ok")
    captura(pg, "comercio-09-validar-cupon-valido", "Validación de un cupón válido (queda canjeado)", "RF13")
    pg.fill("#v-codigo", codigo); pg.click("#form-validar button[type=submit]")
    pg.wait_for_selector("#validar-resultado .resultado.mal")
    verificar("ya fue canjeado" in pg.inner_text("#validar-resultado"), "el mismo cupón no se puede canjear dos veces")
    captura(pg, "comercio-10-validar-cupon-repetido", "Intento de canjear de nuevo el mismo cupón", "RF13")
    ctx.close()

    # titular rechazado
    ctx = b.new_context(viewport=ESCRITORIO, locale="es-MX", timezone_id="America/Hermosillo")
    vigilar(ctx)
    pg = ctx.new_page()
    login(pg, "/portal/", "compadres@farolocal.mx", "Comercio123")
    pg.wait_for_selector("#v-panel:not([hidden]) .panel-caja")
    verificar("Rechazado" in pg.inner_text("#panel-estado") and "servicio" in pg.inner_text("#panel-estado"), "titular ve el estado y el motivo")
    captura(pg, "comercio-11-negocio-rechazado", "Negocio rechazado: el titular ve el motivo", "RF10, RF14")
    ctx.close()


# ======================================================================= ADMIN
def recorrido_admin(b):
    print("\n== ADMINISTRACIÓN ==")
    ctx = b.new_context(viewport=ESCRITORIO, locale="es-MX", timezone_id="America/Hermosillo")
    vigilar(ctx)
    pg = ctx.new_page()
    login(pg, "/portal/", "admin@farolocal.mx", "Admin123!")
    pg.wait_for_selector("#v-resumen:not([hidden]) .contador-caja")
    captura(pg, "admin-01-resumen", "Resumen de administración", "RF14, RF15")
    pg.click('[data-vista=negocios]'); pg.wait_for_selector("#negocios-filas tr .btn-enlace")
    n0 = pg.locator("#negocios-filas tr").count()
    captura(pg, "admin-02-negocios-pendientes", "Validar negocios: lista de pendientes con detalle y mapa", "RF14")
    pg.get_by_role("button", name="Rechazar…").click(); pg.wait_for_selector("#dlg-rechazo[open]")
    pg.click("#form-rechazo button[type=submit]")
    captura(pg, "admin-03-rechazo-sin-motivo", "Rechazo de negocio: el motivo es obligatorio", "RF14")
    pg.fill("#r-motivo", "Falta indicar la dirección completa del negocio.")
    pg.click("#form-rechazo button[type=submit]")
    expect(pg.locator("#negocios-filas tr")).to_have_count(n0 - 1)
    pg.get_by_role("button", name="Aprobar negocio").click(); pg.wait_for_selector("dialog.modal[open]")
    captura(pg, "admin-04-aprobar-confirmacion", "Confirmación para aprobar un negocio", "RF14")
    pg.locator("dialog.modal[open]").get_by_role("button", name="Aprobar", exact=True).click()
    expect(pg.locator("#negocios-filas tr")).to_have_count(n0 - 2)
    pg.get_by_role("button", name="Rechazados").click(); pg.wait_for_selector("#negocios-filas tr .btn-enlace")
    captura(pg, "admin-05-negocios-rechazados", "Negocios rechazados con su motivo", "RF14")
    pg.click('[data-vista=reportes]'); pg.wait_for_selector("#reportes-filas tr .btn-enlace")
    captura(pg, "admin-06-reportes-mapa", "Moderar reportes: el tramo reportado se resalta en el mapa", "RF15")
    marcas = pg.locator("#mapa-reportes .faro-mapa__reportes g").count()
    pg.locator("#reportes-filas").get_by_role("button", name=re.compile("Aprobar reporte")).first.click()
    expect(pg.locator("#mapa-reportes .faro-mapa__reportes g")).to_have_count(marcas + 1)
    captura(pg, "admin-07-reporte-aprobado", "Reporte aprobado: el tramo queda marcado con '!' y penaliza las rutas", "RF15")
    ctx.close()


def escribir_indice():
    with open(os.path.join(OUT, "INDICE.md"), "w", encoding="utf-8") as f:
        f.write("# Capturas reales del software\n\n")
        f.write(f"Generadas automáticamente con Playwright (`tools/recorrido_capturas.py`) el {time.strftime('%d/%m/%Y %H:%M')} "
                "contra la aplicación en ejecución y datos de demostración. No son mockups.\n\n")
        f.write("| Archivo | Qué muestra | Requisito |\n|---|---|---|\n")
        for archivo, desc, rf in indice:
            f.write(f"| `{archivo}` | {desc} | {rf} |\n")


if __name__ == "__main__":
    for viejo in (os.listdir(OUT) if os.path.isdir(OUT) else []):
        if viejo.endswith(".png"):
            os.remove(os.path.join(OUT, viejo))
    with sync_playwright() as p:
        b = p.chromium.launch(channel=CANAL, headless=True)
        import json
        import urllib.request
        zona = json.load(urllib.request.urlopen(BASE + "/api/zona"))
        try:
            codigo = recorrido_peaton(b, zona)
            recorrido_comercio(b, zona, codigo)
            recorrido_admin(b)
        finally:
            b.close()
    verificar(not problemas, "sin errores de JS ni bloqueos de CSP en todo el recorrido"
              + ("" if not problemas else ": " + "; ".join(sorted(set(problemas))[:5])))
    escribir_indice()
    print(f"\nListo: {len(indice)} capturas en docs/capturas/")
    sys.exit(0)
