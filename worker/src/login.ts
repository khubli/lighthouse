import { BRAND_SPRITE, THEME_BOOT_SCRIPT, THEME_TOKENS_CSS } from "./theme.ts";

/**
 * The sign-in page. Same template-literal rules as dashboard.ts: no backticks,
 * no dollar-brace, no backslashes in the inline script or styles.
 *
 * This page's script is the only way into the app, so it fails loudly: every
 * server answer it can get has its own message, including the non-JSON ones.
 */
export function loginHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Sign in - Lighthouse</title>
<meta name="theme-color" content="#0d1017" id="themeColor">
<meta name="description" content="Lighthouse - your personal watchlist for films, series, books, podcasts and videos">
<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="apple-mobile-web-app-title" content="Lighthouse">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
${THEME_BOOT_SCRIPT}
<style>
${THEME_TOKENS_CSS}
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased; display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 24px 16px;
  }
  .card {
    width: 100%; max-width: 380px; background: var(--surface); border: 1px solid var(--line); border-radius: 20px;
    padding: 32px 28px 28px; box-shadow: var(--shadow-lift);
  }
  .mark { width: 52px; height: 52px; border-radius: 14px; display: block; }
  h1 { margin: 18px 0 4px; font-size: 24px; letter-spacing: -0.02em; line-height: 1.2; }
  .sub { margin: 0 0 24px; color: var(--muted); font-size: 14px; }
  label { display: block; margin: 0 0 6px; font-size: 13px; font-weight: 600; color: var(--muted); }
  .field {
    width: 100%; height: 48px; margin-bottom: 16px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line-strong);
    background: var(--bg); color: var(--ink); font: inherit; font-size: 16px; outline: none;
    transition: border-color .15s, box-shadow .15s;
  }
  .field:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .btn {
    width: 100%; height: 48px; margin-top: 4px; border: 0; border-radius: 12px; background: var(--accent); color: var(--on-accent);
    font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; transition: background .15s;
  }
  .btn:hover { background: var(--accent-strong); }
  .btn:disabled { opacity: .6; cursor: progress; }
  :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
  .error { margin: 14px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--danger-soft); color: var(--danger); font-size: 14px; }
  .error:empty { display: none; }
  .foot { max-width: 380px; margin: 18px 0 0; color: var(--faint); font-size: 13px; text-align: center; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
${BRAND_SPRITE}
<main class="card">
  <svg class="mark" viewBox="0 0 512 512" aria-hidden="true"><use href="#lh-mark"></use></svg>
  <h1>Sign in to Lighthouse</h1>
  <p class="sub">Your list of films, series, books, podcasts and videos.</p>
  <form id="loginForm" method="post" action="/auth/login">
    <label for="name">Name</label>
    <!-- Phones capitalise the first letter of a text field, which turned
         "alex" into "Alex" and read as a wrong PIN. -->
    <input class="field" type="text" id="name" name="name" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
    <label for="pin">PIN</label>
    <!-- No pattern and no 6-digit cap: PINs are 4-10 digits, and older
         accounts may hold one the current rules would not accept. -->
    <input class="field" type="password" id="pin" name="pin" inputmode="numeric" autocomplete="current-password" maxlength="64" required>
    <button class="btn" type="submit" id="loginBtn">Sign in</button>
    <p class="error" id="error" role="alert"></p>
  </form>
</main>
<p class="foot">Forgot your PIN? Whoever runs this Lighthouse can set a new one with <code>npm run users -- set-pin &lt;name&gt;</code>.</p>
<script>
var MESSAGES = {
  invalid_credentials: "That name and PIN don't match an account.",
  name_and_pin_required: "Enter your name and your PIN.",
  session_secret_not_configured: "Signing in is switched off on this server because SESSION_SECRET is not set. The owner can check /health."
};

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function (err) { /* sign-in works without it */ });
  });
}

// Honour ?next= so a link shared while signed out survives sign-in. Only a
// same-origin path is allowed, never an absolute URL.
//
// This was a regex literal once, which is fatal here: the page is emitted from
// a TS template literal, so its backslash was eaten, the script failed to
// parse, and the form silently fell back to a native GET. Character check
// instead: no backslashes, so nothing to eat.
var SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@%/?";
function isSafeNext(value) {
  return typeof value === "string" && value.charAt(0) === "/" && value.charAt(1) !== "/" && value.length > 1 &&
    Array.prototype.every.call(value, function (ch) { return SAFE.indexOf(ch) !== -1; });
}

document.getElementById("loginForm").addEventListener("submit", async function (e) {
  e.preventDefault();
  var button = document.getElementById("loginBtn");
  var error = document.getElementById("error");
  button.disabled = true;
  button.textContent = "Signing in...";
  error.textContent = "";
  var message = "";
  try {
    var res = await fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        name: document.getElementById("name").value.trim(),
        pin: document.getElementById("pin").value
      })
    });
    var data = {};
    try { data = (await res.json()) || {}; } catch (err) { data = {}; }
    if (res.ok && data.ok) {
      var next = new URLSearchParams(location.search).get("next");
      location.href = isSafeNext(next) ? next : "/dashboard";
      return;
    }
    message = MESSAGES[data.error] || (res.status >= 500
      ? "The server had a problem (HTTP " + res.status + "). Try again in a moment."
      : "Sign-in failed (HTTP " + res.status + (data.error ? ", " + data.error : "") + ").");
  } catch (err) {
    message = "Can't reach the server. Check your connection and try again.";
  }
  error.textContent = message;
  button.disabled = false;
  button.textContent = "Sign in";
  if (message === MESSAGES.invalid_credentials) {
    var pin = document.getElementById("pin");
    pin.value = "";
    pin.focus();
  }
});
</script>
</body>
</html>`;
}
