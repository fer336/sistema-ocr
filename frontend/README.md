# Frontend — React

Frontend de búsqueda, carga y revisión de remitos. Ver `../PRD.md` §18 para el detalle
funcional de cada pantalla.

## Stack

React 19 + TypeScript + Vite + Tailwind CSS 4 + react-router-dom.

## Desarrollo

```bash
npm install
cp .env.example .env   # completar VITE_GOOGLE_CLIENT_ID
npm run dev
```

El proxy de `/api` en `vite.config.ts` apunta a `http://127.0.0.1:8000` -- el backend
corriendo nativo en venv (ver `../backend/README.md`), no un contenedor. Cambiar el
`target` ahí si el backend corre en otro lado durante el desarrollo local.

## Estructura

- `src/types.ts` — tipos que reflejan los schemas de FastAPI.
- `src/lib/api.ts` — cliente HTTP para `/api/*`.
- `src/components/` — tabla, buscador, stats, detalle con edición/aprobación/reproceso.
