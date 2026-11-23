"""API de FaroLocal (Flask + SQLite). Sirve también el frontend estático."""
import json
import os
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from functools import wraps

import jwt
from flask import Flask, g, jsonify, request, send_from_directory
from werkzeug.security import check_password_hash, generate_password_hash

import db
import graph

SECRET = os.environ.get("FARO_SECRET", "farolocal-demo-secret-cambiar-en-produccion")
FRONT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
TIPOS_REPORTE = ["Luminaria apagada", "Tramo sin iluminación", "Banqueta en mal estado", "Poco tránsito de noche"]
MAX_CONTACTOS = 5

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024   # ninguna petición legítima de la app pasa de unos cientos de bytes
_ZONA = {}
MAX_PASSWORD = 128          # evita enviar contraseñas enormes para gastar CPU en el hash
MAX_SERVICIOS = 10
MAX_REPORTES_PENDIENTES = 10
if SECRET == "farolocal-demo-secret-cambiar-en-produccion":
    print("AVISO: usando la clave de demostración para los tokens. Define FARO_SECRET fuera de la demo.")


# ----------------------------------------------------------------- utilidades
def con():
    if "con" not in g:
        g.con = db.connect()
    return g.con


@app.teardown_appcontext
def cerrar(_):
    c = g.pop("con", None)
    if c:
        c.close()


def err(msg, code=400, campo=None):
    out = {"error": msg}
    if campo:
        out["campo"] = campo
    return jsonify(out), code


def rows(cur):
    return [dict(r) for r in cur.fetchall()]


def zona():
    """Nodos y aristas se leen una vez (no cambian durante la ejecución)."""
    if not _ZONA:
        c = db.connect()
        _ZONA["nodos"] = rows(c.execute("SELECT * FROM nodos ORDER BY id"))
        _ZONA["aristas"] = rows(c.execute("SELECT * FROM aristas ORDER BY id"))
        c.close()
    return _ZONA["nodos"], _ZONA["aristas"]


def hora_valida(h):
    if h and re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", h):
        return h
    return datetime.now().strftime("%H:%M")


def esta_abierto(abre, cierra, hora):
    if abre == cierra:
        return True  # 24 horas
    if abre < cierra:
        return abre <= hora < cierra
    return hora >= abre or hora < cierra


def negocio_json(n, hora):
    d = dict(n)
    d["servicios"] = json.loads(d["servicios"])
    d["abierto"] = esta_abierto(d["abre"], d["cierra"], hora)
    return d


def negocio_publico(n, hora):
    """Lo que puede ver cualquiera (mapa y ficha). Los contadores, el titular y los datos de revisión son privados."""
    d = negocio_json(n, hora)
    campos = ("id", "nombre", "direccion", "nodo_id", "giro", "abre", "cierra", "servicios", "abierto")
    return {k: d[k] for k in campos}


def token_para(u):
    payload = {"sub": str(u["id"]), "rol": u["rol"], "exp": datetime.now(timezone.utc) + timedelta(hours=12)}
    return jwt.encode(payload, SECRET, algorithm="HS256")


def requiere(*roles):
    def deco(fn):
        @wraps(fn)
        def wrap(*a, **k):
            h = request.headers.get("Authorization", "")
            if not h.startswith("Bearer "):
                return err("Inicia sesión para continuar.", 401)
            try:
                data = jwt.decode(h[7:], SECRET, algorithms=["HS256"])
            except jwt.PyJWTError:
                return err("Tu sesión expiró. Inicia sesión de nuevo.", 401)
            u = con().execute("SELECT * FROM usuarios WHERE id=?", (int(data["sub"]),)).fetchone()
            if not u:
                return err("Usuario no encontrado.", 401)
            if roles and u["rol"] not in roles:
                return err("No tienes permiso para esta acción.", 403)
            g.user = dict(u)
            return fn(*a, **k)
        return wrap
    return deco


def cuerpo():
    """Cuerpo JSON de la petición; si no es un objeto (lista, número, texto…) se trata como vacío."""
    d = request.get_json(silent=True)
    return d if isinstance(d, dict) else {}


def entero(valor, campo, mensaje):
    """Convierte a int de forma segura; cualquier cosa rara (lista, dict, texto, booleano) → error 400 con campo."""
    if isinstance(valor, bool) or not isinstance(valor, (int, str)):
        raise ValueError((campo, mensaje))
    try:
        return int(valor)
    except ValueError:
        raise ValueError((campo, mensaje))


def numero(valor, campo, mensaje):
    if isinstance(valor, bool) or not isinstance(valor, (int, float, str)):
        raise ValueError((campo, mensaje))
    try:
        n = float(valor)
    except ValueError:
        raise ValueError((campo, mensaje))
    if n != n or n in (float("inf"), float("-inf")):
        raise ValueError((campo, mensaje))
    return n


