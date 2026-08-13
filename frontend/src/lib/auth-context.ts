import { createContext, useContext } from "react";
import type { User } from "../types";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

export interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  /** Lo llama la pantalla de login después de canjear el ID token de Google. */
  setUser: (user: User) => void;
  /** Revalida la sesión contra `GET /api/v1/auth/me`. */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth debe usarse dentro de <AuthProvider>.");
  }
  return context;
}
