# Verificación contra los requisitos (RF y RNF)

Fecha: 18 nov 2026. Cada fila cita evidencia que se puede repetir:
- **Prueba** = prueba automática en `backend/test_api.py` (`cd backend && python3 test_api.py`; 39 pruebas).
- **Captura** = imagen real de `docs/capturas/` (se regenera con `tools/recorrido_capturas.py`, que además falla si la app lanza errores de JavaScript o la política de seguridad bloquea algo).
- **Auditoría** = `tools/auditoria_accesibilidad.py` (axe-core + medición de tiempos y de objetivos táctiles).

## Requisitos funcionales

| RF | Requisito | ¿Funciona? | Evidencia |
|---|---|---|---|
| RF01 | Registro / login | **Sí** | Pruebas `test_registro_validaciones`, `test_no_se_puede_registrar_admin`, `test_login_y_roles`. Capturas `00-selector-acceso`, `peaton-01-login-validacion`, `peaton-02-registro-validacion`, `comercio-01-acceso-portal`. |
| RF02 | Mapa de Faros (hora simulada) | **Sí** | Pruebas `test_zona_y_horas`, `test_cruce_de_medianoche`. Capturas `peaton-03-mapa-faros-2330` (5 abiertos) y `peaton-04-mapa-faros-0300` (3 abiertos). |
| RF03 | Ficha del Faro | **Sí** | Prueba `test_ficha_cuenta_vistas_y_oculta_no_aprobados` (un negocio no aprobado devuelve 404). Captura `peaton-05-ficha-faro`. |
| RF04 | Ruta Faro (distancia, minutos, Faros abiertos, cuánto se alarga) | **Sí** | Pruebas `test_ruta_basica`, `test_ruta_evita_oscuridad`, `test_hora_cambia_resultado`, `test_reportes_aprobados_penalizan`, `test_fuera_de_zona_y_mismo_punto`. Capturas `peaton-06-ruta-faro-2-toques`, `peaton-07-ruta-faro-datos`. |
| RF05 | Ruta alternativa | **Sí** (solo cuando existe un camino distinto; si no, la app lo dice) | Prueba `test_alternativa_y_contador`. Captura `peaton-08-ruta-alternativa`. |
| RF06 | Contactos (máx. 5) | **Sí** | Pruebas `test_crud_y_limites`, `test_contactos_privados`. Capturas `peaton-11-contactos`, `peaton-12-contacto-validacion`. |
| RF07 | SOS: mantener 2 s → cuenta regresiva 10 s → cancelar → bandeja → `tel:911` | **Sí**, con el aviso **simulado** y la limitación de que la cuenta corre en el navegador | Pruebas `test_sos_flujo`, `test_sos_sin_contactos`, `test_un_peaton_no_toca_alertas_ni_contactos_ajenos`. Capturas `peaton-15` a `peaton-19`. |
| RF08 | Cupones y código personal | **Sí** (con QR; el QR se decodificó con jsQR, no con un celular real) | Prueba `test_obtener_y_validar_cupon`, `test_lista_filtra_vencidos_y_abiertos`. Capturas `peaton-09-cupones`, `peaton-10-cupon-codigo-qr`. |
| RF09 | Reportar zona eligiendo un tramo | **Sí** | Prueba `test_reporte_ciclo`, `test_tope_de_reportes_pendientes`. Capturas `peaton-13-reportar-tramo`, `peaton-14-reporte-enviado`. |
| RF10 | Registrar negocio (ubicación en el mapa) | **Sí** | Pruebas `test_registro_aprobacion_y_cupones`, `test_editar_cambio_importante_reenvia`, `test_negocio_rechazado_se_reenvia_al_corregir_cualquier_dato`. Capturas `comercio-02`, `comercio-03`, `comercio-04`, `comercio-06`, `comercio-11`. |
| RF11 | Panel del comercio (contadores) | **Sí** | Pruebas `test_ficha_cuenta_vistas_y_oculta_no_aprobados` (vistas), `test_alternativa_y_contador` (rutas). Captura `comercio-05-panel-contadores`. |
| RF12 | Gestionar cupones | **Sí** | Pruebas `test_registro_aprobacion_y_cupones`, `test_cupon_desactivar`, `test_un_titular_no_toca_cupones_ajenos`. Capturas `comercio-07-cupones`, `comercio-08-cupon-nuevo`. |
| RF13 | Validar cupón (una sola vez) | **Sí** | Prueba `test_obtener_y_validar_cupon`. Capturas `comercio-09-validar-cupon-valido`, `comercio-10-validar-cupon-repetido`. |
| RF14 | Validar negocios (admin, con motivo de rechazo) | **Sí** | Prueba `test_registro_aprobacion_y_cupones`. Capturas `admin-02` a `admin-05`, `comercio-11-negocio-rechazado` (el titular ve el motivo). |
| RF15 | Moderar reportes con mapa | **Sí** | Pruebas `test_reporte_ciclo`, `test_reporte_rechazado_no_pesa`. Capturas `admin-06-reportes-mapa`, `admin-07-reporte-aprobado`. |

