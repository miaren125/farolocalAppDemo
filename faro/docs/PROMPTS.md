# Prompts para Claude Code (en orden)

Abre la carpeta `faro/` en Claude Code (`cd faro && claude`). Pega cada prompt cuando termine el anterior. Revisa con `git diff` y haz commit entre fases.

## Fase 0 — Verificar
Lee CLAUDE.md. Corre `cd backend && python3 db.py && python3 test_api.py` y dime si todo pasa. Haz `git init` y un primer commit. No cambies código todavía.

## Fase 1 — Base del frontend (cuando decidas: hoy 17–18 nov)
Crea `frontend/` sin build. Estructura: `index.html` (selector que redirige a /app o /portal según login), `app/` (PWA del peatón), `portal/` (comercio y admin), `shared/` con `api.js` (fetch con token, manejo de 401 y errores `{error, campo}`), `tema.css` (colores y tipografías de la identidad visual) y `mapa.js` (renderiza el grafo de `GET /api/zona` en SVG: calles con color según luz, Faros con icono y estado abierto/cerrado, selección de punto, dibujo de rutas). Incluye login y registro (RF01) funcionando contra la API real.

## Fase 2 — App del peatón (19–22 nov)
Implementa en `/app`: mapa de Puntos Faro con control de hora simulada (RF02), ficha del Faro (RF03), solicitar Ruta Faro con origen/destino y datos (distancia, minutos, Faros abiertos, cuánto se alarga) (RF04), ruta alternativa (RF05), contactos (RF06), SOS con mantener 2 s + cuenta regresiva 10 s + cancelar + bandeja (RF07), cupones y código personal (RF08), reportar zona eligiendo un tramo (RF09). Diseño oscuro, botones ≥44 px, máximo 3 toques para ruta y SOS. Sigue los mockups de Figma de la página "Peaton - App" si puedes leerlos.

## Fase 3 — Portales (23–24 nov)
Implementa `/portal/comercio` (registrar y editar negocio con ubicación en el mapa, panel con contadores, cupones, validar cupón: RF10–RF13) y `/portal/admin` (validar negocios con motivo de rechazo, moderar reportes con mapa: RF14–RF15). Respeta los mockups de la página "Comercio - Web" y "Administrador - Web" de Figma.

## Fase 4 — Pulido y entrega (25–26 nov)
1) QR de cupones: escribe un generador de QR pequeño en JS puro (o usa una librería local en `frontend/vendor/`) y verifica que un lector real lo escanee; si no es posible, muestra solo el código y avísame. 2) PWA: manifest, íconos y service worker que deje abrir la app sin conexión. 3) Escribe `README.md` con instalación en un paso (`python3 backend/db.py && python3 backend/app.py`). 4) Crea `entregar.sh` que genere `FaroLocal.zip` sin `__pycache__` ni `.git`. 5) Haz un recorrido completo de cada rol con Playwright y guarda capturas reales en `docs/capturas/` (las usaremos en el IEEE 830). 6) Lista en `docs/PENDIENTES.md` lo que no quedó, honestamente.

## Fase 5 — Revisión (26–28 nov)
Compara el software contra los 15 RF y 9 RNF de CLAUDE.md. Dame una tabla RF | ¿funciona? | evidencia (pantalla o prueba). Corrige lo que falle. Revisa el backend en busca de problemas de seguridad (permisos por rol, validaciones, SQL).

## Agentes en paralelo (opcional, fases 2 y 3)
Las fases 2 y 3 no se estorban: en Claude Code pide "usa un subagente para /app y otro para /portal; ambos usan shared/ pero solo yo (tú, el agente principal) edito shared/". Si abres dos sesiones, usa `git worktree` para que no pisen los mismos archivos.
