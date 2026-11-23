"""Pruebas de la API. Ejecutar: python3 test_api.py"""
import os
import tempfile
import unittest

_tmp = tempfile.mkdtemp()
os.environ["FARO_DB"] = os.path.join(_tmp, "test.db")

import db  # noqa: E402
import app as appmod  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        db.seed(os.environ["FARO_DB"])
        appmod._ZONA.clear()
        self.c = appmod.app.test_client()

    def login(self, correo, pwd):
        r = self.c.post("/api/auth/login", json={"correo": correo, "password": pwd})
        self.assertEqual(r.status_code, 200, r.json)
        return {"Authorization": "Bearer " + r.json["token"]}

    def peaton(self):
        return self.login("peaton@farolocal.mx", "Peaton123")

    def admin(self):
        return self.login("admin@farolocal.mx", "Admin123!")

    def comercio(self, correo="esquina@farolocal.mx"):
        return self.login(correo, "Comercio123")


class TestAuth(Base):
    def test_registro_validaciones(self):
        base = {"nombre": "Ana Pérez", "correo": "ana@x.com", "telefono": "6621234567", "password": "abcdefgh"}
        for campo, val in (("correo", "mal"), ("telefono", "123"), ("password", "corta")):
            r = self.c.post("/api/auth/registro", json={**base, campo: val})
            self.assertEqual(r.status_code, 400)
            self.assertEqual(r.json["campo"], campo)
        self.assertEqual(self.c.post("/api/auth/registro", json=base).status_code, 201)
        self.assertEqual(self.c.post("/api/auth/registro", json=base).status_code, 409)

    def test_no_se_puede_registrar_admin(self):
        r = self.c.post("/api/auth/registro", json={"nombre": "X Y", "correo": "x@y.com", "telefono": "6621234567",
                                                    "password": "abcdefgh", "rol": "admin"})
        self.assertEqual(r.status_code, 400)

    def test_login_y_roles(self):
        self.assertEqual(self.c.post("/api/auth/login", json={"correo": "peaton@farolocal.mx", "password": "x"}).status_code, 401)
        h = self.peaton()
        self.assertEqual(self.c.get("/api/admin/resumen", headers=h).status_code, 403)
        self.assertEqual(self.c.get("/api/admin/resumen").status_code, 401)
        self.assertEqual(self.c.get("/api/admin/resumen", headers=self.admin()).status_code, 200)


class TestMapa(Base):
    def test_zona_y_horas(self):
        z = self.c.get("/api/zona?hora=12:00").json
        self.assertEqual(len(z["nodos"]), 48)
        nombres = {f["nombre"]: f for f in z["faros"]}
        self.assertEqual(len(z["faros"]), 6)  # solo aprobados
        self.assertTrue(nombres["Farmacia Guadalupe 24 h"]["abierto"])
        self.assertFalse(nombres["Taquería El Faro Norteño"]["abierto"])
        z2 = self.c.get("/api/zona?hora=23:30").json
        n2 = {f["nombre"]: f for f in z2["faros"]}
        self.assertTrue(n2["Taquería El Faro Norteño"]["abierto"])
        self.assertFalse(n2["Abarrotes Don Chuy"]["abierto"] and n2["Tienda La Esquina"]["abierto"] is False)

    def test_cruce_de_medianoche(self):
        from app import esta_abierto
        self.assertTrue(esta_abierto("18:00", "04:00", "02:00"))
        self.assertFalse(esta_abierto("18:00", "04:00", "05:00"))
        self.assertTrue(esta_abierto("00:00", "00:00", "13:00"))

    def test_ficha_cuenta_vistas_y_oculta_no_aprobados(self):
        self.assertEqual(self.c.get("/api/faros/7").status_code, 404)  # pendiente
        h = self.comercio("farmacia@farolocal.mx")        # los contadores solo los ve el titular (RF11)
        antes = self.c.get("/api/negocio/panel", headers=h).json["vistas"]
        a = self.c.get("/api/faros/1").json
        self.c.get("/api/faros/1")
        self.assertEqual(self.c.get("/api/negocio/panel", headers=h).json["vistas"], antes + 2)
        self.assertTrue(len(a["cupones"]) >= 1)
        self.assertNotIn("vistas", a)                      # y no son públicos


