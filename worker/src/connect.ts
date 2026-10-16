import { BRAND_SPRITE, THEME_BOOT_SCRIPT, THEME_TOKENS_CSS } from "./theme.ts";

/**
 * Shown once per person under Cloudflare Access: Access has said who they are
 * (an email), but that email isn't linked to a list yet. They prove which list
 * is theirs with its name and PIN, one last time; after that the email alone
 * opens it. On a brand-new database there is no list to claim, so the page
 * creates the first one instead.
 *
 * Same template-literal rules as dashboard.ts: no backticks, no dollar-brace,
 * no backslashes in the inline script or styles.
 */
export function connectHtml(email: string, firstAccount: boolean, next: string): string {
  const safeEmail = escapeHtml(email);
  const safeNext = escapeHtml(next);
  const form = firstAccount
    ? `<p class="sub">This is the first list on this Lighthouse. Give it a name; it will open whenever <strong>${safeEmail}</strong> signs in.</p>
  <form id="connectForm" data-mode="create" data-next="${safeNext}">
    <label for="name">Name</label>
    <input class="field" type="text" id="name" autocomplete="nickname" autocapitalize="words" required>
    <button class="btn" type="submit" id="connectBtn">Create my list</button>
    <p class="error" id="error" role="alert"></p>
  </form>`
    : `<p class="sub">You're signed in as <strong>${safeEmail}</strong>. To open your list, enter its name and PIN once. After this, your email is all you need.</p>
  <form id="connectForm" data-mode="link" data-next="${safeNext}">
    <label for="name">Name</label>
    <input class="field" type="text" id="name" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required>
    <label for="pin">PIN</label>
    <input class="field" type="password" id="pin" inputmode="numeric" autocomplete="current-password" maxlength="64" required>
    <button class="btn" type="submit" id="connectBtn">Connect my list</button>
    <p class="error" id="error" role="alert"></p>
  </form>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Connect your list - Lighthouse</title>
<meta name="theme-color" content="#0d1017" id="themeColor">
<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
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
  .card { width: 100%; max-width: 400px; background: var(--surface); border: 1px solid var(--line); border-radius: 20px; padding: 32px 28px 28px; box-shadow: var(--shadow-lift); }
  .mark { width: 52px; height: 52px; border-radius: 14px; display: block; }
  h1 { margin: 18px 0 6px; font-size: 24px; letter-spacing: -0.02em; line-height: 1.2; }
  .sub { margin: 0 0 22px; color: var(--muted); font-size: 14px; overflow-wrap: anywhere; }
  .sub strong { color: var(--ink); font-weight: 600; }
  label { display: block; margin: 0 0 6px; font-size: 13px; font-weight: 600; color: var(--muted); }
  .field {
    width: 100%; height: 48px; margin-bottom: 16px; padding: 0 14px; border-radius: 12px; border: 1px solid var(--line-strong);
    background: var(--bg); color: var(--ink); font: inherit; font-size: 16px; outline: none; transition: border-color .15s, box-shadow .15s;
  }
  .field:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .btn { width: 100%; height: 48px; margin-top: 4px; border: 0; border-radius: 12px; background: var(--accent); color: var(--on-accent); font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }
  .btn:hover { background: var(--accent-strong); }
  .btn:disabled { opacity: .6; cursor: progress; }
  :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
  .error { margin: 14px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--danger-soft); color: var(--danger); font-size: 14px; }
  .error:empty { display: none; }
  .foot { max-width: 400px; margin: 18px 0 0; color: var(--faint); font-size: 13px; text-align: center; }
  .foot a { color: var(--accent-ink); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--muted); }
</style>
</head>
<body>
${BRAND_SPRITE}
<main class="card">
  <svg class="mark" viewBox="0 0 512 512" aria-hidden="true"><use href="#lh-mark"></use></svg>
  <h1>${firstAccount ? "Create your list" : "Connect your list"}</h1>
  ${form}
</main>
<p class="foot">Not you? <a href="/cdn-cgi/access/logout">Sign out</a>.${firstAccount ? "" : ` Forgot the PIN? Whoever runs this Lighthouse can connect it with <code>npm run users -- link &lt;name&gt; ${safeEmail}</code>.`}</p>
<script>
var MESSAGES = {
  invalid_credentials: "That name and PIN don't match a list.",
  name_and_pin_required: "Enter the list's name and its PIN.",
  name_required: "Give your list a name.",
  already_linked: "That list is already connected to a different email.",
  already_initialized: "Someone has just created the first list. Reload the page to connect to yours."
};

document.getElementById("connectForm").addEventListener("submit", async function (e) {
  e.preventDefault();
  var form = e.currentTarget;
  var create = form.getAttribute("data-mode") === "create";
  var button = document.getElementById("connectBtn");
  var error = document.getElementById("error");
  var pin = document.getElementById("pin");
  var label = button.textContent;
  button.disabled = true;
  button.textContent = create ? "Creating..." : "Connecting...";
  error.textContent = "";
  var message = "";
  try {
    var res = await fetch(create ? "/setup" : "/auth/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ name: document.getElementById("name").value.trim(), pin: pin ? pin.value : undefined })
    });
    var data = {};
    try { data = (await res.json()) || {}; } catch (err) { data = {}; }
    if (res.ok && data.ok) {
      // The server checked this path before putting it in the page.
      location.href = form.getAttribute("data-next") || "/dashboard";
      return;
    }
    message = MESSAGES[data.error] || data.hint || ("That didn't work (HTTP " + res.status + ").");
  } catch (err) {
    message = "Can't reach the server. Check your connection and try again.";
  }
  error.textContent = message;
  button.disabled = false;
  button.textContent = label;
  if (pin && data && data.error === "invalid_credentials") { pin.value = ""; pin.focus(); }
});
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
