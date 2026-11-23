# Pendientes y límites conocidos

Lista honesta de lo que **no quedó**, quedó **a medias** o **no se pudo comprobar**. Fecha de corte: 18 nov 2026.
Lo que sí se probó está en `backend/test_api.py` (39 pruebas), en `docs/capturas/` (recorrido de los 3 roles con Playwright; cada captura sale de la app real) y en `docs/VERIFICACION_RF_RNF.md` (tabla de los 15 RF y 9 RNF + revisión de seguridad).

## 1. Cosas que no se pudieron verificar
- **Mockups de Figma.** Nunca pude leer los archivos “Peaton - App”, “Comercio - Web” y “Administrador - Web” (no se dio el enlace del archivo). Todas las pantallas se diseñaron siguiendo la identidad visual de CLAUDE.md, **no** los mockups. Hay que compararlas a mano.
- **QR de cupones.** Se genera con la librería local `frontend/vendor/qrcode.js` (qrcode-generator 1.4.4, MIT). Se decodificó correctamente con otro decodificador independiente (jsQR): 5 de 5 códigos, a 140, 220 y 400 px. **No se escaneó con la cámara de un celular real**; falta probarlo (y con brillo bajo). El portal de comercio **no escanea**: el comercio escribe el código.
- **Celular real.** Todo se probó en Microsoft Edge (Chromium) de escritorio, con pantalla de 390 px para la app. No se probó en Android, iPhone, Safari ni Firefox. Los toques, el mantener 2 s del SOS y la vibración solo se simularon con el ratón.
- **Accesibilidad.** axe-core no encontró violaciones WCAG A/AA (incluido contraste) en 19 pantallas, y los objetivos táctiles de la app miden ≥ 44 px. **Falta** lo que una herramienta no ve: lector de pantalla (TalkBack/VoiceOver), recorrido solo con teclado, y el texto dibujado dentro del SVG del mapa.
- **Rendimiento (< 3 s).** Medido solo en red local (carga 0.2–0.6 s, login → mapa 1.5 s, ruta 0.3 s). No se midió con red móvil real.

## 2. Limitaciones de la PWA
- El service worker **solo funciona en `localhost` o HTTPS**. Si la demo abre la app en el celular por `http://192.168.x.x:5000`, **no se podrá instalar ni abrir sin conexión**. Para eso hace falta HTTPS (por ejemplo un túnel) o abrir la app en la misma computadora.
- Sin conexión solo abre el cascarón y el **último mapa descargado** (hay que abrir la app con internet al menos una vez). Rutas, fichas, cupones, contactos, reportes y SOS necesitan conexión: se decidió no guardar datos personales en caché.

## 3. Funciones con límites
- **SOS simulado.** No envía mensajes reales ni llama a emergencias (solo el enlace `tel:911`). La cuenta regresiva corre en el navegador: **si se cierra la app o se pierde la conexión antes de llegar a 0, el aviso no se confirma** y la alerta queda “Sin confirmar”.
- **Ubicación simulada.** No hay GPS: el peatón elige su posición tocando el mapa y solo vive en memoria. La zona piloto es una cuadrícula ficticia de 8 × 6 cruces.
- **Mapa.** Zoom con botones + / − (sin pellizcar). En celular las etiquetas se leen mal sin acercar (los Faros sí tienen zona de toque de ≥ 44 px).
- **3 toques.** Se cumple para la ruta (2) y el SOS (1 gesto); reportar una zona necesita 5 toques más texto.
- **Cupones.** El backend no tiene “mis cupones”: la app recuerda en el navegador qué cupones pidió y vuelve a pedir el código. Si el comercio ya lo canjeó, el servidor genera uno **nuevo**.
- **Hora simulada.** Es global para la pantalla; el formato de 12/24 horas depende del idioma del navegador.
- **Portal.** Diseñado para escritorio (≥ 1280 px); en pantallas chicas solo se acomoda de forma básica.

## 4. Huecos del backend (no se tocaron)
La revisión de seguridad ya se hizo (ver `docs/VERIFICACION_RF_RNF.md`: 9 problemas corregidos, con pruebas). **Siguen abiertos:**
- **Sin límite de intentos** en el login ni en la validación de códigos de cupón (fuerza bruta); sin recuperar contraseña ni verificar correo/teléfono; el registro revela si un correo ya existe.
- El token JWT (12 h) vive en `localStorage` y no se puede revocar al salir; la clave por defecto (`FARO_SECRET`) es de demostración; sin HTTPS no hay protección del tráfico.
- La política CSP conserva `style-src 'unsafe-inline'`.
- Un negocio aprobado puede cambiar **giro y dirección** sin volver a revisión (solo nombre, ubicación, horario y servicios la disparan). Decisión de reglas pendiente del equipo.
- `GET /api/faros/<id>` suma una vista por cada visita (un bot inflaría el contador); el SOS se confirma desde el cliente.
- Flask en modo de desarrollo y SQLite de un solo archivo: suficiente para la demo, no para producción.

## 5. Recortado a propósito (fuera de alcance)
Compartir ruta, suspender usuarios y estadísticas avanzadas.

## 6. Entrega y documentación
- **Los documentos IEEE 830 no están escritos.** Las capturas de `docs/capturas/` (índice en `INDICE.md`) son material para ellos; deben coincidir con lo que realmente hace el software.
- La tabla RF/RNF está en `docs/VERIFICACION_RF_RNF.md`; las filas **parciales** son: 3 toques (reportar zona), PWA/navegadores (solo Edge), código por capas (`app.py` mezcla rutas, validación y SQL).
- `entregar.sh` genera `FaroLocal.zip` **sin la base de datos** (se crea con `python3 backend/db.py`; `app.py` también la crea si falta). Se comprobó que el ZIP arranca desde una carpeta limpia, pero requiere `pip install -r backend/requirements.txt` (Flask y PyJWT).
- El recorrido con Playwright (`tools/recorrido_capturas.py`) requiere `pip install playwright` y Microsoft Edge instalado; no es parte de la app ni de `requirements.txt`.
- No hay pruebas automáticas del frontend más allá de ese recorrido y de `tools/auditoria_accesibilidad.py` (axe-core, tiempos, objetivos táctiles; requieren `pip install playwright` y descargar `axe.min.js`). Se detienen si algo falla, pero no son un conjunto de regresión.

## 7. Deuda técnica menor
- `frontend/app/nucleo.js` y `frontend/portal/ui.js` repiten utilidades (`h()`, avisos, diálogos); conviene unirlas en `shared/`.
- El botón SOS vive en la 6.ª columna de la barra inferior y sobresale unos píxeles sobre el contenido.
- Los íconos PNG se generan con `tools/generar_iconos.py` a partir de `frontend/assets/linterna.png`.