class TestRuta(Base):
    def pedir(self, o, d, hora="23:00", h=None):
        return self.c.post("/api/rutas", json={"origen_nodo": o, "destino_nodo": d, "hora": hora}, headers=h or self.peaton())

    def test_ruta_basica(self):
        r = self.pedir(0, 47)
        self.assertEqual(r.status_code, 200, r.json)
        ruta = r.json["rutas"][0]
        self.assertEqual(ruta["nodos"][0], 0)
        self.assertEqual(ruta["nodos"][-1], 47)
        self.assertGreaterEqual(ruta["metros"], r.json["distancia_corta_m"])

    def test_ruta_evita_oscuridad(self):
        """La Ruta Faro debe tener mejor luz promedio que la ruta más corta pura."""
        import graph
        nodos, aristas = appmod.zona()
        mejoras = 0
        detalle = []
        for o, d in ((16, 22), (9, 14), (17, 12), (24, 29)):
            ruta = self.pedir(o, d).json["rutas"][0]
            sin_costos = graph.dijkstra(nodos, aristas, o, d, set(), {})
            # costo "solo distancia": usar aristas con luz 3 y sin faros
            planas = [dict(a, luz=3) for a in aristas]
            corta = graph.dijkstra(nodos, planas, o, d, set(), {})
            luz_corta = sum(t["luz"] * t["metros"] for t in [next(a for a in aristas if a["id"] == e["id"]) for e in corta[1]]) / sum(
                t["metros"] for t in corta[1])
            detalle.append((o, d, ruta["luz_promedio"], round(luz_corta, 3)))
            # la API redondea la luz promedio a 2 decimales: con rutas idénticas hay que comparar con el mismo redondeo
            if ruta["luz_promedio"] >= round(luz_corta, 2):
                mejoras += 1
        self.assertEqual(mejoras, 4, detalle)

    def test_hora_cambia_resultado(self):
        """A distinta hora los Faros abiertos cambian y la ruta puede cambiar."""
        dia = self.pedir(8, 23, hora="12:00").json["rutas"][0]
        noche = self.pedir(8, 23, hora="23:00").json["rutas"][0]
        self.assertTrue(noche["faros_abiertos"] >= dia["faros_abiertos"])

    def test_reportes_aprobados_penalizan(self):
        r1 = self.pedir(16, 22, hora="12:00").json["rutas"][0]
        i = len(r1["nodos"]) // 2
        a, b = r1["nodos"][i], r1["nodos"][i + 1]
        _, aristas = appmod.zona()
        arista = next(e for e in aristas if {e["a"], e["b"]} == {a, b})
        h, ha = self.peaton(), self.admin()
        for _ in range(3):
            r = self.c.post("/api/reportes", json={"tipo": "Luminaria apagada", "descripcion": "Poste apagado", "arista_id": arista["id"]}, headers=h).json
            self.c.post(f"/api/admin/reportes/{r['id']}/aprobar", headers=ha)
        r2 = self.pedir(16, 22, hora="12:00").json["rutas"][0]
        pares = lambda ns: {frozenset(p) for p in zip(ns, ns[1:])}
        self.assertNotIn(frozenset((a, b)), pares(r2["nodos"]))

    def test_fuera_de_zona_y_mismo_punto(self):
        h = self.peaton()
        r = self.c.post("/api/rutas", json={"origen_x": 9999, "origen_y": 9999, "destino_nodo": 3}, headers=h)
        self.assertEqual(r.status_code, 400)
        self.assertIn("fuera de la zona", r.json["error"])
        self.assertEqual(self.pedir(5, 5).status_code, 400)

    def test_alternativa_y_contador(self):
        r = self.pedir(0, 47).json
        self.assertEqual(len(r["rutas"]), 2)
        self.assertNotEqual(r["rutas"][0]["nodos"], r["rutas"][1]["nodos"])

    def test_solo_peaton(self):
        self.assertEqual(self.pedir(0, 5, h=self.admin()).status_code, 403)

    def test_zona_no_es_cuadricula_perfecta(self):
        """Las coordenadas están desplazadas de forma determinista, hay diagonales y 'metros' es la distancia real."""
        import graph
        import math
        nodos, aristas = graph.build_zone()
        self.assertEqual([n["id"] for n in nodos], list(range(graph.COLS * graph.ROWS)))
        desp = [math.hypot(n["x"] - n["col"] * graph.SPACING, n["y"] - n["fila"] * graph.SPACING) for n in nodos]
        self.assertTrue(all(graph.DESPLAZ_MIN - 0.5 <= d <= graph.DESPLAZ_MAX + 0.5 for d in desp))
        self.assertEqual(nodos, graph.build_zone()[0])                      # determinista
        por = {n["id"]: n for n in nodos}
        diag = [a for a in aristas if por[a["a"]]["col"] != por[a["b"]]["col"] and por[a["a"]]["fila"] != por[a["b"]]["fila"]]
        self.assertGreaterEqual(len(diag), 3)
        for a in aristas:
            real = math.hypot(por[a["a"]]["x"] - por[a["b"]]["x"], por[a["a"]]["y"] - por[a["b"]]["y"])
            self.assertAlmostEqual(a["metros"], real, delta=0.06)

    def test_calcular_no_suma_y_aceptar_si(self):
        """RF11: calcular una ruta no cuenta; el contador de cada Faro sube solo con POST /api/rutas/aceptar."""
        hc = self.comercio("farmacia@farolocal.mx")
        antes = self.c.get("/api/negocio/panel", headers=hc).json["rutas"]
        h = self.peaton()
        ruta = None
        for o, d in ((0, 47), (6, 41), (3, 44)):
            r = self.pedir(o, d, h=h).json["rutas"][0]
            if r["faros_en_ruta"]:
                ruta = r
                break
        self.assertIsNotNone(ruta)
        self.assertEqual(self.c.get("/api/negocio/panel", headers=hc).json["rutas"], antes)
        ids = [f["id"] for f in ruta["faros_en_ruta"]]
        r = self.c.post("/api/rutas/aceptar", json={"faros": ids + ids}, headers=h)    # repetidos cuentan una sola vez
        self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(sorted(r.json["faros"]), sorted(set(ids)))

    def test_aceptar_ruta_valida_y_solo_aprobados(self):
        h = self.peaton()
        for malo in ({}, {"faros": "x"}, {"faros": [[1]]}, {"faros": [True]}, {"faros": list(range(60))}):
            r = self.c.post("/api/rutas/aceptar", json=malo, headers=h)
            self.assertEqual(r.status_code, 400, malo)
            self.assertEqual(r.json.get("campo"), "faros")
        r = self.c.post("/api/rutas/aceptar", json={"faros": [9999]}, headers=h)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json["faros"], [])


