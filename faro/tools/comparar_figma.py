"""Compone imágenes "Figma | app" para revisar diferencias. Uso: python tools/comparar_figma.py
Las pantallas de Figma se leen del directorio con las capturas bajadas del MCP (ver FIGMA abajo) y se escalan a 390×844
para igualarlas con las capturas de la app (390×844 @2x → se reducen a 1x)."""
import os
from PIL import Image, ImageDraw, ImageFont

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CAP = os.path.join(RAIZ, "docs", "capturas")
SAL = os.path.join(CAP, "comparacion")
FIGMA_DIR = os.environ.get("FIGMA_DIR", os.path.join(os.path.expanduser("~"), ".claude", "projects",
            "C--Users-miare-Desktop-FaroLocal-proyecto-faro", "327661a0-4a26-4072-a163-eb35aeebd8d3", "tool-results"))
B = "mcp-plugin_figma_figma-blob-"
# (nombre, nodo de Figma, archivo de Figma, captura de la app)
PARES = [
    ("01-login", "14:34", "1795101208409-etkfhk", "02-login"),
    ("02-login-error", "27:31", "1795101222207-omcv76", "03-login-error"),
    ("03-registro", "27:62", "1795101221953-hw4wbo", "04-registro"),
    ("04-inicio", "14:52", "1795101209031-shu04m", "10-mapa"),
    ("05-buscador", "37:442", "1795101753131-44m27b", "11-buscador-sugerencias"),
    ("06-vista-previa", "54:1580", "1795101753543-8ij810", "12-vista-previa"),
    ("07-navegacion", "54:1700", "1795101754026-u3hoji", "14-navegacion"),
    ("08-acceso-rapido", "27:112", "1795101223430-14j0oa", "07-acceso-rapido"),
    ("09-contactos", "27:200", "1795102606694-hvycje", "24-contactos"),
    ("10-contactos-eliminar", "54:1204", "1795102607437-ctg0qn", "26-contactos-eliminar"),
    ("11-cupones-vacio", "27:331", "1795102607549-bytrve", "20-cupones-vacio"),
    ("12-cupones", "40:941", "1795102608078-k6cpi1", "30-cupones"),
    ("13-reportar", "27:351", "1795102623309-yq0gkf", "32-reportar"),
    ("14-reportar-motivo", "40:666", "1795102623726-56hxj5", "34-reportar-motivo"),
    ("15-ubica-el-negocio", "40:735", "1795102623676-vij932", "36-reportar-tramo-elegido"),
    ("16-sos-alerta-enviada", "27:94", "1795102623932-asvg7b", "29-sos-alerta-enviada"),
]

if __name__ == "__main__":
    os.makedirs(SAL, exist_ok=True)
    try:
        fuente = ImageFont.truetype("arial.ttf", 18)
    except OSError:
        fuente = ImageFont.load_default()
    for nombre, nodo, fig, app in PARES:
        f = Image.open(os.path.join(FIGMA_DIR, B + fig + ".png")).convert("RGB")
        a = Image.open(os.path.join(CAP, app + ".png")).convert("RGB")
        f = f.resize((round(f.width * 844 / f.height), 844), Image.LANCZOS)
        a = a.resize((390, 844), Image.LANCZOS)
        lienzo = Image.new("RGB", (f.width + a.width + 30, 844 + 34), (255, 255, 255))
        lienzo.paste(f, (0, 34)); lienzo.paste(a, (f.width + 30, 34))
        d = ImageDraw.Draw(lienzo)
        d.text((8, 7), f"Figma {nodo}", fill=(0, 0, 0), font=fuente)
        d.text((f.width + 38, 7), f"App ({app})", fill=(0, 0, 0), font=fuente)
        lienzo.save(os.path.join(SAL, nombre + ".png"), optimize=True)
        print("comparación", nombre)
