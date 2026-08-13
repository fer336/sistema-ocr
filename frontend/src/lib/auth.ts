import { apiRequest } from "./api";
import type { User } from "../types";

/**
 * El backend responde `{user: {...}}` en `POST /auth/google`. Para `/auth/me`
 * aceptamos tanto el usuario plano como el envuelto, así el frontend no se
 * rompe por esa diferencia de forma.
 */
function unwrapUser(payload: User | { user: User }): User {
  if (payload && typeof payload === "object" && "user" in payload) {
    return payload.user;
  }
  return payload;
}

/**
 * Intercambia el ID token de Google por la sesión propia. La respuesta setea
 * una cookie httpOnly: el JWT nunca toca `localStorage` (protección XSS).
 */
export async function loginWithGoogle(idToken: string): Promise<User> {
  const payload = await apiRequest<User | { user: User }>("/auth/google", {
    method: "POST",
    body: JSON.stringify({ id_token: idToken }),
  });
  return unwrapUser(payload);
}

export async function getCurrentUser(): Promise<User> {
  const payload = await apiRequest<User | { user: User }>("/auth/me");
  return unwrapUser(payload);
}

export async function logout(): Promise<void> {
  await apiRequest<unknown>("/auth/logout", { method: "POST" });
}