def texto(d, campo, minimo=1, maximo=200, etiqueta=None):
    v = str(d.get(campo, "")).strip()
    et = etiqueta or campo
    if len(v) < minimo:
        raise ValueError((et, f"Escribe {et}."))
    if len(v) > maximo:
        raise ValueError((et, f"{et.capitalize()} no puede pasar de {maximo} caracteres."))
    return v


def validar(fn):
    """Convierte ValueError((campo,msg)) en respuesta 400."""
    @wraps(fn)
    def wrap(*a, **k):
        try:
            return fn(*a, **k)
        except ValueError as e:
            if e.args and isinstance(e.args[0], tuple):
                campo, msg = e.args[0]
                return err(msg, 400, campo)
            return err(str(e), 400)
    return wrap


# --------------------------------------------------- cabeceras de seguridad y errores
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
       "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")


@app.after_request
def cabeceras(r):
    r.headers.setdefault("Content-Security-Policy", CSP)
    r.headers.setdefault("X-Content-Type-Options", "nosniff")
    r.headers.setdefault("X-Frame-Options", "DENY")
    r.headers.setdefault("Referrer-Policy", "no-referrer")
    r.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    if request.path.startswith("/api/"):
        r.headers["Cache-Control"] = "no-store"          # respuestas de la API (a veces personales) no se guardan
    return r


MENSAJES = {404: "Recurso no encontrado.", 405: "Método no permitido.", 413: "La petición es demasiado grande.",
            500: "Ocurrió un problema en el servidor. Inténtalo de nuevo en un momento."}


@app.errorhandler(Exception)
def _error(e):
    from werkzeug.exceptions import HTTPException
    http = isinstance(e, HTTPException)
    if not http:
        app.logger.exception("Error no controlado")
    if request.path.startswith("/api/"):
        code = e.code if http else 500
        return err(MENSAJES.get(code, "No se pudo completar la acción."), code)
    return e if http else ("Error del servidor", 500)


# ----------------------------------------------------------------- auth (RF01)
@app.post("/api/auth/registro")
@validar
def registro():
    d = cuerpo()
    nombre = texto(d, "nombre", 2, 80, "tu nombre")
    correo = str(d.get("correo", "")).strip().lower()
    tel = re.sub(r"\D", "", str(d.get("telefono", "")))
    pwd = str(d.get("password", ""))
    rol = d.get("rol", "peaton")
    if rol not in ("peaton", "comercio"):
        return err("Tipo de cuenta no válido.", 400, "rol")
    if not EMAIL_RE.match(correo):
        return err("Escribe un correo válido.", 400, "correo")
    if len(tel) != 10:
        return err("El teléfono debe tener 10 dígitos.", 400, "telefono")
    if len(pwd) < 8:
        return err("La contraseña debe tener al menos 8 caracteres.", 400, "password")
    if len(pwd) > MAX_PASSWORD:
        return err(f"La contraseña no puede pasar de {MAX_PASSWORD} caracteres.", 400, "password")
    if con().execute("SELECT 1 FROM usuarios WHERE correo=?", (correo,)).fetchone():
        return err("Ese correo ya está registrado.", 409, "correo")
    cur = con().execute(
        "INSERT INTO usuarios (nombre,correo,telefono,password_hash,rol,creado) VALUES (?,?,?,?,?,?)",
        (nombre, correo, tel, generate_password_hash(pwd), rol, db.now()))
    con().commit()
    u = {"id": cur.lastrowid, "rol": rol}
    return jsonify({"token": token_para(u), "usuario": {"id": u["id"], "nombre": nombre, "correo": correo, "rol": rol}}), 201


@app.post("/api/auth/login")
def login():
    d = cuerpo()
    correo = str(d.get("correo", "")).strip().lower()
    u = con().execute("SELECT * FROM usuarios WHERE correo=?", (correo,)).fetchone()
    pwd = str(d.get("password", ""))
    if not u or len(pwd) > MAX_PASSWORD or not check_password_hash(u["password_hash"], pwd):
        return err("Correo o contraseña incorrectos.", 401)
    return jsonify({"token": token_para(u),
                    "usuario": {"id": u["id"], "nombre": u["nombre"], "correo": u["correo"], "rol": u["rol"]}})


@app.get("/api/auth/yo")
@requiere()
def yo():
    u = g.user
    return jsonify({"id": u["id"], "nombre": u["nombre"], "correo": u["correo"], "rol": u["rol"]})


# ------------------------------------------------- zona, faros, fichas (RF02, RF03)
@app.get("/api/zona")
def get_zona():
    hora = hora_valida(request.args.get("hora"))
    nodos, aristas = zona()
    aprob = {r["arista_id"]: r["n"] for r in con().execute(
        "SELECT arista_id, COUNT(*) n FROM reportes WHERE estado='aprobado' GROUP BY arista_id")}
    ar = [dict(a, reportes=aprob.get(a["id"], 0)) for a in aristas]
    faros = rows(con().execute("SELECT * FROM negocios WHERE estado='aprobado'"))
    return jsonify({"hora": hora, "nodos": nodos, "aristas": ar,
                    "faros": [negocio_publico(f, hora) for f in faros]})