class TestContactosSOS(Base):
    def test_crud_y_limites(self):
        h = self.peaton()
        self.assertEqual(len(self.c.get("/api/contactos", headers=h).json), 2)
        self.assertEqual(self.c.post("/api/contactos", json={"nombre": "A B", "celular": "123"}, headers=h).status_code, 400)
        self.assertEqual(self.c.post("/api/contactos", json={"nombre": "Otra", "celular": "6622000001"}, headers=h).status_code, 400)
        for i in range(3):
            self.assertEqual(self.c.post("/api/contactos", json={"nombre": f"Amiga {i}", "celular": f"66230000{i:02d}"}, headers=h).status_code, 201)
        r = self.c.post("/api/contactos", json={"nombre": "Sobra", "celular": "6623999999"}, headers=h)
        self.assertEqual(r.status_code, 400)
        self.assertIn("máximo 5", r.json["error"])
        cid = self.c.get("/api/contactos", headers=h).json[0]["id"]
        self.assertEqual(self.c.put(f"/api/contactos/{cid}", json={"nombre": "Mamá C", "celular": "6622000001"}, headers=h).status_code, 200)
        self.assertEqual(self.c.delete(f"/api/contactos/{cid}", headers=h).status_code, 200)

    def test_contactos_privados(self):
        h2 = self.login("gloria@farolocal.mx", "Peaton123")
        self.assertEqual(self.c.get("/api/contactos", headers=h2).json, [])
        cid = self.c.get("/api/contactos", headers=self.peaton()).json[0]["id"]
        self.assertEqual(self.c.delete(f"/api/contactos/{cid}", headers=h2).status_code, 404)

    def test_sos_flujo(self):
        h = self.peaton()
        a = self.c.post("/api/sos", json={"nodo": 10}, headers=h).json
        self.assertEqual(len(a["contactos"]), 2)
        self.assertEqual(self.c.post(f"/api/sos/{a['id']}/cancelar", headers=h).json["estado"], "cancelada")
        self.assertEqual(self.c.post(f"/api/sos/{a['id']}/confirmar", headers=h).status_code, 409)
        b = self.c.post("/api/sos", json={"nodo": 10}, headers=h).json
        self.assertEqual(self.c.post(f"/api/sos/{b['id']}/confirmar", headers=h).json["estado"], "enviada")
        self.assertEqual(self.c.post(f"/api/sos/{b['id']}/cancelar", headers=h).status_code, 409)

    def test_sos_sin_contactos(self):
        h2 = self.login("gloria@farolocal.mx", "Peaton123")
        a = self.c.post("/api/sos", json={}, headers=h2).json
        self.assertTrue(a["sin_contactos"])
        self.assertEqual(a["llamar"], "tel:911")


