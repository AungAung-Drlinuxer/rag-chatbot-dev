/**
 * Login page harness — renders the REAL Login screen with a stubbed /api/branding
 * response, so the responsive layout can be photographed at several viewports without
 * signing in. `?logo=1` serves an uploaded-logo state, `?logo=0` the gradient fallback,
 * and `?theme=dark` forces the dark palette.
 */
import "./styles.css";

import { createRoot } from "react-dom/client";
import { useState } from "react";
import Login from "@/features/auth/pages/LoginPage";

const params = new URLSearchParams(location.search);
const WITH_LOGO = params.get("logo") !== "0";
document.documentElement.setAttribute("data-theme", params.get("theme") === "dark" ? "dark" : "light");

/* A tiny inline SVG "company logo" — proves the uploaded-logo path renders without
   shipping a binary asset into the repo for a screenshot. */
const LOGO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C3AED"/><stop offset="1" stop-color="#4C1D95"/></linearGradient></defs><rect width="64" height="64" rx="16" fill="url(#g)"/><path d="M20 44V20h8l8 12 8-12h8v24h-7V32l-9 12-9-12v12z" fill="#fff"/></svg>`,
  );

window.fetch = (async (input: any) => {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  if (/\/api\/branding/.test(url)) {
    return new Response(
      JSON.stringify({ logo: WITH_LOGO ? LOGO : null, appName: "DrLinuxer IT Help" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  return new Response(JSON.stringify({ ok: true, status: "ok" }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}) as typeof window.fetch;

function Harness() {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  return (
    <Login
      loginUser={user}
      setLoginUser={setUser}
      loginPass={pass}
      setLoginPass={setPass}
      loginErr={err}
      onSubmit={(e) => { e.preventDefault(); setErr("Invalid username or password."); }}
      ssoEnabled={params.get("sso") === "1"}
      onSso={() => setErr("SSO would redirect to the identity provider.")}
    />
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