@app.get("/api/faros/<int:fid>")
def ficha(fid):
    hora = hora_valida(request.args.get("hora"))
    n = con().execute("SELECT * FROM negocios WHERE id=? AND estado='aprobado'", (fid,)).fetchone()
    if not n:
        return err("Ese Punto Faro no existe o aún no está aprobado.", 404)
    con().execute("UPDATE negocios SET vistas = vistas + 1 WHERE id=?", (fid,))
    con().commit()
    out = negocio_publico(n, hora)
    out["cupones"] = cupones_vigentes(negocio_id=fid)
    return jsonify(out)


def cupones_vigentes(negocio_id=None, hora=None, solo_abiertos=False):
    hoy = date.today().isoformat()
    q = ("SELECT c.*, n.nombre negocio, n.abre, n.cierra, n.nodo_id FROM cupones c JOIN negocios n ON n.id=c.negocio_id "
         "WHERE c.activo=1 AND c.inicio<=? AND c.fin>=? AND n.estado='aprobado'")
    p = [hoy, hoy]
    if negocio_id:
        q += " AND c.negocio_id=?"
        p.append(negocio_id)
    out = []
    for c in rows(con().execute(q, p)):
        c["abierto"] = esta_abierto(c["abre"], c["cierra"], hora or hora_valida(None))
        if solo_abiertos and not c["abierto"]:
            continue
        out.append(c)
    return out


# ------------------------------------------------------------ Ruta Faro (RF04, RF05)
def nodo_mas_cercano(x, y):
    nodos, _ = zona()
    return min(nodos, key=lambda n: (n["x"] - x) ** 2 + (n["y"] - y) ** 2)["id"]


def resolver_punto(d, pref):
    """Acepta nodo_id directo o coordenadas (x,y) del mapa, que se ajustan al cruce más cercano."""
    nodos, _ = zona()
    if d.get(pref + "_nodo") is not None:
        n = entero(d[pref + "_nodo"], pref, "Ese punto no es válido.")
        if not any(x["id"] == n for x in nodos):
            raise ValueError((pref, "Ese punto está fuera de la zona piloto."))
        return n
    if d.get(pref + "_x") is not None and d.get(pref + "_y") is not None:
        x = numero(d[pref + "_x"], pref, "Ese punto no es válido.")
        y = numero(d[pref + "_y"], pref, "Ese punto no es válido.")
        xs = [n["x"] for n in nodos]
        ys = [n["y"] for n in nodos]
        margen = 60
        if not (min(xs) - margen <= x <= max(xs) + margen and min(ys) - margen <= y <= max(ys) + margen):
            raise ValueError((pref, "Ese punto está fuera de la zona piloto."))
        return nodo_mas_cercano(x, y)
    raise ValueError((pref, "Elige un punto de " + ("origen" if pref == "origen" else "destino") + "."))


def contexto_ruta(hora):
    faros = rows(con().execute("SELECT * FROM negocios WHERE estado='aprobado'"))
    abiertos = {f["nodo_id"] for f in faros if esta_abierto(f["abre"], f["cierra"], hora)}
    rep = {r["arista_id"]: r["n"] for r in con().execute(
        "SELECT arista_id, COUNT(*) n FROM reportes WHERE estado='aprobado' GROUP BY arista_id")}
    return faros, abiertos, rep


def armar_ruta(camino, tramos, faros, hora, abiertos, base_m):
    nodos, _ = zona()
    por_id = {n["id"]: n for n in nodos}
    metros = sum(t["metros"] for t in tramos)
    cerca = set(camino)
    pasa = []
    for f in faros:
        if f["nodo_id"] in cerca:
            pasa.append({"id": f["id"], "nombre": f["nombre"], "nodo_id": f["nodo_id"],
                         "abierto": f["nodo_id"] in abiertos})
    luz_prom = sum(t["luz"] * t["metros"] for t in tramos) / metros if metros else 3
    return {
        "nodos": camino,
        "puntos": [{"x": por_id[n]["x"], "y": por_id[n]["y"]} for n in camino],
        "metros": int(metros),
        "minutos": max(1, round(metros / 80)),  # ~4.8 km/h
        "faros_en_ruta": pasa,
        "faros_abiertos": sum(1 for p in pasa if p["abierto"]),
        "luz_promedio": round(luz_prom, 2),
        "tramos_oscuros": sum(1 for t in tramos if t["luz"] == 1),
        "mas_larga_que_corta_m": int(metros - base_m) if base_m is not None else 0,
    }


