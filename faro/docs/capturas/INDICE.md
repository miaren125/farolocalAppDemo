# Capturas reales del software

Generadas automáticamente con Playwright (`tools/recorrido_capturas.py`) el 18/11/2026 10:17 contra la aplicación en ejecución y datos de demostración. No son mockups.

| Archivo | Qué muestra | Requisito |
|---|---|---|
| `00-selector-acceso.png` | Selector de acceso: peatón o comercio/administración | RF01 |
| `peaton-01-login-validacion.png` | Inicio de sesión con validación en la interfaz | RF01 |
| `peaton-02-registro-validacion.png` | Registro de peatón con error de contraseña corta | RF01 |
| `peaton-03-mapa-faros-2330.png` | Mapa de Puntos Faro con hora simulada 23:30 | RF02 |
| `peaton-04-mapa-faros-0300.png` | Mismo mapa a las 03:00: cambian los Faros abiertos | RF02 |
| `peaton-05-ficha-faro.png` | Ficha del Punto Faro: estado, horario, servicios y cupones | RF03 |
| `peaton-06-ruta-faro-2-toques.png` | Ruta Faro calculada con 2 toques (Faro → Ruta hasta aquí) | RF04 |
| `peaton-07-ruta-faro-datos.png` | Ruta Faro con distancia, minutos, Faros abiertos y cuánto se alarga | RF04 |
| `peaton-08-ruta-alternativa.png` | Ruta alternativa dibujada en el mapa | RF05 |
| `peaton-09-cupones.png` | Cupones vigentes | RF08 |
| `peaton-10-cupon-codigo-qr.png` | Código personal del cupón con su QR | RF08 |
| `peaton-11-contactos.png` | Contactos de confianza (máximo 5) y bandeja de alertas | RF06 |
| `peaton-12-contacto-validacion.png` | Formulario de contacto con validación del celular | RF06 |
| `peaton-13-reportar-tramo.png` | Reportar una zona: tramo elegido en el mapa | RF09 |
| `peaton-14-reporte-enviado.png` | Reporte enviado: aparece en 'Mis reportes' como Pendiente | RF09 |
| `peaton-15-sos-manteniendo.png` | SOS: anillo de progreso mientras se mantiene presionado (2 s) | RF07 |
| `peaton-16-sos-cuenta-regresiva.png` | SOS: cuenta regresiva de 10 s con 'Cancelar alerta' y enlace al 911 | RF07 |
| `peaton-17-sos-enviado.png` | SOS: aviso simulado enviado a los contactos | RF07 |
| `peaton-18-sos-cancelado.png` | SOS cancelado durante la cuenta regresiva | RF07 |
| `peaton-19-bandeja-alertas.png` | Bandeja de alertas: una enviada (simulada) y una cancelada | RF07 |
| `peaton-20-sin-conexion.png` | App abierta sin conexión (PWA) con el último mapa guardado | RNF offline/PWA |
| `comercio-01-acceso-portal.png` | Acceso al portal de comercio y administración | RF01 |
| `comercio-02-registrar-negocio-validacion.png` | Registro de negocio: validación de campos obligatorios | RF10 |
| `comercio-03-registrar-negocio-mapa.png` | Registro de negocio con la ubicación elegida en el mapa | RF10 |
| `comercio-04-negocio-pendiente.png` | Panel de un negocio recién registrado (Pendiente de revisión) | RF10, RF11 |
| `comercio-05-panel-contadores.png` | Panel del comercio con contadores | RF11 |
| `comercio-06-editar-negocio.png` | Edición del negocio con ubicación en el mapa | RF10 |
| `comercio-07-cupones.png` | Gestión de cupones | RF12 |
| `comercio-08-cupon-nuevo.png` | Formulario de nuevo cupón | RF12 |
| `comercio-09-validar-cupon-valido.png` | Validación de un cupón válido (queda canjeado) | RF13 |
| `comercio-10-validar-cupon-repetido.png` | Intento de canjear de nuevo el mismo cupón | RF13 |
| `comercio-11-negocio-rechazado.png` | Negocio rechazado: el titular ve el motivo | RF10, RF14 |
| `admin-01-resumen.png` | Resumen de administración | RF14, RF15 |
| `admin-02-negocios-pendientes.png` | Validar negocios: lista de pendientes con detalle y mapa | RF14 |
| `admin-03-rechazo-sin-motivo.png` | Rechazo de negocio: el motivo es obligatorio | RF14 |
| `admin-04-aprobar-confirmacion.png` | Confirmación para aprobar un negocio | RF14 |
| `admin-05-negocios-rechazados.png` | Negocios rechazados con su motivo | RF14 |
| `admin-06-reportes-mapa.png` | Moderar reportes: el tramo reportado se resalta en el mapa | RF15 |
| `admin-07-reporte-aprobado.png` | Reporte aprobado: el tramo queda marcado con '!' y penaliza las rutas | RF15 |

## App del peatón — diseño del Figma "FaroLocal interfaz" (`tools/capturas_figma.py`)
Capturas a 390×844 con deviceScaleFactor 2 (táctil), numeradas en el orden del recorrido. Las del rediseño anterior están en `anteriores/`.
`comparacion/` trae cada pantalla de Figma (izquierda) junto a la app (derecha), generadas con `tools/comparar_figma.py`.

| Archivo | Pantalla | Figma | RF |
|---|---|---|---|
| `01-splash.png` | Splash con el logo (1,5 s) | 1:7 | — |
| `02-login.png` | Inicio de sesión | 14:34 | RF01 |
| `03-login-error.png` | Datos inválidos | 27:31 | RF01 |
| `04-registro.png`, `05-registro-validacion.png` | Registro y errores por campo | 27:62 | RF01 |
| `06-inicio.png`, `10-mapa.png` | Inicio con el mapa | 14:52 | RF02 |
| `07-acceso-rapido.png` | Acceso rápido | 27:112 | — |
| `11-buscador-sugerencias.png` | Buscador con sugerencias | 37:442 | RF04 |
| `12-vista-previa.png`, `13-vista-previa-otra-ruta.png` | Vista previa de la Ruta Faro y alternativa | 54:1580 | RF04, RF05 |
| `14-navegacion.png`, `15-navegacion-avance.png` | Navegación simulada | 54:1700 | RF04 |
| `16-ficha-faro.png` | Ficha del Punto Faro | — | RF03 |
| `20-cupones-vacio.png`, `30-cupones.png`, `31-cupon-detalle.png` | Mis cupones, detalle con código y QR | 27:331, 40:941 | RF08 |
| `21-contactos-vacio.png`, `24-contactos.png`, `25-contactos-maximo.png`, `26-contactos-eliminar.png`, `27-contactos-confirmar-borrado.png` | Mis contactos | 27:200, 54:1204 | RF06 |
| `22-sos-cuenta-sin-contactos.png`, `23-sos-cancelado.png`, `28-sos-cuenta.png`, `29-sos-alerta-enviada.png` | SOS: cuenta regresiva, cancelación y alerta enviada | 27:94 | RF07 |
| `32-reportar.png` a `37-reportar-enviado.png` | Reportar zona: formulario, motivo, ubicar el negocio y confirmación | 27:351, 40:666, 40:735 | RF09 |
| `38-perfil-bandeja.png` | Perfil con bandeja de alertas SOS | — | RF07 |
| `40-escritorio-marco-inicio.png`, `41-escritorio-marco-acceso-rapido.png` | Pantalla ancha (1440×900): marco de celular | — | — |
