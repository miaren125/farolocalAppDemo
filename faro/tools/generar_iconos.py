"""Genera los íconos PNG de la PWA a partir de frontend/assets/linterna.png (el archivo del equipo).
No dibuja nada: solo coloca la linterna sobre Marino #091D36. Uso: python tools/generar_iconos.py"""
import os
from PIL import Image

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
LINTERNA = os.path.join(RAIZ, "assets", "linterna.png")
SALIDA = os.path.join(RAIZ, "app", "icons")
MARINO = (9, 29, 54, 255)


def icono(lado, margen):
    """Linterna centrada; `margen` = fracción libre en cada lado (0.20 = 20 %)."""
    lin = Image.open(LINTERNA).convert("RGBA")
    caja = lado * (1 - 2 * margen)
    k = min(caja / lin.width, caja / lin.height)
    lin = lin.resize((round(lin.width * k), round(lin.height * k)), Image.LANCZOS)
    img = Image.new("RGBA", (lado, lado), MARINO)
    img.alpha_composite(lin, ((lado - lin.width) // 2, (lado - lin.height) // 2))
    return img.convert("RGB")


if __name__ == "__main__":
    os.makedirs(SALIDA, exist_ok=True)
    # el maskable usa 30 % de margen: el recorte circular de Android deja una zona segura del 80 %
    for nombre, lado, margen in (("icon-192.png", 192, 0.20), ("icon-512.png", 512, 0.20),
                                 ("icon-maskable-512.png", 512, 0.30), ("apple-touch-icon.png", 180, 0.20)):
        icono(lado, margen).save(os.path.join(SALIDA, nombre))
        print("creado", nombre)