@app.post("/api/rutas")
@requiere("peaton")
@validar
def ruta():
    d = cuerpo()
    hora = hora_valida(d.get("hora"))
    o = resolver_punto(d, "origen")
    t = resolver_punto(d, "destino")
    if o == t:
        return err("El origen y el destino son el mismo punto.", 400, "destino")
    nodos, aristas = zona()
    faros, abiertos, rep = contexto_ruta(hora)
    r1 = graph.dijkstra(nodos, aristas, o, t, abiertos, rep)
    if not r1:
        return err("No encontramos una ruta entre esos puntos.", 404)
    base = graph.mas_corta(nodos, aristas, o, t)
    rutas = [armar_ruta(*r1, faros, hora, abiertos, base)]
    # alternativa (RF05): evita los tramos de la primera
    usado = {e["id"] for e in r1[1]}
    r2 = graph.dijkstra(nodos, aristas, o, t, abiertos, rep, usado)
    if r2 and [e["id"] for e in r2[1]] != [e["id"] for e in r1[1]]:
        rutas.append(armar_ruta(*r2, faros, hora, abiertos, base))
    # Calcular una ruta NO suma el contador del negocio: solo cuenta cuando el peatón la acepta (POST /api/rutas/aceptar).
    ids = {f["id"] for f in rutas[0]["faros_en_ruta"]}
    cup = [c for c in cupones_vigentes(hora=hora) if c["negocio_id"] in ids]
    return jsonify({"hora": hora, "origen": o, "destino": t, "distancia_corta_m": int(base),
                    "rutas": rutas, "cupones": cup})


@app.post("/api/rutas/aceptar")
@requiere("peaton")
@validar
def ruta_aceptar():
    """El peatón acepta ("Iniciar ruta") una Ruta Faro: suma +1 al contador de rutas de cada Faro aprobado de la lista (RF11)."""
    lista = cuerpo().get("faros")
    if not isinstance(lista, list) or len(lista) > 50:
        raise ValueError(("faros", "Indica los Faros de tu ruta."))
    ids = sorted({entero(x, "faros", "Ese Faro no es válido.") for x in lista})
    contados = []
    for fid in ids:
        cur = con().execute("UPDATE negocios SET rutas = rutas + 1 WHERE id=? AND estado='aprobado'", (fid,))
        if cur.rowcount:
            contados.append(fid)
    con().commit()
    return jsonify({"faros": contados})


# ------------------------------------------------------------ contactos (RF06)
def validar_contacto(d, uid, excluir=None):
    nombre = texto(d, "nombre", 2, 60, "el nombre del contacto")
    cel = re.sub(r"\D", "", str(d.get("celular", "")))
    if len(cel) != 10:
        raise ValueError(("celular", "El celular debe tener 10 dígitos."))
    q = "SELECT 1 FROM contactos WHERE usuario_id=? AND celular=?"
    p = [uid, cel]
    if excluir:
        q += " AND id<>?"
        p.append(excluir)
    if con().execute(q, p).fetchone():
        raise ValueError(("celular", "Ya tienes un contacto con ese celular."))
    return nombre, cel


@app.get("/api/contactos")
@requiere("peaton")
def contactos():
    return jsonify(rows(con().execute("SELECT id,nombre,celular FROM contactos WHERE usuario_id=? ORDER BY id", (g.user["id"],))))


@app.post("/api/contactos")
@requiere("peaton")
@validar
def contacto_nuevo():
    n = con().execute("SELECT COUNT(*) FROM contactos WHERE usuario_id=?", (g.user["id"],)).fetchone()[0]
    if n >= MAX_CONTACTOS:
        return err(f"Puedes tener máximo {MAX_CONTACTOS} contactos de confianza.", 400)
    nombre, cel = validar_contacto(cuerpo(), g.user["id"])
    cur = con().execute("INSERT INTO contactos (usuario_id,nombre,celular) VALUES (?,?,?)", (g.user["id"], nombre, cel))
    con().commit()
    return jsonify({"id": cur.lastrowid, "nombre": nombre, "celular": cel}), 201


@app.put("/api/contactos/<int:cid>")
@requiere("peaton")
@validar
def contacto_editar(cid):
    if not con().execute("SELECT 1 FROM contactos WHERE id=? AND usuario_id=?", (cid, g.user["id"])).fetchone():
        return err("Contacto no encontrado.", 404)
    nombre, cel = validar_contacto(cuerpo(), g.user["id"], excluir=cid)
    con().execute("UPDATE contactos SET nombre=?, celular=? WHERE id=?", (nombre, cel, cid))
    con().commit()
    return jsonify({"id": cid, "nombre": nombre, "celular": cel})


@app.delete("/api/contactos/<int:cid>")
@requiere("peaton")
def contacto_borrar(cid):
    cur = con().execute("DELETE FROM contactos WHERE id=? AND usuario_id=?", (cid, g.user["id"]))
    con().commit()
    if not cur.rowcount:
        return err("Contacto no encontrado.", 404)
    return jsonify({"ok": True})


