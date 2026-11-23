"""Grafo de la zona piloto y cálculo de la Ruta Faro (Dijkstra).

La zona conserva la topología de una cuadrícula de 8×6 cruces (mismos ids de nodo), pero las coordenadas
se desplazan de forma determinista para que las calles no sean perfectamente rectas, y hay algunas calles
diagonales. Cada tramo (arista) tiene distancia en metros (distancia euclidiana real entre sus cruces) y un
nivel de iluminación de 1 (oscuro) a 3 (bien iluminado).
"""
import heapq
import math
import random

COLS = 8
ROWS = 6
SPACING = 140  # metros entre cruces

AVENIDAS = ["Av. Rosales", "Calle Sonora", "Calle Sinaloa", "Av. Serdán",
            "Calle Jalisco", "Calle Nayarit", "Av. Colosio", "Calle Chiapas"]
CALLES = ["Calle 1", "Calle 2", "Calle 3", "Calle 4", "Calle 5", "Calle 6"]

# Tramos con poca luz (col, fila) -> (col2, fila2). El resto se considera bien iluminado,
# salvo los que aparecen en MEDIA_LUZ.
SIN_LUZ = {
    ((2, 1), (2, 2)), ((2, 2), (2, 3)), ((2, 2), (3, 2)), ((3, 2), (4, 2)),
    ((4, 2), (4, 3)), ((4, 3), (4, 4)), ((3, 3), (4, 3)), ((5, 3), (5, 4)),
    ((1, 3), (2, 3)), ((6, 2), (6, 3)),
}
MEDIA_LUZ = {
    ((1, 1), (2, 1)), ((3, 1), (3, 2)), ((3, 3), (3, 4)), ((5, 2), (5, 3)),
    ((4, 4), (5, 4)), ((2, 3), (3, 3)), ((6, 3), (6, 4)), ((0, 3), (1, 3)),
}
# Tramos que no existen (manzanas grandes / obstáculos)
QUITADOS = {((5, 1), (5, 2)), ((3, 4), (3, 5)), ((1, 4), (2, 4)),
            ((4, 0), (4, 1)), ((6, 4), (6, 5)), ((1, 2), (2, 2))}
# Calles diagonales entre cruces vecinos: (extremo, extremo, luz)
DIAGONALES = [((1, 0), (2, 1), 3), ((4, 1), (5, 2), 2), ((2, 3), (3, 4), 3), ((6, 3), (7, 4), 1)]

SEMILLA = 20261129
DESPLAZ_MIN, DESPLAZ_MAX = 30, 45   # metros que se mueve cada cruce respecto a la cuadrícula perfecta


def nid(c, r):
    return r * COLS + c


def _norm(a, b):
    return (a, b) if a <= b else (b, a)


def _distancia(a, b):
    return round(math.hypot(a["x"] - b["x"], a["y"] - b["y"]), 1)


def build_zone():
    """Devuelve (nodos, aristas). Ids de nodo estables; coordenadas con desplazamiento determinista (semilla fija)."""
    rnd = random.Random(SEMILLA)
    nodos = []
    for r in range(ROWS):
        for c in range(COLS):
            ang = rnd.uniform(0, 2 * math.pi)
            mag = rnd.uniform(DESPLAZ_MIN, DESPLAZ_MAX)
            nodos.append({
                "id": nid(c, r), "col": c, "fila": r,
                "x": round(c * SPACING + mag * math.cos(ang), 1), "y": round(r * SPACING + mag * math.sin(ang), 1),
                "nombre": f"{AVENIDAS[c]} y {CALLES[r]}",
            })
    sin = {_norm(*p) for p in SIN_LUZ}
    media = {_norm(*p) for p in MEDIA_LUZ}
    quit_ = {_norm(*p) for p in QUITADOS}
    aristas = []
    eid = 1
    for r in range(ROWS):
        for c in range(COLS):
            for dc, dr in ((1, 0), (0, 1)):
                c2, r2 = c + dc, r + dr
                if c2 >= COLS or r2 >= ROWS:
                    continue
                key = _norm((c, r), (c2, r2))
                if key in quit_:
                    continue
                luz = 1 if key in sin else 2 if key in media else 3
                a, b = nid(c, r), nid(c2, r2)
                aristas.append({"id": eid, "a": a, "b": b, "metros": _distancia(nodos[a], nodos[b]), "luz": luz})
                eid += 1
    for (c, r), (c2, r2), luz in DIAGONALES:
        a, b = nid(c, r), nid(c2, r2)
        aristas.append({"id": eid, "a": a, "b": b, "metros": _distancia(nodos[a], nodos[b]), "luz": luz})
        eid += 1
    return nodos, aristas


def costo_arista(e, nodos_faro_abiertos, reportes_por_arista, usado=None):
    """costo = distancia + penalización por poca luz/reportes − bonificación por Faro abierto."""
    m = e["metros"]
    costo = float(m)
    costo += {1: 0.9, 2: 0.3, 3: 0.0}[e["luz"]] * m
    costo += min(reportes_por_arista.get(e["id"], 0), 3) * 0.5 * m
    if e["a"] in nodos_faro_abiertos or e["b"] in nodos_faro_abiertos:
        costo -= 0.35 * m
    if usado and e["id"] in usado:
        costo *= 2.5
    return max(costo, 0.1 * m)


def dijkstra(nodos, aristas, origen, destino, nodos_faro_abiertos, reportes_por_arista, usado=None):
    ady = {n["id"]: [] for n in nodos}
    for e in aristas:
        c = costo_arista(e, nodos_faro_abiertos, reportes_por_arista, usado)
        ady[e["a"]].append((e["b"], c, e))
        ady[e["b"]].append((e["a"], c, e))
    dist = {origen: 0.0}
    prev = {}
    cola = [(0.0, origen)]
    while cola:
        d, u = heapq.heappop(cola)
        if u == destino:
            break
        if d > dist.get(u, math.inf):
            continue
        for v, c, e in ady[u]:
            nd = d + c
            if nd < dist.get(v, math.inf):
                dist[v] = nd
                prev[v] = (u, e)
                heapq.heappush(cola, (nd, v))
    if destino not in dist:
        return None
    camino, tramos = [destino], []
    cur = destino
    while cur != origen:
        u, e = prev[cur]
        tramos.append(e)
        camino.append(u)
        cur = u
    camino.reverse()
    tramos.reverse()
    return camino, tramos


def mas_corta(nodos, aristas, origen, destino):
    """Ruta de menor distancia pura, para comparar cuánto se alarga la Ruta Faro."""
    ady = {n["id"]: [] for n in nodos}
    for e in aristas:
        ady[e["a"]].append((e["b"], e["metros"]))
        ady[e["b"]].append((e["a"], e["metros"]))
    dist = {origen: 0}
    cola = [(0, origen)]
    while cola:
        d, u = heapq.heappop(cola)
        if d > dist.get(u, math.inf):
            continue
        for v, m in ady[u]:
            if d + m < dist.get(v, math.inf):
                dist[v] = d + m
                heapq.heappush(cola, (d + m, v))
    return dist.get(destino)