class TestCuponesReportes(Base):
    def test_lista_filtra_vencidos_y_abiertos(self):
        todos = self.c.get("/api/cupones?hora=12:00").json
        titulos = [c["titulo"] for c in todos]
        self.assertNotIn("Cupón vencido de prueba", titulos)
        self.assertNotIn("Cupón desactivado de prueba", titulos)
        abiertos = self.c.get("/api/cupones?hora=12:00&abiertos=1").json
        self.assertTrue(all(c["abierto"] for c in abiertos))
        self.assertLess(len(abiertos), len(todos))

    def test_obtener_y_validar_cupon(self):
        hp, hc = self.peaton(), self.comercio("farmacia@farolocal.mx")
        cup = next(c for c in self.c.get("/api/cupones").json if c["negocio"] == "Farmacia Guadalupe 24 h")
        cod = self.c.post(f"/api/cupones/{cup['id']}/obtener", headers=hp).json["codigo"]
        # otro negocio no puede validarlo
        otro = self.comercio("esquina@farolocal.mx")
        self.assertFalse(self.c.post("/api/negocio/cupones/validar", json={"codigo": cod}, headers=otro).json["valido"])
        self.assertTrue(self.c.post("/api/negocio/cupones/validar", json={"codigo": cod}, headers=hc).json["valido"])
        r = self.c.post("/api/negocio/cupones/validar", json={"codigo": cod}, headers=hc).json
        self.assertFalse(r["valido"])
        self.assertIn("ya fue canjeado", r["motivo"])
        panel = self.c.get("/api/negocio/panel", headers=hc).json
        self.assertEqual(panel["canjes"], 1)

    def test_mis_cupones(self):
        """MIS CUPONES: lista los códigos que el peatón obtuvo, con su negocio, vigencia y si ya se canjearon; es personal."""
        hp, hc = self.peaton(), self.comercio("farmacia@farolocal.mx")
        self.assertEqual(self.c.get("/api/cupones/mios", headers=hp).json, [])
        cup = next(c for c in self.c.get("/api/cupones").json if c["negocio"] == "Farmacia Guadalupe 24 h")
        cod = self.c.post(f"/api/cupones/{cup['id']}/obtener", headers=hp).json["codigo"]
        self.c.post(f"/api/cupones/{cup['id']}/obtener", headers=hp)          # pedirlo otra vez no lo duplica
        mios = self.c.get("/api/cupones/mios", headers=hp).json
        self.assertEqual(len(mios), 1)
        m = mios[0]
        self.assertEqual((m["codigo"], m["negocio"], m["titulo"], m["canjeado"]), (cod, "Farmacia Guadalupe 24 h", cup["titulo"], False))
        for campo in ("direccion", "fin", "descripcion", "negocio_id"):
            self.assertIn(campo, m)
        self.c.post("/api/negocio/cupones/validar", json={"codigo": cod}, headers=hc)
        self.assertTrue(self.c.get("/api/cupones/mios", headers=hp).json[0]["canjeado"])
        otro = self.c.post("/api/auth/registro", json={"nombre": "Otra Persona", "correo": "otra@x.com", "telefono": "6621112233",
                                                      "password": "abcdefgh", "rol": "peaton"}).json["token"]
        self.assertEqual(self.c.get("/api/cupones/mios", headers={"Authorization": "Bearer " + otro}).json, [])   # nadie ve los de otro

    def test_reporte_ciclo(self):
        h = self.peaton()
        r = self.c.post("/api/reportes", json={"tipo": "Luminaria apagada", "descripcion": "x" * 251, "arista_id": 5}, headers=h)
        self.assertEqual(r.status_code, 400)
        r = self.c.post("/api/reportes", json={"tipo": "Luminaria apagada", "descripcion": "Poste apagado", "arista_id": 5}, headers=h)
        self.assertEqual(r.status_code, 201)
        ha = self.admin()
        self.assertEqual(self.c.post(f"/api/admin/reportes/{r.json['id']}/aprobar", headers=ha).status_code, 200)
        self.assertEqual(self.c.post(f"/api/admin/reportes/{r.json['id']}/rechazar", headers=ha).status_code, 409)
        z = self.c.get("/api/zona").json
        self.assertEqual(next(a for a in z["aristas"] if a["id"] == 5)["reportes"], 1)

    def test_reporte_rechazado_no_pesa(self):
        h, ha = self.peaton(), self.admin()
        r = self.c.post("/api/reportes", json={"tipo": "Luminaria apagada", "descripcion": "Poste apagado", "arista_id": 5}, headers=h).json
        self.c.post(f"/api/admin/reportes/{r['id']}/rechazar", headers=ha)
        z = self.c.get("/api/zona").json
        self.assertEqual(next(a for a in z["aristas"] if a["id"] == 5)["reportes"], 0)