# ------------------------------------------------------------------- SOS (RF07)
@app.post("/api/sos")
@requiere("peaton")
def sos():
    d = cuerpo()
    nodo = None
    try:
        if d.get("nodo") is not None or d.get("x") is not None:
            nodo = resolver_punto({"u_nodo": d.get("nodo"), "u_x": d.get("x"), "u_y": d.get("y")}, "u")
    except ValueError:
        nodo = None
    cs = rows(con().execute("SELECT nombre,celular FROM contactos WHERE usuario_id=?", (g.user["id"],)))
    cur = con().execute("INSERT INTO alertas (usuario_id,nodo_id,estado,contactos,creado) VALUES (?,?,?,?,?)",
                        (g.user["id"], nodo, "pendiente", json.dumps(cs, ensure_ascii=False), db.now()))
    con().commit()
    return jsonify({"id": cur.lastrowid, "estado": "pendiente", "contactos": cs,
                    "sin_contactos": len(cs) == 0, "cancelable_segundos": 10, "llamar": "tel:911"}), 201


@app.post("/api/sos/<int:aid>/cancelar")
@requiere("peaton")
def sos_cancelar(aid):
    a = con().execute("SELECT * FROM alertas WHERE id=? AND usuario_id=?", (aid, g.user["id"])).fetchone()
    if not a:
        return err("Alerta no encontrada.", 404)
    if a["estado"] != "pendiente":
        return err("La alerta ya no se puede cancelar.", 409)
    con().execute("UPDATE alertas SET estado='cancelada' WHERE id=?", (aid,))
    con().commit()
    return jsonify({"id": aid, "estado": "cancelada"})


@app.post("/api/sos/<int:aid>/confirmar")
@requiere("peaton")
def sos_confirmar(aid):
    """Se llama al terminar la cuenta regresiva: la alerta pasa a 'enviada' (aviso simulado)."""
    a = con().execute("SELECT * FROM alertas WHERE id=? AND usuario_id=?", (aid, g.user["id"])).fetchone()
    if not a:
        return err("Alerta no encontrada.", 404)
    if a["estado"] == "cancelada":
        return err("La alerta fue cancelada.", 409)
    con().execute("UPDATE alertas SET estado='enviada' WHERE id=?", (aid,))
    con().commit()
    return jsonify({"id": aid, "estado": "enviada", "contactos": json.loads(a["contactos"]), "llamar": "tel:911"})


@app.get("/api/sos")
@requiere("peaton")
def sos_bandeja():
    out = rows(con().execute("SELECT * FROM alertas WHERE usuario_id=? ORDER BY id DESC LIMIT 20", (g.user["id"],)))
    for a in out:
        a["contactos"] = json.loads(a["contactos"])
    return jsonify(out)


# --------------------------------------------------------------- cupones (RF08)
@app.get("/api/cupones")
def cupones():
    hora = hora_valida(request.args.get("hora"))
    return jsonify(cupones_vigentes(hora=hora, solo_abiertos=request.args.get("abiertos") == "1"))


@app.get("/api/cupones/mios")
@requiere("peaton")
def cupones_mios():
    """MIS CUPONES: los códigos personales que el peatón ya obtuvo (los más recientes primero)."""
    filas = con().execute(
        "SELECT ca.id, ca.codigo, ca.creado, ca.canjeado_en, cu.id cupon_id, cu.titulo, cu.descripcion, cu.fin, "
        "n.id negocio_id, n.nombre negocio, n.direccion FROM canjes ca JOIN cupones cu ON cu.id=ca.cupon_id "
        "JOIN negocios n ON n.id=cu.negocio_id WHERE ca.usuario_id=? ORDER BY ca.id DESC", (g.user["id"],)).fetchall()
    return jsonify([dict(f, canjeado=f["canjeado_en"] is not None) for f in filas])


@app.post("/api/cupones/<int:cid>/obtener")
@requiere("peaton")
def cupon_obtener(cid):
    c = next((x for x in cupones_vigentes() if x["id"] == cid), None)
    if not c:
        return err("Ese cupón ya no está disponible.", 404)
    ya = con().execute("SELECT * FROM canjes WHERE cupon_id=? AND usuario_id=? AND canjeado_en IS NULL",
                       (cid, g.user["id"])).fetchone()
    if ya:
        return jsonify({"codigo": ya["codigo"], "cupon": c})
    codigo = "FARO-" + secrets.token_hex(3).upper()
    con().execute("INSERT INTO canjes (cupon_id,usuario_id,codigo,creado) VALUES (?,?,?,?)",
                  (cid, g.user["id"], codigo, db.now()))
    con().commit()
    return jsonify({"codigo": codigo, "cupon": c}), 201


# -------------------------------------------------------------- reportes (RF09)
@app.get("/api/tipos-reporte")
def tipos():
    return jsonify(TIPOS_REPORTE)


