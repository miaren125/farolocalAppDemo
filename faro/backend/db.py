"""Capa de datos: esquema SQLite y datos de prueba (semilla) de FaroLocal."""
import json
import os
import random
import sqlite3
from datetime import date, datetime, timedelta

from werkzeug.security import generate_password_hash

import graph

DB_PATH = os.environ.get("FARO_DB", os.path.join(os.path.dirname(__file__), "faro.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  correo TEXT NOT NULL UNIQUE,
  telefono TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL CHECK (rol IN ('peaton','comercio','admin')),
  creado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contactos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  celular TEXT NOT NULL,
  UNIQUE (usuario_id, celular)
);
CREATE TABLE IF NOT EXISTS nodos (
  id INTEGER PRIMARY KEY, col INTEGER, fila INTEGER, x REAL, y REAL, nombre TEXT
);
CREATE TABLE IF NOT EXISTS aristas (
  id INTEGER PRIMARY KEY, a INTEGER NOT NULL, b INTEGER NOT NULL,
  metros REAL NOT NULL, luz INTEGER NOT NULL CHECK (luz BETWEEN 1 AND 3)
);
CREATE TABLE IF NOT EXISTS negocios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titular_id INTEGER NOT NULL REFERENCES usuarios(id),
  nombre TEXT NOT NULL,
  direccion TEXT NOT NULL,
  nodo_id INTEGER NOT NULL REFERENCES nodos(id),
  giro TEXT NOT NULL,
  abre TEXT NOT NULL,
  cierra TEXT NOT NULL,
  servicios TEXT NOT NULL DEFAULT '[]',
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','rechazado')),
  motivo_rechazo TEXT,
  revisado_por INTEGER REFERENCES usuarios(id),
  revisado_en TEXT,
  vistas INTEGER NOT NULL DEFAULT 0,
  rutas INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cupones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  inicio TEXT NOT NULL,
  fin TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS canjes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cupon_id INTEGER NOT NULL REFERENCES cupones(id) ON DELETE CASCADE,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  codigo TEXT NOT NULL UNIQUE,
  creado TEXT NOT NULL,
  canjeado_en TEXT
);
CREATE TABLE IF NOT EXISTS reportes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  arista_id INTEGER NOT NULL REFERENCES aristas(id),
  tipo TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','rechazado')),
  creado TEXT NOT NULL,
  revisado_por INTEGER REFERENCES usuarios(id),
  revisado_en TEXT
);
CREATE TABLE IF NOT EXISTS alertas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  nodo_id INTEGER REFERENCES nodos(id),
  estado TEXT NOT NULL CHECK (estado IN ('pendiente','enviada','cancelada')),
  contactos TEXT NOT NULL DEFAULT '[]',
  creado TEXT NOT NULL
);
"""


def now():
    return datetime.now().isoformat(timespec="seconds")


def connect(path=None):
    con = sqlite3.connect(path or DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def init_db(path=None):
    con = connect(path)
    con.executescript(SCHEMA)
    con.commit()
    return con


def seed(path=None, reset=True):
    """Carga la zona piloto y datos de demostración."""
    p = path or DB_PATH
    if reset and os.path.exists(p):
        os.remove(p)
    con = init_db(p)
    nodos, aristas = graph.build_zone()
    con.executemany("INSERT INTO nodos VALUES (:id,:col,:fila,:x,:y,:nombre)", nodos)
    con.executemany("INSERT INTO aristas VALUES (:id,:a,:b,:metros,:luz)", aristas)

    hashes = {}

    def usuario(nombre, correo, tel, pwd, rol):
        if pwd not in hashes:  # un hash por contraseña de demo (el seed es más rápido)
            hashes[pwd] = generate_password_hash(pwd)
        cur = con.execute(
            "INSERT INTO usuarios (nombre,correo,telefono,password_hash,rol,creado) VALUES (?,?,?,?,?,?)",
            (nombre, correo, tel, hashes[pwd], rol, now()))
        return cur.lastrowid

    admin = usuario("Administración FaroLocal", "admin@farolocal.mx", "6621000000", "Admin123!", "admin")
    demo = usuario("Mia Valenzuela", "peaton@farolocal.mx", "6621111111", "Peaton123", "peaton")
    usuario("Gloria Demo", "gloria@farolocal.mx", "6621222222", "Peaton123", "peaton")
    for n, c in (("Mamá", "6622000001"), ("Fei Fei", "6622000002")):
        con.execute("INSERT INTO contactos (usuario_id,nombre,celular) VALUES (?,?,?)", (demo, n, c))

    # (nombre, titular, correo, giro, col, fila, abre, cierra, servicios, estado, motivo)
    negocios = [
        ("Farmacia Guadalupe 24 h", "Rosa Beltrán", "farmacia@farolocal.mx", "Farmacia", 1, 1, "00:00", "00:00",
         ["Agua", "Teléfono", "Cámara de vigilancia", "Personal toda la noche"], "aprobado", None),
        ("Tienda La Esquina", "Chuy Moreno", "esquina@farolocal.mx", "Abarrotes", 3, 1, "07:00", "01:00",
         ["Agua", "Teléfono"], "aprobado", None),
        ("Taquería El Faro Norteño", "Beto Salazar", "taqueria@farolocal.mx", "Taquería", 5, 2, "18:00", "04:00",
         ["Agua", "Baño", "Personal toda la noche"], "aprobado", None),
        ("Gasolinera Rosales", "Lupita Ibarra", "gasolinera@farolocal.mx", "Gasolinera", 0, 4, "00:00", "00:00",
         ["Agua", "Baño", "Teléfono", "Cámara de vigilancia", "Personal toda la noche"], "aprobado", None),
        ("Cafetería Luna", "Dani Ortega", "luna@farolocal.mx", "Cafetería", 2, 4, "16:00", "02:00",
         ["Agua", "Baño", "Teléfono"], "aprobado", None),
        ("Abarrotes Don Chuy", "Jesús Corrales", "donchuy@farolocal.mx", "Abarrotes", 6, 4, "06:00", "23:00",
         ["Agua"], "aprobado", None),
        ("Lonchería Doña Tere", "Tere Acosta", "tere@farolocal.mx", "Lonchería", 4, 5, "17:00", "03:00",
         ["Agua", "Baño"], "pendiente", None),
        ("Papelería y Copias Sol", "Marco Vega", "sol@farolocal.mx", "Papelería", 7, 1, "09:00", "22:00",
         ["Teléfono"], "pendiente", None),
        ("Bar Los Compadres", "Nacho Pineda", "compadres@farolocal.mx", "Bar", 6, 0, "20:00", "03:00",
         [], "rechazado", "El negocio no ofrece ningún servicio de apoyo a peatones. Agrega al menos uno y reenvía."),
    ]
    ids = {}
    for (nom, tit, correo, giro, c, r, ab, ci, serv, est, motivo) in negocios:
        uid = usuario(tit, correo, "662" + str(random.Random(nom).randint(3000000, 3999999)), "Comercio123", "comercio")
        nodo = graph.nid(c, r)
        cur = con.execute(
            "INSERT INTO negocios (titular_id,nombre,direccion,nodo_id,giro,abre,cierra,servicios,estado,motivo_rechazo,"
            "revisado_por,revisado_en,vistas,rutas) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (uid, nom, f"{nodos[nodo]['nombre']}, zona piloto", nodo, giro, ab, ci,
             json.dumps(serv, ensure_ascii=False), est, motivo,
             admin if est != "pendiente" else None, now() if est != "pendiente" else None,
             random.Random(nom + "v").randint(8, 60) if est == "aprobado" else 0,
             random.Random(nom + "r").randint(3, 30) if est == "aprobado" else 0))
        ids[nom] = cur.lastrowid

    hoy = date.today()
    ini = (hoy - timedelta(days=3)).isoformat()
    fin = (hoy + timedelta(days=60)).isoformat()
    cupones = [
        ("Farmacia Guadalupe 24 h", "10 % en vitaminas", "Presenta tu cupón en caja. No aplica con otras promociones."),
        ("Tienda La Esquina", "Agua gratis con tu compra", "Una botella de 600 ml con cualquier compra mayor a $30."),
        ("Taquería El Faro Norteño", "Refresco gratis con 3 tacos", "Válido de lunes a jueves."),
        ("Cafetería Luna", "2×1 en café americano", "Después de las 8 p. m."),
        ("Gasolinera Rosales", "Botella de agua de cortesía", "Con carga mínima de $100."),
    ]
    for nom, tit, desc in cupones:
        con.execute("INSERT INTO cupones (negocio_id,titulo,descripcion,inicio,fin,activo) VALUES (?,?,?,?,?,1)",
                    (ids[nom], tit, desc, ini, fin))
    # un cupón vencido y uno desactivado para probar filtros
    con.execute("INSERT INTO cupones (negocio_id,titulo,descripcion,inicio,fin,activo) VALUES (?,?,?,?,?,1)",
                (ids["Abarrotes Don Chuy"], "Cupón vencido de prueba", "Ya no debe mostrarse.",
                 (hoy - timedelta(days=40)).isoformat(), (hoy - timedelta(days=10)).isoformat()))
    con.execute("INSERT INTO cupones (negocio_id,titulo,descripcion,inicio,fin,activo) VALUES (?,?,?,?,?,0)",
                (ids["Abarrotes Don Chuy"], "Cupón desactivado de prueba", "Ya no debe mostrarse.", ini, fin))

    aristas_oscuras = [a["id"] for a in aristas if a["luz"] == 1]
    reportes = [
        (demo, aristas_oscuras[0], "Luminaria apagada", "Tres postes seguidos sin luz.", "aprobado"),
        (demo, aristas_oscuras[3], "Tramo sin iluminación", "Calle completamente oscura de noche.", "aprobado"),
        (demo, aristas_oscuras[5], "Banqueta en mal estado", "Hoyos grandes en la banqueta.", "pendiente"),
        (demo, aristas_oscuras[7], "Poco tránsito de noche", "Casi nadie pasa después de las 10.", "pendiente"),
    ]
    for u, a, t, d, e in reportes:
        con.execute("INSERT INTO reportes (usuario_id,arista_id,tipo,descripcion,estado,creado,revisado_por,revisado_en) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (u, a, t, d, e, now(), admin if e != "pendiente" else None, now() if e != "pendiente" else None))
    con.commit()
    con.close()
    return p


if __name__ == "__main__":
    print("Base de datos creada en", seed())