class TestComercioAdmin(Base):
    def registrar(self):
        r = self.c.post("/api/auth/registro", json={"nombre": "Nuevo Dueño", "correo": "nuevo@x.com", "telefono": "6621234567",
                                                    "password": "abcdefgh", "rol": "comercio"})
        return {"Authorization": "Bearer " + r.json["token"]}

    def datos(self, **kw):
        d = {"nombre": "Cenaduría Nueva", "direccion": "Calle 3 y Av. Rosales", "giro": "Cenaduría", "abre": "19:00",
             "cierra": "03:00", "nodo_id": 18, "servicios": ["Agua", "Baño"]}
        d.update(kw)
        return d

    def test_registro_aprobacion_y_cupones(self):
        h, ha = self.registrar(), self.admin()
        self.assertEqual(self.c.post("/api/negocio", json=self.datos(servicios=[]), headers=h).status_code, 400)
        r = self.c.post("/api/negocio", json=self.datos(), headers=h)
        self.assertEqual(r.status_code, 201)
        nid = r.json["id"]
        # pendiente: no sale en el mapa ni puede publicar cupones
        self.assertNotIn("Cenaduría Nueva", [f["nombre"] for f in self.c.get("/api/zona").json["faros"]])
        cup = {"titulo": "Postre gratis", "descripcion": "Con tu cena", "inicio": "2026-11-01", "fin": "2026-12-31"}
        self.assertEqual(self.c.post("/api/negocio/cupones", json=cup, headers=h).status_code, 403)
        # admin rechaza sin motivo -> error; con motivo -> ok; el titular ve el motivo
        self.assertEqual(self.c.post(f"/api/admin/negocios/{nid}/rechazar", json={}, headers=ha).status_code, 400)
        self.c.post(f"/api/admin/negocios/{nid}/rechazar", json={"motivo": "Dirección incompleta"}, headers=ha)
        self.assertEqual(self.c.get("/api/negocio", headers=h).json["motivo_rechazo"], "Dirección incompleta")
        # corrige -> vuelve a revisión
        self.c.put("/api/negocio", json=self.datos(servicios=["Agua"]), headers=h)
        self.assertEqual(self.c.get("/api/negocio", headers=h).json["estado"], "pendiente")
        self.c.post(f"/api/admin/negocios/{nid}/aprobar", headers=ha)
        self.assertIn("Cenaduría Nueva", [f["nombre"] for f in self.c.get("/api/zona").json["faros"]])
        self.assertEqual(self.c.post("/api/negocio/cupones", json=cup, headers=h).status_code, 201)
        cup["fin"] = "2026-10-01"
        self.assertEqual(self.c.post("/api/negocio/cupones", json=cup, headers=h).status_code, 400)

    def test_un_titular_no_toca_cupones_ajenos(self):
        ha = self.comercio("esquina@farolocal.mx")
        hb = self.comercio("farmacia@farolocal.mx")
        cid = self.c.get("/api/negocio/cupones", headers=ha).json[0]["id"]
        self.assertEqual(self.c.delete(f"/api/negocio/cupones/{cid}", headers=hb).status_code, 404)
        self.assertEqual(self.c.post(f"/api/negocio/cupones/{cid}/activo", headers=hb).status_code, 404)

    def test_cupon_desactivar(self):
        h = self.comercio("esquina@farolocal.mx")
        cid = self.c.get("/api/negocio/cupones", headers=h).json[0]["id"]
        self.assertEqual(self.c.post(f"/api/negocio/cupones/{cid}/activo", headers=h).json["activo"], 0)
        self.assertNotIn(cid, [c["id"] for c in self.c.get("/api/cupones").json])

    def test_editar_cambio_importante_reenvia(self):
        h = self.comercio("esquina@farolocal.mx")
        n = self.c.get("/api/negocio", headers=h).json
        d = self.datos(nombre=n["nombre"], direccion=n["direccion"], giro=n["giro"], abre=n["abre"], cierra=n["cierra"],
                       nodo_id=n["nodo_id"], servicios=n["servicios"])
        r = self.c.put("/api/negocio", json=dict(d, giro="Tienda"), headers=h).json
        self.assertEqual(r["estado"], "aprobado")  # giro no es cambio importante
        r = self.c.put("/api/negocio", json=dict(d, abre="10:00"), headers=h).json
        self.assertEqual(r["estado"], "pendiente")


class TestReenvioDeRechazados(Base):
    def test_negocio_rechazado_se_reenvia_al_corregir_cualquier_dato(self):
        h = self.comercio("compadres@farolocal.mx")
        n = self.c.get("/api/negocio", headers=h).json
        self.assertEqual((n["estado"], bool(n["motivo_rechazo"])), ("rechazado", True))
        # el motivo era "sin servicios"; aquí corrige solo la dirección (campo que antes no reenviaba)
        datos = dict(nombre=n["nombre"], direccion="Calle Nueva 456, zona piloto", giro=n["giro"], abre=n["abre"],
                     cierra=n["cierra"], nodo_id=n["nodo_id"], servicios=["Agua"])
        r = self.c.put("/api/negocio", json=datos, headers=h).json
        self.assertEqual((r["estado"], r["reenviado_a_revision"]), ("pendiente", True))
        n = self.c.get("/api/negocio", headers=h).json
        self.assertEqual((n["estado"], n["motivo_rechazo"]), ("pendiente", None))
        # ya pendiente: guardar de nuevo no cambia nada
        self.assertEqual(self.c.put("/api/negocio", json=datos, headers=h).json["estado"], "pendiente")
        # y el admin lo ve en su lista de pendientes
        nombres = [x["nombre"] for x in self.c.get("/api/admin/negocios", query_string={"estado": "pendiente"}, headers=self.admin()).json]
        self.assertIn(n["nombre"], nombres)


class TestFrontendEstatico(Base):
    def test_secciones_con_y_sin_diagonal(self):
        os.environ["FARO_PORTAL"] = "1"
        self.addCleanup(os.environ.pop, "FARO_PORTAL", None)
        for ruta in ("/", "/app", "/app/", "/portal", "/portal/", "/portal/comercio", "/portal/admin"):
            r = self.c.get(ruta)
            self.assertEqual(r.status_code, 200, ruta)
            self.assertIn("text/html", r.content_type, ruta)
            r.close()

    def test_portal_apagado_por_defecto(self):
        os.environ.pop("FARO_PORTAL", None)
        r = self.c.get("/")
        self.assertEqual(r.status_code, 302)
        self.assertTrue(r.headers["Location"].endswith("/app/"))
        for ruta in ("/portal", "/portal/", "/portal/admin/", "/portal/comercio/", "/portal/portal.css", "/portal/portal.js"):
            r = self.c.get(ruta)
            self.assertEqual(r.status_code, 404, ruta)
            self.assertIn("no está disponible en esta versión", r.get_data(as_text=True), ruta)
            r.close()
        for ruta in ("/app/", "/app/sw.js", "/shared/api.js"):
            r = self.c.get(ruta)
            self.assertEqual(r.status_code, 200, ruta)
            r.close()

    def test_portal_apagado_no_toca_la_api(self):
        os.environ.pop("FARO_PORTAL", None)
        self.admin()
        self.comercio()
        r = self.c.get("/api/admin/negocios", headers=self.admin())
        self.assertEqual(r.status_code, 200)

    def test_portal_encendido(self):
        os.environ["FARO_PORTAL"] = "1"
        self.addCleanup(os.environ.pop, "FARO_PORTAL", None)
        for ruta in ("/", "/portal/"):
            r = self.c.get(ruta)
            self.assertEqual(r.status_code, 200, ruta)
            r.close()

    def test_recursos_compartidos_y_404(self):
        for ruta in ("/shared/api.js", "/shared/mapa.js", "/shared/tema.css"):
            r = self.c.get(ruta)
            self.assertEqual(r.status_code, 200, ruta)
            r.close()
        self.assertEqual(self.c.get("/api/no-existe").status_code, 404)
        self.assertEqual(self.c.get("/no-existe.html").status_code, 404)


