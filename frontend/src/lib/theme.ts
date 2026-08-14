import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "sanitini.theme";

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Lee el `data-theme` que `index.html` ya aplicó antes del primer paint. */
function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return systemPrefersDark() ? "dark" : "light";
}

/**
 * Un logo por tema: `favicon.svg` para oscuro, `favicon2.svg` para claro.
 * Mismo criterio en el ícono de pestaña del navegador y en el logo del
 * sidebar/header (`AppLayout`) -- ver `FAVICON_BY_THEME`.
 */
const FAVICON_BY_THEME: Record<Theme, string> = {
  dark: "/favicon.svg",
  light: "/favicon2.svg",
};

/** Expuesto para que otros componentes (el logo del sidebar) usen el mismo
 * mapeo sin duplicarlo. */
export function faviconForTheme(theme: Theme): string {
  return FAVICON_BY_THEME[theme];
}

function syncFaviconLink(theme: Theme): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (link) link.href = FAVICON_BY_THEME[theme];
}

/**
 * Tema con override manual. Sin elección guardada sigue al sistema operativo
 * (el CSS ya lo resuelve solo); al tocar el switch se fija un valor
 * explícito que persiste en `localStorage` y gana sobre el sistema, hasta
 * que el usuario lo vuelva a cambiar.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    syncFaviconLink(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // localStorage lleno o deshabilitado: el tema sigue andando en esta
      // sesión, solo no persiste entre visitas.
    }
  }, [theme]);

  function toggle() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  return [theme, toggle];
}
