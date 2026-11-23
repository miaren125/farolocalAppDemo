"""Auditoría rápida de la app móvil: tamaño de objetivos táctiles (≥ 44 px), tamaño de texto (≥ 16 px en párrafos y campos)
y ausencia de scroll horizontal, en 390×844. Uso: python tools/auditoria_movil.py (servidor corriendo)."""
import os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("FARO_URL", "http://localhost:5000").rstrip("/")
JS = """() => {
  const peq = [], txt = [];
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[hidden]') && !e.closest('dialog:not([open])') && !e.closest('.faro-mapa__svg'); };
  document.querySelectorAll('button, a.btn, input:not([type=hidden]), textarea, select, [role=button]').forEach((e) => {
    if (!vis(e)) return; const r = e.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 43.5) peq.push((e.id || e.className || e.tagName) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
  });
  document.querySelectorAll('p, li, span, label, h2, h3, strong, input, textarea').forEach((e) => {
    if (!vis(e) || !e.childNodes.length || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
    const fs = parseFloat(getComputedStyle(e).fontSize);
    if (fs < 15.9) txt.push(fs.toFixed(1) + 'px: ' + e.textContent.trim().slice(0, 28));
  });
  return { peq: [...new Set(peq)], txt: [...new Set(txt)], scrollX: document.documentElement.scrollWidth > innerWidth || [...document.querySelectorAll('.vista, .cuerpo, .pantalla')].some((e) => e.scrollWidth > e.clientWidth + 1) };
}"""
with sync_playwright() as pw:
    nav = pw.chromium.launch(channel=os.environ.get("FARO_NAVEGADOR", "msedge"))
    pg = nav.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True).new_page()
    pg.goto(BASE + "/app/"); pg.wait_for_selector("#l-correo")
    def revisar(nombre):
        r = pg.evaluate(JS); print(f"[{nombre}] scroll horizontal: {'SÍ' if r['scrollX'] else 'no'}")
        for k, t in (("peq", "objetivo < 44 px"), ("txt", "texto < 16 px")):
            for x in r[k]: print(f"   {t}: {x}")
    revisar("login")
    pg.fill("#l-correo", "peaton@farolocal.mx"); pg.fill("#l-pass", "Peaton123"); pg.click("#panel-login button[type=submit]")
    pg.wait_for_selector(".nav"); pg.wait_for_timeout(800); revisar("mapa")
    for v in ("ruta", "cupones", "contactos", "reportar"):
        pg.click(f'[data-vista="{v}"]'); pg.wait_for_timeout(500); revisar(v)
    nav.close()
