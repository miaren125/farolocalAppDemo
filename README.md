# FaroLocal

App para peatones y portal web para comercios y administración. Los negocios nocturnos abiertos se registran como **Puntos Faro**; la app calcula la **Ruta Faro**, que prioriza la iluminación y los Faros abiertos sobre la distancia.

Proyecto escolar — Universidad de Sonora (Ingeniería de Software I + Concurso de Innovación Tecnológica).

## Requisitos
- Python 3.10 o superior.
- Flask y PyJWT (se instalan una sola vez): `pip install -r backend/requirements.txt`
- Un navegador moderno. **El frontend no necesita instalar nada** (HTML/CSS/JS sin build, fuentes y librería de QR incluidas en `frontend/vendor/`).

## Instalación y arranque en un paso
```
python3 backend/db.py && python3 backend/app.py
```
(En Windows usa `python` en lugar de `python3`.) Abre <http://localhost:5000>. `db.py` crea y siembra `backend/faro.db` con la zona piloto y datos de demostración; **vuelve a ejecutarlo para reiniciar los datos de la demo**.

| Dirección | Qué es |
|---|---|
| `/` | Selector: entra directo a tu sección si ya iniciaste sesión |
| `/app/` | App del peatón (PWA, pensada para celular) |
| `/portal/` | Acceso al portal; `/portal/comercio/` y `/portal/admin/` según el rol |

## Cuentas de demostración
| Rol | Correo | Contraseña |
|---|---|---|
| Peatón | peaton@farolocal.mx | Peaton123 |
| Administración | admin@farolocal.mx | Admin123! |
| Comercio (aprobado) | esquina@farolocal.mx | Comercio123 |
| Comercio (aprobado) | farmacia@farolocal.mx | Comercio123 |
| Comercio (pendiente) | tere@farolocal.mx | Comercio123 |
| Comercio (rechazado) | compadres@farolocal.mx | Comercio123 |

Cualquiera puede crear una cuenta de peatón (en `/app/`) o de comercio (en `/portal/`); las de administración solo existen en la semilla.

## Demostración rápida
1. En `/app/`, entra como peatón. Cambia la **hora simulada** (arriba) para ver qué Faros están abiertos a las 03:00 o a las 23:30.
2. Toca un Punto Faro → ficha → **Ruta Faro hasta aquí** (2 toques). Prueba la pestaña **Alternativa**.
3. **Cupones** → Obtener: se muestra el código `FARO-XXXXXX` y su QR.
4. En `/portal/`, entra como `esquina@farolocal.mx` → **Validar cupón** y escribe ese código.
5. Entra como administración → **Negocios** (aprobar o rechazar con motivo) y **Reportes** (moderar con el mapa).
6. **SOS**: mantén el botón rojo 2 segundos → cuenta regresiva de 10 s → cancelar o dejar que termine. El aviso a contactos es **simulado** (no se envían mensajes ni se llama a emergencias).

## Abrir la app en tu celular (misma red Wi-Fi)
El servidor ya escucha en `0.0.0.0`, así que cualquier dispositivo de la misma red puede entrar.
1. Arranca el servidor en la compu (`python app.py` dentro de `backend/`).
2. Busca la IP de la compu: en Windows `ipconfig` (línea «Dirección IPv4», p. ej. `192.168.1.74`); en Mac/Linux `ifconfig` o `ip a`.
3. En el celular (conectado al mismo Wi-Fi) abre `http://192.168.1.74:5000/app/` (cambia por tu IP). Si no carga, permite Python en el Firewall de Windows (red privada).
4. Menú del navegador → **«Agregar a pantalla de inicio»** (Safari en iPhone: Compartir → «Agregar a inicio»). Se abre a pantalla completa, sin barra del navegador.

Aclaraciones honestas:
- En la misma red **no hace falta HTTPS** para usar la app. Solo lo piden la geolocalización del navegador, el service worker (modo sin conexión) y, en Android/Chrome, la instalación como app «de verdad». Con `http://IP` Chrome crea un acceso directo que puede mostrar la barra del navegador; iPhone sí abre en pantalla completa. Para la instalación completa en Android usa HTTPS (por ejemplo un túnel como `cloudflared` o `ngrok`, o abre desde `localhost` en la compu).
- La app **no usa GPS**: si el navegador bloquea la ubicación no pasa nada; tu posición se elige tocando un cruce en el mapa («Estoy aquí»).
- En una pantalla ancha (≥ 600 px) la app se muestra dentro de un marco de celular de 390×844; en el celular ocupa toda la pantalla.

## Pruebas
```
cd backend && python3 test_api.py     # 39 pruebas de la API (incluye seguridad); debe terminar en OK
```

## Estructura
```
backend/    Flask + SQLite (app.py, db.py, graph.py = Dijkstra de la Ruta Faro, test_api.py)
frontend/   shared/ (api.js, mapa.js, auth.js, tema.css) · app/ (PWA del peatón) · portal/ · vendor/
docs/       VERIFICACION_RF_RNF.md (RF/RNF + seguridad), PENDIENTES.md, capturas/ (generadas con Playwright), PROMPTS.md
tools/      generar_iconos.py · capturas_movil.py · auditoria_movil.py · recorrido_capturas.py · auditoria_accesibilidad.py (necesitan Playwright)
frontend/assets/   logo-farolocal.png · linterna.png · icono-192/512.png
entregar.sh genera FaroLocal.zip (sin .git, __pycache__ ni bases de datos)
```

## PWA y modo sin conexión
La app (`/app/`) se puede instalar desde el navegador (“Instalar app” / “Agregar a pantalla de inicio”). Tras abrirla una vez con internet, **abre sin conexión** y muestra el último mapa guardado, con la hora simulada funcionando. Rutas, cupones, contactos y SOS siguen necesitando conexión (no se guardan datos personales en caché). El service worker solo se activa en `localhost` o HTTPS.

## Notas de diseño
- El mapa es un SVG propio dibujado desde `GET /api/zona` (sin mapas externos): la zona piloto es una cuadrícula ficticia de 8×6 cruces; no hay GPS.
- La posición del peatón es simulada y solo vive en memoria; no se guarda ubicación.
- La variable `FARO_SECRET` define la clave de los tokens (hay un valor de demostración; cámbialo fuera de la demo).
- Librería de terceros incluida: `qrcode-generator` 1.4.4 (MIT) en `frontend/vendor/qrcode.js`.

Lo que no está terminado o está limitado se lista con honestidad en [`docs/PENDIENTES.md`](docs/PENDIENTES.md).
