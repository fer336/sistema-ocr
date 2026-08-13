import { useState } from "react";
import { GoogleLogin, type CredentialResponse } from "@react-oauth/google";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { loginWithGoogle } from "../lib/auth";
import { useAuth } from "../lib/auth-context";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

export function Login() {
  const { status, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/";

  if (status === "authenticated") {
    return <Navigate to={redirectTo} replace />;
  }

  async function handleSuccess(credentialResponse: CredentialResponse) {
    const idToken = credentialResponse.credential;
    if (!idToken) {
      setError("Google no devolvió un ID token.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // El backend responde con una cookie httpOnly: el JWT nunca se guarda
      // en localStorage.
      const user = await loginWithGoogle(idToken);
      setUser(user);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Casa Santini</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Ingresá con tu cuenta de Google para continuar.
        </p>

        <div className="mt-6 flex justify-center">
          {GOOGLE_CLIENT_ID ? (
            <GoogleLogin
              onSuccess={(credentialResponse) => void handleSuccess(credentialResponse)}
              onError={() => setError("No se pudo completar el login con Google.")}
              text="signin_with"
              shape="rectangular"
            />
          ) : (
            <p className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
              Falta configurar <code>VITE_GOOGLE_CLIENT_ID</code> en el entorno del frontend.
            </p>
          )}
        </div>

        {busy && <p className="mt-4 text-sm text-ink-muted">Iniciando sesión...</p>}

        {error && (
          <p className="mt-4 rounded-lg border border-error/30 bg-error-soft px-4 py-3 text-sm text-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
