import {
  AlertTriangle,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  LogOut,
  Moon,
  ScanLine,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { cn } from "../lib/cn";
import { useAuth } from "../lib/auth-context";
import { faviconForTheme, useTheme } from "../lib/theme";

const NAV_ITEMS: { to: string; label: string; end: boolean; icon: LucideIcon }[] = [
  { to: "/", label: "Dashboard", end: true, icon: LayoutDashboard },
  { to: "/remitos", label: "Remitos", end: false, icon: FileText },
  { to: "/escanear", label: "Escanear", end: false, icon: ScanLine },
  { to: "/revision", label: "Revisión", end: false, icon: ClipboardCheck },
  { to: "/errores", label: "Errores", end: false, icon: AlertTriangle },
];

export function AppLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();

  async function handleSignOut() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen bg-canvas pb-20 sm:pb-0">
      {/* Sidebar: solo desktop/tablet (>= sm). En mobile la navegación vive en
          la barra inferior fija (ver más abajo) y en el header compacto. */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-border bg-surface sm:flex">
        <div className="px-5 py-5">
          <div className="flex items-center gap-2">
            <img src={faviconForTheme(theme)} alt="" className="h-6 w-6 shrink-0" />
            <h1 className="text-lg font-semibold text-ink">OCR</h1>
          </div>
          <p className="text-xs text-ink-muted">Digitalización, OCR y revisión</p>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                  isActive
                    ? "bg-primary text-white"
                    : "text-ink-muted hover:bg-surface-raised hover:text-ink"
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-3 border-t border-border px-3 py-4">
          {user && (
            <div className="flex items-center gap-2 px-1">
              {user.avatar_url && (
                <img
                  src={user.avatar_url}
                  alt=""
                  className="h-8 w-8 shrink-0 rounded-full border border-border"
                />
              )}
              <span className="min-w-0 truncate text-sm text-ink-muted">
                {user.name ?? user.email}
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              className="rounded-lg border border-border bg-surface p-2 text-ink-muted transition hover:bg-surface-raised hover:text-ink"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-ink transition hover:bg-surface-raised"
            >
              <LogOut className="h-4 w-4" />
              Salir
            </button>
          </div>
        </div>
      </aside>

      {/* Header compacto: solo mobile, reemplaza al sidebar (que ahí queda
          oculto) y a la barra inferior le sobra este lugar para el logout. */}
      <header className="border-b border-border bg-surface sm:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <img src={faviconForTheme(theme)} alt="" className="h-6 w-6 shrink-0" />
              <h1 className="text-lg font-semibold text-ink">OCR</h1>
            </div>
            <p className="text-xs text-ink-muted">Digitalización, OCR y revisión</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              className="rounded-lg border border-border bg-surface p-2 text-ink-muted transition hover:bg-surface-raised hover:text-ink"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            {user?.avatar_url && (
              <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-full border border-border" />
            )}
            <button
              type="button"
              onClick={() => void handleSignOut()}
              aria-label="Salir"
              className="rounded-lg border border-border bg-surface p-2 text-ink-muted transition hover:bg-surface-raised hover:text-ink"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="sm:pl-64">
        {/* Sin `max-w`: el contenido ocupa todo el ancho disponible, el
            padding es solo para no pegar el texto contra el borde. */}
        <div className="space-y-6 px-4 py-6 sm:px-6">
          <Outlet />
        </div>
      </main>

      {/* Barra inferior estilo app mobile: fija, con ícono + label chico.
          `env(safe-area-inset-bottom)` para no quedar tapada por la barra de
          gestos en iOS/Android. Solo mobile -- desktop usa el sidebar. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-surface sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition",
                isActive ? "text-primary" : "text-ink-muted"
              )
            }
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