@app.post("/api/reportes")
@requiere("peaton")
@validar
def reporte_nuevo():
    d = cuerpo()
    tipo = d.get("tipo")
    if tipo not in TIPOS_REPORTE:
        return err("Elige un tipo de reporte.", 400, "tipo")
    desc = texto(d, "descripcion", 5, 250, "la descripción")
    _, aristas = zona()
    aid = entero(d.get("arista_id") or 0, "arista_id", "Elige un tramo en el mapa.")
    if not any(a["id"] == aid for a in aristas):
        return err("Elige un tramo en el mapa.", 400, "arista_id")
    pendientes = con().execute("SELECT COUNT(*) FROM reportes WHERE usuario_id=? AND estado='pendiente'", (g.user["id"],)).fetchone()[0]
    if pendientes >= MAX_REPORTES_PENDIENTES:
        return err(f"Ya tienes {MAX_REPORTES_PENDIENTES} reportes en revisión. Espera a que un administrador los revise.", 429)
    cur = con().execute("INSERT INTO reportes (usuario_id,arista_id,tipo,descripcion,estado,creado) VALUES (?,?,?,?,?,?)",
                        (g.user["id"], aid, tipo, desc, "pendiente", db.now()))
    con().commit()
    return jsonify({"id": cur.lastrowid, "estado": "pendiente"}), 201


@app.get("/api/reportes/mios")
@requiere("peaton")
def reportes_mios():
    return jsonify(rows(con().execute("SELECT * FROM reportes WHERE usuario_id=? ORDER BY id DESC", (g.user["id"],))))


# ------------------------------------------------------------ comercio (RF10-13)
def negocio_propio():
    return con().execute("SELECT * FROM negocios WHERE titular_id=?", (g.user["id"],)).fetchone()


def leer_negocio(d):
    nodos, _ = zona()
    nombre = texto(d, "nombre", 3, 80, "el nombre del negocio")
    direccion = texto(d, "direccion", 5, 160, "la dirección")
    giro = texto(d, "giro", 3, 40, "el giro")
    abre, cierra = str(d.get("abre", "")), str(d.get("cierra", ""))
    for campo, v in (("abre", abre), ("cierra", cierra)):
        if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", v):
            raise ValueError((campo, "Escribe la hora en formato HH:MM."))
    nodo = entero(d.get("nodo_id"), "nodo_id", "Marca la ubicación del negocio en el mapa.")
    if not any(n["id"] == nodo for n in nodos):
        raise ValueError(("nodo_id", "La ubicación está fuera de la zona piloto."))
    servicios = d.get("servicios") or []
    if not isinstance(servicios, list) or not all(isinstance(s, str) for s in servicios):
        raise ValueError(("servicios", "Servicios no válidos."))
    if not servicios:
        raise ValueError(("servicios", "Elige al menos un servicio de apoyo para peatones."))
    servicios = list(dict.fromkeys(s.strip() for s in servicios if s.strip()))   # sin repetidos ni vacíos
    if not servicios or len(servicios) > MAX_SERVICIOS or any(len(s) > 40 for s in servicios):
        raise ValueError(("servicios", f"Elige entre 1 y {MAX_SERVICIOS} servicios (cada uno de hasta 40 caracteres)."))
    return nombre, direccion, giro, abre, cierra, nodo, json.dumps(servicios, ensure_ascii=False)


@app.get("/api/negocio")
@requiere("comercio")
def mi_negocio():
    n = negocio_propio()
    if not n:
        return jsonify(None)
    return jsonify(negocio_json(n, hora_valida(None)))


@app.post("/api/negocio")
@requiere("comercio")
@validar
def negocio_registrar():
    if negocio_propio():
        return err("Ya registraste un negocio. Puedes editarlo.", 409)
    nombre, dire, giro, ab, ci, nodo, serv = leer_negocio(cuerpo())
    cur = con().execute("INSERT INTO negocios (titular_id,nombre,direccion,nodo_id,giro,abre,cierra,servicios,estado) "
                        "VALUES (?,?,?,?,?,?,?,?,'pendiente')", (g.user["id"], nombre, dire, nodo, giro, ab, ci, serv))
    con().commit()
    return jsonify({"id": cur.lastrowid, "estado": "pendiente"}), 201


@app.put("/api/negocio")
@requiere("comercio")
@validar
def negocio_editar():
    n = negocio_propio()
    if not n:
        return err("Aún no registras un negocio.", 404)
    nombre, dire, giro, ab, ci, nodo, serv = leer_negocio(cuerpo())
    importante = (nombre, nodo, ab, ci, serv) != (n["nombre"], n["nodo_id"], n["abre"], n["cierra"], n["servicios"])
    # un negocio rechazado que el titular corrige y guarda vuelve a revisión (aunque solo cambie, p. ej., la dirección)
    estado = "pendiente" if ((importante and n["estado"] != "pendiente") or n["estado"] == "rechazado") else n["estado"]
    con().execute("UPDATE negocios SET nombre=?,direccion=?,giro=?,abre=?,cierra=?,nodo_id=?,servicios=?,estado=?,"
                  "motivo_rechazo=CASE WHEN ?='pendiente' THEN NULL ELSE motivo_rechazo END WHERE id=?",
                  (nombre, dire, giro, ab, ci, nodo, serv, estado, estado, n["id"]))
    con().commit()
    return jsonify({"id": n["id"], "estado": estado, "reenviado_a_revision": estado != n["estado"]})


