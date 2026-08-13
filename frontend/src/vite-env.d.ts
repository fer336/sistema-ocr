/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Client ID de la app OAuth de Google (público, se embebe en el bundle). */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Base de la API. Por defecto `/api/v1` (nginx proxea a `backend:8000`). */
  readonly VITE_API_URL?: string;
}
