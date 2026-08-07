# Frontend — React

Frontend de búsqueda y revisión de remitos. Ver `../PROPUESTA_MVP_OCR_REMITOS.md` §13 para el detalle funcional.

## Stack

React 19 + TypeScript + Vite + Tailwind CSS 4.

## Desarrollo

```bash
npm install
npm run dev
```

El proxy de `/api` en `vite.config.ts` apunta al backend (`91.99.162.240:8000` mientras no esté en Portainer). Cambiar el `target` ahí si el backend corre en otro lado durante el desarrollo local.

## Estructura

- `src/types.ts` — tipos que reflejan los schemas de FastAPI.
- `src/lib/api.ts` — cliente HTTP para `/api/*`.
- `src/components/` — tabla, buscador, stats, detalle con edición/aprobación/reproceso.