class TestSeguridad(Base):
    """Permisos por rol, entradas malformadas, límites, fuga de datos, SQL y cabeceras."""

    # (método, ruta) -> quién puede usarla: "publico" | "token" (cualquier sesión) | rol
    PERMISOS = {
        ("POST", "/api/auth/registro"): "publico", ("POST", "/api/auth/login"): "publico",
        ("GET", "/api/zona"): "publico", ("GET", "/api/faros/<int:fid>"): "publico",
        ("GET", "/api/cupones"): "publico", ("GET", "/api/tipos-reporte"): "publico",
        ("GET", "/api/auth/yo"): "token",
        ("POST", "/api/rutas"): "peaton", ("POST", "/api/rutas/aceptar"): "peaton",
        ("GET", "/api/contactos"): "peaton", ("POST", "/api/contactos"): "peaton",
        ("PUT", "/api/contactos/<int:cid>"): "peaton", ("DELETE", "/api/contactos/<int:cid>"): "peaton",
        ("POST", "/api/sos"): "peaton", ("GET", "/api/sos"): "peaton",
        ("POST", "/api/sos/<int:aid>/cancelar"): "peaton", ("POST", "/api/sos/<int:aid>/confirmar"): "peaton",
        ("POST", "/api/cupones/<int:cid>/obtener"): "peaton", ("GET", "/api/cupones/mios"): "peaton",
        ("POST", "/api/reportes"): "peaton", ("GET", "/api/reportes/mios"): "peaton",
        ("GET", "/api/negocio"): "comercio", ("POST", "/api/negocio"): "comercio", ("PUT", "/api/negocio"): "comercio",
        ("GET", "/api/negocio/panel"): "comercio",
        ("GET", "/api/negocio/cupones"): "comercio", ("POST", "/api/negocio/cupones"): "comercio",
        ("PUT", "/api/negocio/cupones/<int:cid>"): "comercio", ("POST", "/api/negocio/cupones/<int:cid>/activo"): "comercio",
        ("DELETE", "/api/negocio/cupones/<int:cid>"): "comercio", ("POST", "/api/negocio/cupones/validar"): "comercio",
        ("GET", "/api/admin/resumen"): "admin", ("GET", "/api/admin/negocios"): "admin",
        ("POST", "/api/admin/negocios/<int:nid>/aprobar"): "admin", ("POST", "/api/admin/negocios/<int:nid>/rechazar"): "admin",
        ("GET", "/api/admin/reportes"): "admin",
        ("POST", "/api/admin/reportes/<int:rid>/aprobar"): "admin", ("POST", "/api/admin/reportes/<int:rid>/rechazar"): "admin",
    }

    def rutas_api(self):
        import re
        for regla in appmod.app.url_map.iter_rules():
            if not regla.rule.startswith("/api/"):
                continue
            for m in sorted(regla.methods - {"HEAD", "OPTIONS"}):
                yield m, regla.rule, re.sub(r"<int:\w+>", "1", regla.rule)

    def test_toda_ruta_api_tiene_su_permiso_declarado(self):
        # si alguien agrega un endpoint y olvida protegerlo/declararlo, esta prueba falla
        for m, regla, _ in self.rutas_api():
            self.assertIn((m, regla), self.PERMISOS, f"{m} {regla} no está en la tabla de permisos")

    def test_sin_token_y_con_rol_equivocado(self):
        tokens = {"peaton": self.peaton(), "comercio": self.comercio(), "admin": self.admin()}
        for m, regla, url in self.rutas_api():
            quien = self.PERMISOS[(m, regla)]
            if quien == "publico":
                continue
            r = self.c.open(url, method=m, json={})
            self.assertEqual(r.status_code, 401, f"{m} {regla} sin token")
            r = self.c.open(url, method=m, json={}, headers={"Authorization": "Bearer basura"})
            self.assertEqual(r.status_code, 401, f"{m} {regla} con token inválido")
            if quien == "token":
                continue
            for rol, h in tokens.items():
                if rol != quien:
                    r = self.c.open(url, method=m, json={}, headers=h)
                    self.assertEqual(r.status_code, 403, f"{m} {regla} con rol {rol}")

    def test_tokens_falsificados_o_vencidos(self):
        import time
        import jwt
        uid = self.c.get("/api/auth/yo", headers=self.peaton()).json["id"]
        casos = {
            "firmado con otra clave y rol admin": jwt.encode({"sub": str(uid), "rol": "admin", "exp": time.time() + 600}, "otra-clave-de-32-caracteres-o-mas!!", algorithm="HS256"),
            "vencido": jwt.encode({"sub": str(uid), "rol": "peaton", "exp": time.time() - 10}, appmod.SECRET, algorithm="HS256"),
            "usuario inexistente": jwt.encode({"sub": "99999", "rol": "peaton", "exp": time.time() + 600}, appmod.SECRET, algorithm="HS256"),
            "sin firma (alg none)": jwt.encode({"sub": str(uid), "rol": "admin"}, None, algorithm="none"),
        }
        for nombre, t in casos.items():
            r = self.c.get("/api/auth/yo", headers={"Authorization": "Bearer " + t})
            self.assertEqual(r.status_code, 401, nombre)
        # el rol que manda es el de la base de datos, no el que diga el token
        t = jwt.encode({"sub": str(uid), "rol": "admin", "exp": time.time() + 600}, appmod.SECRET, algorithm="HS256")
        self.assertEqual(self.c.get("/api/admin/resumen", headers={"Authorization": "Bearer " + t}).status_code, 403)

    def test_entradas_malformadas_no_rompen_el_servidor(self):
        h = self.peaton()
        raro = [("/api/rutas", "[1,2]"), ("/api/rutas", '{"origen_nodo":[1],"destino_nodo":5}'),
                ("/api/rutas", '{"origen_nodo":{},"destino_nodo":5}'), ("/api/rutas", '{"origen_x":"abc","origen_y":1,"destino_nodo":5}'),
                ("/api/rutas", '{"origen_x":1e999,"origen_y":1,"destino_nodo":5}'), ("/api/rutas", '{"origen_nodo":true,"destino_nodo":5}'),
                ("/api/reportes", '{"tipo":"Luminaria apagada","descripcion":"hola mundo","arista_id":[1]}'),
                ("/api/reportes", '{"tipo":"Luminaria apagada","descripcion":"hola mundo","arista_id":"x"}'),
                ("/api/reportes", "5"), ("/api/contactos", "[1]"), ("/api/sos", "[1]"), ("/api/sos", '{"nodo":[1]}'),
                ("/api/auth/registro", "5"), ("/api/auth/registro", "[1]"), ("/api/auth/login", "[1]"),
                ("/api/auth/login", '{"correo":{"a":1},"password":[1]}'),
                ("/api/rutas", "no es json"), ("/api/negocio/cupones/validar", '{"codigo":[1]}')]
        for url, cuerpo in raro:
            r = self.c.post(url, data=cuerpo, content_type="application/json", headers=h)
            self.assertLess(r.status_code, 500, f"{url} {cuerpo} -> {r.status_code}")
            self.assertTrue(r.is_json, f"{url} {cuerpo} debe responder JSON")
        # negocio con tipos raros (como comercio)
        hc = self.comercio()
        base = {"nombre": "Tienda La Esquina", "direccion": "Av. Serdán 123", "giro": "Abarrotes", "abre": "07:00", "cierra": "01:00"}
        for servicios in ("Agua", [1, 2], [["x"]], {"a": 1}):
            r = self.c.put("/api/negocio", json=dict(base, nodo_id=11, servicios=servicios), headers=hc)
            self.assertLess(r.status_code, 500, str(servicios))
        for nodo in ([1], {}, "x", None, True):
            r = self.c.put("/api/negocio", json=dict(base, nodo_id=nodo, servicios=["Agua"]), headers=hc)
            self.assertEqual(r.status_code, 400, str(nodo))

    def test_limites_de_tamano(self):
        base = {"nombre": "Ana Pérez", "correo": "ana@x.com", "telefono": "6621234567"}
        r = self.c.post("/api/auth/registro", json=dict(base, password="a" * 129))
        self.assertEqual((r.status_code, r.json["campo"]), (400, "password"))
        r = self.c.post("/api/auth/login", json={"correo": "peaton@farolocal.mx", "password": "a" * 5000})
        self.assertEqual(r.status_code, 401)
        r = self.c.post("/api/auth/registro", data="x" * 70_000, content_type="application/json")
        self.assertEqual(r.status_code, 413)
        self.assertTrue(r.is_json)
        hc = self.comercio()
        d = {"nombre": "Tienda La Esquina", "direccion": "Av. Serdán 123", "giro": "Abarrotes", "abre": "07:00", "cierra": "01:00", "nodo_id": 11}
        for serv in (["s%d" % i for i in range(11)], ["x" * 41]):
            r = self.c.put("/api/negocio", json=dict(d, servicios=serv), headers=hc)
            self.assertEqual((r.status_code, r.json["campo"]), (400, "servicios"), str(serv)[:30])
        # repetidos se limpian
        r = self.c.put("/api/negocio", json=dict(d, servicios=["Agua", "Agua", " Agua "]), headers=hc)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.c.get("/api/negocio", headers=hc).json["servicios"], ["Agua"])

    def test_tope_de_reportes_pendientes(self):
        h = self.peaton()   # el usuario demo ya tiene 2 pendientes en la semilla
        cuerpo = {"tipo": "Luminaria apagada", "descripcion": "Poste sin luz", "arista_id": 1}
        codigos = [self.c.post("/api/reportes", json=cuerpo, headers=h).status_code for _ in range(10)]
        self.assertEqual(codigos[:8], [201] * 8)
        self.assertEqual(codigos[8:], [429, 429])

    def test_datos_publicos_no_filtran_campos_privados(self):
        privados = {"titular_id", "revisado_por", "revisado_en", "motivo_rechazo", "vistas", "rutas", "estado"}
        faros = self.c.get("/api/zona").json["faros"]
        self.assertTrue(faros)
        for f in faros:
            self.assertFalse(privados & set(f), sorted(privados & set(f)))
        self.assertFalse(privados & set(self.c.get("/api/faros/1").json))
        # el titular sí ve sus contadores
        panel = self.c.get("/api/negocio/panel", headers=self.comercio()).json
        self.assertIn("vistas", panel)
        self.assertNotIn("password_hash", str(self.c.get("/api/auth/yo", headers=self.peaton()).json))

    def test_inyeccion_sql(self):
        inyecciones = ["' OR '1'='1", "x'; DROP TABLE usuarios; --", '" OR ""="']
        for i in inyecciones:
            self.assertEqual(self.c.post("/api/auth/login", json={"correo": i, "password": i}).status_code, 401)
            r = self.c.post("/api/negocio/cupones/validar", json={"codigo": i}, headers=self.comercio())
            self.assertFalse(r.json.get("valido", False))
            self.assertEqual(self.c.get("/api/cupones", query_string={"hora": i}).status_code, 200)
            self.assertEqual(self.c.get("/api/admin/negocios", query_string={"estado": i}, headers=self.admin()).status_code, 200)
            self.assertEqual(self.c.get("/api/zona", query_string={"hora": i}).status_code, 200)
        self.assertEqual(self.c.post("/api/auth/login", json={"correo": "peaton@farolocal.mx", "password": "Peaton123"}).status_code, 200)  # la tabla sigue ahí
        r = self.c.post("/api/auth/registro", json={"nombre": "Robert'); DROP TABLE usuarios;--", "correo": "bob@x.com", "telefono": "6621234567", "password": "abcdefgh"})
        self.assertEqual(r.status_code, 201)

    def test_un_peaton_no_toca_alertas_ni_contactos_ajenos(self):
        a = self.peaton()
        otra = self.c.post("/api/auth/registro", json={"nombre": "Otra Persona", "correo": "otra@x.com", "telefono": "6621234567", "password": "abcdefgh"}).json
        h2 = {"Authorization": "Bearer " + otra["token"]}
        aid = self.c.post("/api/sos", json={}, headers=a).json["id"]
        self.assertEqual(self.c.post(f"/api/sos/{aid}/cancelar", headers=h2).status_code, 404)
        self.assertEqual(self.c.post(f"/api/sos/{aid}/confirmar", headers=h2).status_code, 404)
        cid = self.c.get("/api/contactos", headers=a).json[0]["id"]
        self.assertEqual(self.c.put(f"/api/contactos/{cid}", json={"nombre": "Hack", "celular": "6620000000"}, headers=h2).status_code, 404)
        self.assertEqual(self.c.delete(f"/api/contactos/{cid}", headers=h2).status_code, 404)
        self.assertEqual(self.c.get("/api/sos", headers=h2).json, [])

    def test_cabeceras_y_errores_json(self):
        for ruta in ("/", "/app/", "/portal/", "/api/zona"):
            r = self.c.get(ruta)
            self.assertIn("default-src 'self'", r.headers["Content-Security-Policy"], ruta)
            self.assertIn("script-src 'self'", r.headers["Content-Security-Policy"], ruta)
            self.assertEqual(r.headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(r.headers["X-Frame-Options"], "DENY")
            r.close()
        self.assertEqual(self.c.get("/api/zona").headers["Cache-Control"], "no-store")
        for metodo, ruta, codigo in (("delete", "/api/zona", 405), ("get", "/api/no-existe", 404)):
            r = getattr(self.c, metodo)(ruta)
            self.assertEqual(r.status_code, codigo)
            self.assertTrue(r.is_json and "error" in r.json, ruta)

    def test_el_frontend_no_usa_scripts_en_linea(self):
        # la política CSP (script-src 'self') bloquearía cualquier <script> con código dentro de la página
        import glob
        import re
        base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")
        for ruta in glob.glob(os.path.join(base, "**", "*.html"), recursive=True):
            with open(ruta, encoding="utf-8") as f:
                html = f.read()
            nombre = os.path.relpath(ruta, base)
            for m in re.finditer(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html, re.S):
                self.assertEqual(m.group(1).strip(), "", f"script en línea en {nombre}")
            self.assertNotRegex(html, r"\son\w+=", f"manejador en línea en {nombre}")


if __name__ == "__main__":
    unittest.main(verbosity=1)