## Requisitos no funcionales

| RNF | ¿Se cumple? | Evidencia y matices |
|---|---|---|
| Seguridad por rol | **Sí** | `TestSeguridad`: una tabla declara quién puede usar cada endpoint y la prueba falla si aparece un endpoint nuevo sin declarar; sin token → 401, token inválido → 401, rol equivocado → 403 en **todas** las rutas protegidas; tokens falsificados, vencidos, con `alg: none` o de un usuario inexistente → 401; el rol sale de la base de datos, no del token; un usuario no toca alertas, contactos ni cupones ajenos. |
| Privacidad de ubicación | **Sí** | El frontend no usa geolocalización; la posición del peatón es simulada y vive solo en memoria. `/api/rutas` no guarda origen ni destino (solo suma el contador del negocio). Solo se guarda un punto en dos casos: la ubicación del negocio y la del peatón **en el momento de un SOS**. `localStorage` guarda únicamente el token y qué cupones pidió el usuario. La cabecera `Permissions-Policy` desactiva geolocalización, cámara y micrófono. |
| Validación en servidor | **Sí** | Pruebas de validación por endpoint, `test_entradas_malformadas_no_rompen_el_servidor` (18 cuerpos raros → siempre 4xx con JSON, nunca 500) y `test_limites_de_tamano`. La interfaz valida lo mismo para dar mensajes claros. |
| Respuesta < 3 s | **Sí en red local** | Auditoría: carga de `/app/` 0.2–0.6 s; iniciar sesión → mapa con Faros 1.5 s; Faro → ruta en pantalla 0.3 s; `POST /api/rutas` ≈ 60 ms; login ≈ 0.4 s (por el hash de la contraseña). **No se midió con red móvil real.** |
| 3 toques máximo | **Parcial** | Ruta: **2 toques** (Faro → “Ruta Faro hasta aquí”); SOS: **1 gesto** (mantener 2 s); ficha: 1; obtener cupón: 2; validar cupón: pestaña + escribir + botón. **Reportar una zona necesita 5 toques más texto** y agregar un contacto 3 más texto: no cumplen si el límite se aplica a todo; sí se cumple para ruta y SOS, que son los que pide el plan. |
| Contraste AA | **Sí (verificado con herramienta)** | axe-core (WCAG 2.1 A/AA, incluye contraste) sin violaciones en **19 de 19 pantallas** (app: acceso, registro, mapa, ficha, ruta, cupones, QR, contactos, formulario, reportar, SOS; portal: acceso, 4 vistas de comercio, 3 de admin). No cubre el texto dibujado dentro del SVG del mapa ni sustituye una revisión manual ni un lector de pantalla. Los estados llevan texto además de color. |
| Offline para la demo | **Sí** | Prueba con Playwright: tras abrir la app una vez, sin conexión abre con la sesión, muestra el último mapa y la hora simulada sigue funcionando (captura `peaton-20-sin-conexion`). No se carga ningún recurso externo: con la política CSP `default-src 'self'` el recorrido completo no produjo bloqueos. **Limitación:** el service worker solo corre en `localhost` o HTTPS. |
| PWA / navegadores | **Parcial** | Manifest, íconos y service worker válidos; la app abre sin conexión. **Probado solo en Microsoft Edge (Chromium) de escritorio.** No se probó en Chrome/Android, Safari/iPhone ni Firefox; no se comprobó la instalación en un celular. |
| Código por capas | **Parcial** | Backend: `db.py` (datos y semilla), `graph.py` (algoritmo de la Ruta Faro) y `app.py`, que **mezcla rutas, validación y SQL** (sin capa de servicios separada). Frontend: `shared/` (api, mapa, auth, tema) y un módulo por pantalla. |

