import { useEffect, useState, type ReactNode } from "react";
import { setUnauthorizedHandler } from "../lib/api";
import { getCurrentUser, logout as logoutRequest } from "../lib/auth";
import { AuthContext, type AuthContextValue, type AuthStatus } from "../lib/auth-context";
import type { User } from "../types";

/**
 * Resuelve la sesión una sola vez en el arranque (`GET /api/v1/auth/me`) y la
 * comparte con toda la app. El JWT vive en una cookie httpOnly: acá solo
 * guardamos el usuario, nunca el token.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  async function loadUser() {
    try {
      const current = await getCurrentUser();
      setUser(current);
      setStatus("authenticated");
    } catch {
      // 401 (o backend caído) = no hay sesión utilizable.
      setUser(null);
      setStatus("anonymous");
    }
  }

  useEffect(() => {
    // Un 401 en cualquier endpoint protegido tira la sesión: `RequireAuth`
    // manda a /login sin recargar la app.
    setUnauthorizedHandler(() => {
      setUser(null);
      setStatus("anonymous");
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    void loadUser();
  }, []);

  async function signOut() {
    try {
      await logoutRequest();
    } finally {
      setUser(null);
      setStatus("anonymous");
    }
  }

  const value: AuthContextValue = {
    user,
    status,
    setUser: (next) => {
      setUser(next);
      setStatus("authenticated");
    },
    refresh: loadUser,
    signOut,
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}