@app.get("/api/negocio/panel")
@requiere("comercio")
def panel():
    n = negocio_propio()
    if not n:
        return err("Aún no registras un negocio.", 404)
    canjes = con().execute("SELECT COUNT(*) FROM canjes c JOIN cupones u ON u.id=c.cupon_id "
                           "WHERE u.negocio_id=? AND c.canjeado_en IS NOT NULL", (n["id"],)).fetchone()[0]
    hoy = date.today().isoformat()
    activos = con().execute("SELECT COUNT(*) FROM cupones WHERE negocio_id=? AND activo=1 AND fin>=?", (n["id"], hoy)).fetchone()[0]
    return jsonify({"negocio": negocio_json(n, hora_valida(None)), "vistas": n["vistas"], "rutas": n["rutas"],
                    "canjes": canjes, "cupones_activos": activos})


def cupon_propio(cid):
    n = negocio_propio()
    if not n:
        return None
    return con().execute("SELECT * FROM cupones WHERE id=? AND negocio_id=?", (cid, n["id"])).fetchone()


def leer_cupon(d):
    titulo = texto(d, "titulo", 3, 80, "el título")
    desc = texto(d, "descripcion", 3, 200, "la descripción")
    try:
        ini = date.fromisoformat(str(d.get("inicio")))
        fin = date.fromisoformat(str(d.get("fin")))
    except ValueError:
        raise ValueError(("inicio", "Escribe las fechas de vigencia."))
    if fin <= ini:
        raise ValueError(("fin", "La fecha de fin debe ser posterior a la de inicio."))
    return titulo, desc, ini.isoformat(), fin.isoformat()


@app.get("/api/negocio/cupones")
@requiere("comercio")
def mis_cupones():
    n = negocio_propio()
    if not n:
        return jsonify([])
    out = rows(con().execute("SELECT * FROM cupones WHERE negocio_id=? ORDER BY id DESC", (n["id"],)))
    for c in out:
        c["canjes"] = con().execute("SELECT COUNT(*) FROM canjes WHERE cupon_id=? AND canjeado_en IS NOT NULL", (c["id"],)).fetchone()[0]
    return jsonify(out)


@app.post("/api/negocio/cupones")
@requiere("comercio")
@validar
def cupon_crear():
    n = negocio_propio()
    if not n or n["estado"] != "aprobado":
        return err("Solo un negocio aprobado puede publicar cupones.", 403)
    t, d, i, f = leer_cupon(cuerpo())
    cur = con().execute("INSERT INTO cupones (negocio_id,titulo,descripcion,inicio,fin,activo) VALUES (?,?,?,?,?,1)",
                        (n["id"], t, d, i, f))
    con().commit()
    return jsonify({"id": cur.lastrowid}), 201


@app.put("/api/negocio/cupones/<int:cid>")
@requiere("comercio")
@validar
def cupon_editar(cid):
    if not cupon_propio(cid):
        return err("Cupón no encontrado.", 404)
    d = cuerpo()
    t, ds, i, f = leer_cupon(d)
    con().execute("UPDATE cupones SET titulo=?,descripcion=?,inicio=?,fin=?,activo=? WHERE id=?",
                  (t, ds, i, f, 1 if d.get("activo", True) else 0, cid))
    con().commit()
    return jsonify({"id": cid})


@app.post("/api/negocio/cupones/<int:cid>/activo")
@requiere("comercio")
def cupon_activo(cid):
    c = cupon_propio(cid)
    if not c:
        return err("Cupón no encontrado.", 404)
    nuevo = 0 if c["activo"] else 1
    con().execute("UPDATE cupones SET activo=? WHERE id=?", (nuevo, cid))
    con().commit()
    return jsonify({"id": cid, "activo": nuevo})


@app.delete("/api/negocio/cupones/<int:cid>")
@requiere("comercio")
def cupon_borrar(cid):
    if not cupon_propio(cid):
        return err("Cupón no encontrado.", 404)
    con().execute("DELETE FROM cupones WHERE id=?", (cid,))
    con().commit()
    return jsonify({"ok": True})


@app.post("/api/negocio/cupones/validar")
@requiere("comercio")
def cupon_validar():
    n = negocio_propio()
    codigo = str(cuerpo().get("codigo", "")).strip().upper()
    if not codigo:
        return err("Escribe el código del cupón.", 400, "codigo")
    r = con().execute("SELECT c.*, u.titulo, u.negocio_id, u.inicio, u.fin, u.activo FROM canjes c "
                      "JOIN cupones u ON u.id=c.cupon_id WHERE c.codigo=?", (codigo,)).fetchone()
    if not r or not n or r["negocio_id"] != n["id"]:
        return jsonify({"valido": False, "motivo": "Código no encontrado en tu negocio."})
    hoy = date.today().isoformat()
    if r["canjeado_en"]:
        return jsonify({"valido": False, "motivo": "Este cupón ya fue canjeado."})
    if not r["activo"]:
        return jsonify({"valido": False, "motivo": "El cupón está desactivado."})
    if not (r["inicio"] <= hoy <= r["fin"]):
        return jsonify({"valido": False, "motivo": "El cupón está vencido o aún no inicia."})
    con().execute("UPDATE canjes SET canjeado_en=? WHERE id=?", (db.now(), r["id"]))
    con().commit()
    return jsonify({"valido": True, "titulo": r["titulo"]})