## Revisión de seguridad del backend

**Qué se encontró y se corrigió** (todo con prueba en `TestSeguridad` o `TestReenvioDeRechazados`):

| # | Problema | Gravedad | Corrección |
|---|---|---|---|
| 1 | Cuerpos JSON con tipos inesperados (lista, número, `origen_nodo: []`, `arista_id: []`…) provocaban **error 500** en `/api/rutas`, `/api/reportes` y `/api/auth/registro` | Media (rompe el servicio, ensucia los registros) | `cuerpo()` solo acepta objetos; conversores `entero()` y `numero()` rechazan listas, diccionarios, booleanos, `NaN` e infinitos con error 400 y `campo`. |
| 2 | Los endpoints **públicos** `/api/zona` y `/api/faros/<id>` devolvían campos internos: `titular_id`, `revisado_por`, `motivo_rechazo` y los **contadores privados** `vistas` y `rutas` (RF11) | Media (fuga de datos) | `negocio_publico()` con lista blanca de campos. |
| 3 | Sin límites de tamaño: se aceptó una contraseña de **2 MB** (costo de CPU en el hash) y listas de miles de servicios | Media (abuso de recursos) | Cuerpo máx. 64 KB (413), contraseña máx. 128, servicios máx. 10 de 40 caracteres, sin repetidos. |
| 4 | `nodo_id: true` se aceptaba como el nodo 1 | Baja | Conversor estricto. |
| 5 | Sin cabeceras de seguridad | Media | CSP (`script-src 'self'`, sin `eval`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, y `Cache-Control: no-store` en la API. El único script en línea (`index.html`) pasó a `frontend/index.js`; una prueba impide que vuelva a aparecer uno. |
| 6 | Errores 404/405/500 de la API salían como HTML; un 500 podía mostrar detalles | Baja | Respuestas JSON en español, sin traza. |
| 7 | Cualquier peatón podía enviar reportes sin límite | Baja | Máximo 10 reportes pendientes por usuario (429). |
| 8 | Un negocio **rechazado** no podía reenviarse si solo corregía la dirección | Funcional | Al guardar, un negocio rechazado vuelve a “Pendiente” y se borra el motivo. |
| 9 | La clave de tokens de demostración se usaba sin avisar | Baja | Aviso al arrancar si no se define `FARO_SECRET`. |

**Revisado y sin problemas** (con pruebas): consultas SQL parametrizadas (la tabla con nombre interpolado en `_revisar` solo recibe constantes internas); inyección SQL en login, cupones, filtros y registro; permisos por rol en todas las rutas; acceso a recursos ajenos (IDOR) en contactos, alertas y cupones; JWT con algoritmo fijo, vencimiento y rol tomado de la base de datos; sin CSRF (autenticación por cabecera `Authorization`, no por cookies); sin recorrido de rutas al servir archivos estáticos; el frontend inserta texto con `textContent`, no HTML.

**Riesgos que siguen abiertos** (también en `docs/PENDIENTES.md`):
- **Sin límite de intentos**: fuerza bruta en el login y en los códigos de cupón (6 caracteres hexadecimales, 16.7 millones de combinaciones).
- El token (12 h) vive en `localStorage` y no se puede revocar al cerrar sesión; la clave por defecto es de demostración.
- `style-src` conserva `'unsafe-inline'` (hay estilos en línea); sin HTTPS no hay protección de tráfico.
- El registro revela si un correo ya existe (409).
- Un negocio aprobado puede cambiar **giro y dirección** sin volver a revisión (hoy solo nombre, ubicación, horario y servicios la disparan); `GET /api/faros/<id>` suma una vista por cada visita, así que un bot puede inflar el contador.
- Un negocio no aprobado todavía puede editar cupones que ya tenía; el SOS se confirma desde el cliente.
- Flask en modo de desarrollo y SQLite: suficiente para la demo.
