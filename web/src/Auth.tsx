import { type FormEvent, useState } from "react";
import { api, type AuthUser } from "./api";

export function AuthScreen({ onAuthed }: { onAuthed: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const user =
        mode === "register"
          ? await api.register({ email, password, name })
          : await api.login({ email, password });
      onAuthed(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand">
          <span className="mark">Hb</span>
          <div>
            <strong>Honebi Capture</strong>
            <p>{mode === "register" ? "Create an account to start capturing." : "Sign in to continue."}</p>
          </div>
        </div>
        <form onSubmit={onSubmit}>
          {mode === "register" ? (
            <label>
              Name
              <input
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Optional"
              />
            </label>
          ) : null}
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              required
              minLength={mode === "register" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}
          </button>
        </form>
        <p className="auth-switch">
          {mode === "register" ? "Already have an account?" : "New here?"}{" "}
          <button
            type="button"
            className="text"
            onClick={() => {
              setError(null);
              setMode(mode === "register" ? "login" : "register");
            }}
          >
            {mode === "register" ? "Sign in" : "Create an account"}
          </button>
        </p>
      </div>
    </div>
  );
}

export function AuthBoot() {
  return (
    <div className="auth">
      <p className="muted">Loading…</p>
    </div>
  );
}