# ------------------------------------------------------------------ admin (RF14-15)
@app.get("/api/admin/resumen")
@requiere("admin")
def admin_resumen():
    c = con()
    return jsonify({
        "negocios_pendientes": c.execute("SELECT COUNT(*) FROM negocios WHERE estado='pendiente'").fetchone()[0],
        "negocios_aprobados": c.execute("SELECT COUNT(*) FROM negocios WHERE estado='aprobado'").fetchone()[0],
        "reportes_pendientes": c.execute("SELECT COUNT(*) FROM reportes WHERE estado='pendiente'").fetchone()[0],
        "usuarios": c.execute("SELECT COUNT(*) FROM usuarios WHERE rol='peaton'").fetchone()[0],
    })


@app.get("/api/admin/negocios")
@requiere("admin")
def admin_negocios():
    estado = request.args.get("estado")
    q, p = "SELECT n.*, u.nombre titular, u.correo titular_correo FROM negocios n JOIN usuarios u ON u.id=n.titular_id", []
    if estado in ("pendiente", "aprobado", "rechazado"):
        q += " WHERE n.estado=?"
        p.append(estado)
    q += " ORDER BY n.id"
    return jsonify([negocio_json(n, hora_valida(None)) for n in con().execute(q, p).fetchall()])


def _revisar(tabla, rid, estado, motivo=None):
    r = con().execute(f"SELECT * FROM {tabla} WHERE id=?", (rid,)).fetchone()
    if not r:
        return err("No encontrado.", 404)
    if r["estado"] != "pendiente":
        return err("Este elemento ya fue revisado.", 409)
    if tabla == "negocios":
        con().execute("UPDATE negocios SET estado=?,motivo_rechazo=?,revisado_por=?,revisado_en=? WHERE id=?",
                      (estado, motivo, g.user["id"], db.now(), rid))
    else:
        con().execute("UPDATE reportes SET estado=?,revisado_por=?,revisado_en=? WHERE id=?",
                      (estado, g.user["id"], db.now(), rid))
    con().commit()
    return jsonify({"id": rid, "estado": estado})


@app.post("/api/admin/negocios/<int:nid>/aprobar")
@requiere("admin")
def admin_aprobar_negocio(nid):
    return _revisar("negocios", nid, "aprobado")


@app.post("/api/admin/negocios/<int:nid>/rechazar")
@requiere("admin")
def admin_rechazar_negocio(nid):
    motivo = str(cuerpo().get("motivo", "")).strip()
    if len(motivo) < 5:
        return err("Escribe el motivo del rechazo (se lo mostraremos al titular).", 400, "motivo")
    return _revisar("negocios", nid, "rechazado", motivo[:300])


@app.get("/api/admin/reportes")
@requiere("admin")
def admin_reportes():
    estado = request.args.get("estado")
    q = ("SELECT r.*, u.nombre autor, a.a, a.b FROM reportes r JOIN usuarios u ON u.id=r.usuario_id "
         "JOIN aristas a ON a.id=r.arista_id")
    p = []
    if estado in ("pendiente", "aprobado", "rechazado"):
        q += " WHERE r.estado=?"
        p.append(estado)
    return jsonify(rows(con().execute(q + " ORDER BY r.id", p)))


@app.post("/api/admin/reportes/<int:rid>/aprobar")
@requiere("admin")
def admin_aprobar_reporte(rid):
    return _revisar("reportes", rid, "aprobado")


@app.post("/api/admin/reportes/<int:rid>/rechazar")
@requiere("admin")
def admin_rechazar_reporte(rid):
    return _revisar("reportes", rid, "rechazado")


# ---------------------------------------------------------------- frontend estático
@app.get("/")
def raiz():
    return send_from_directory(FRONT, "index.html")


@app.get("/<path:ruta>")
def estatico(ruta):
    if ruta.startswith("api/"):
        return err("Recurso no encontrado.", 404)
    ruta_abs = os.path.join(FRONT, ruta)
    if os.path.isdir(ruta_abs):
        ruta = ruta.rstrip("/") + "/index.html"  # "/" fijo: en Windows os.path.join usa "\" y send_from_directory lo rechaza
    return send_from_directory(FRONT, ruta)


if __name__ == "__main__":
    if not os.path.exists(db.DB_PATH):
        db.seed()
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
