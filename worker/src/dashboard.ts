import { BRAND_SPRITE, THEME_BOOT_SCRIPT, THEME_TOKENS_CSS } from "./theme.ts";

/**
 * The whole app: one HTML page, its styles and its script.
 *
 * Everything below the opening backtick is a TS template literal, which sets
 * three rules for the inline script and styles (each has broken this page
 * before; see CONTRIBUTING.md):
 *   - no backticks anywhere, comments included: one closes the string;
 *   - no dollar-brace sequences: TypeScript interpolates them;
 *   - no backslashes: the template eats them, so a regex such as one matching
 *     a slash arrives broken and kills the whole script. Write character checks
 *     instead, and type the character itself rather than an escape for it.
 * npm test parses the emitted script; run it after any edit here.
 */
export function dashboardHtml(userName: string): string {
  const safeName = escapeHtml(userName);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Lighthouse</title>
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
  :root {
    --s-interested: var(--accent);
    --s-started: var(--t-movie);
    --s-finished: var(--ok);
    --s-dropped: var(--danger);
  }
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  button, input, select { font: inherit; color: inherit; }
  button { cursor: pointer; }
  :focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
  .i { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .wrap { max-width: 1240px; margin: 0 auto; padding: 0 24px; }

  /* --- Header --- */
  .top { display: flex; align-items: center; gap: 12px; padding: 18px 0 10px; }
  .brand { display: flex; align-items: center; gap: 10px; color: var(--ink); text-decoration: none; font-weight: 700; font-size: 19px; letter-spacing: -0.01em; }
  .brand .mark { width: 34px; height: 34px; border-radius: 9px; }
  .top-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .who { color: var(--muted); font-size: 14px; margin-right: 4px; }
  .icon-btn, .text-btn {
    height: 38px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface);
    color: var(--muted); display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    transition: color .15s, border-color .15s, background .15s;
  }
  .icon-btn { width: 38px; padding: 0; flex: none; }
  .text-btn { padding: 0 14px; font-size: 14px; color: var(--ink); }
  .icon-btn:hover, .text-btn:hover { color: var(--ink); border-color: var(--line-strong); background: var(--surface-2); }

  /* --- Capture --- */
  .capture { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; margin-top: 10px; }
  .field {
    height: 50px; padding: 0 16px; border-radius: 12px; border: 1px solid var(--line-strong);
    background: var(--surface); color: var(--ink); font-size: 16px; outline: none; min-width: 0;
    transition: border-color .15s, box-shadow .15s;
  }
  .field::placeholder { color: var(--faint); }
  .field:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  select.field {
    padding-right: 34px; font-size: 15px; appearance: none; -webkit-appearance: none; cursor: pointer;
    background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%);
    background-position: calc(100% - 18px) 52%, calc(100% - 13px) 52%; background-size: 5px 5px; background-repeat: no-repeat;
  }
  select.field.type-set { border-color: var(--accent); color: var(--accent-ink); font-weight: 600; }
  .btn-primary {
    height: 50px; padding: 0 24px; border-radius: 12px; border: 0; background: var(--accent); color: var(--on-accent);
    font-weight: 700; font-size: 15px; transition: background .15s, transform .1s;
  }
  .btn-primary:hover { background: var(--accent-strong); }
  .btn-primary:active { transform: translateY(1px); }
  .btn-primary:disabled { opacity: .55; cursor: progress; }
  .line-status { margin-top: 8px; font-size: 14px; color: var(--muted); }
  .line-status:empty, .pick-note:empty { display: none; }
  .line-status.is-error { color: var(--danger); }
  .line-status.is-ok { color: var(--ok); }
  .linklike { background: none; border: 0; padding: 0; color: var(--accent-ink); font-weight: 600; text-decoration: underline; text-underline-offset: 2px; }

  /* --- Overview + picks --- */
  .overview { display: flex; align-items: center; gap: 12px 20px; flex-wrap: wrap; margin-top: 20px; }
  .headline { margin: 0; font-size: 26px; line-height: 1.2; font-weight: 700; letter-spacing: -0.02em; }
  .headline b { color: var(--accent-ink); font-variant-numeric: tabular-nums; }
  .headline .soft { color: var(--muted); font-weight: 600; }
  .picks { margin-left: auto; display: flex; gap: 8px; }
  .pick-btn {
    height: 42px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--line-strong);
    background: var(--surface); color: var(--ink); font-weight: 600; font-size: 14px;
    display: inline-flex; align-items: center; gap: 8px; transition: border-color .15s, background .15s;
  }
  .pick-btn .i { color: var(--accent-ink); }
  .pick-btn:hover { border-color: var(--accent); background: var(--accent-soft); }
  .pick-btn:disabled { opacity: .6; cursor: progress; }
  .pick-note { margin-top: 8px; font-size: 14px; color: var(--muted); }

  /* --- Filters --- */
  .filters {
    position: sticky; top: 0; z-index: 5; margin-top: 6px; padding: 12px 0;
    background: var(--bg); background: color-mix(in srgb, var(--bg) 90%, transparent);
    -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
  }
  .filters-inner { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .chips { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; flex: 0 1 auto; min-width: 0; padding: 3px; margin: -3px; }
  .chips::-webkit-scrollbar { display: none; }
  .chip {
    flex: none; height: 36px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--line);
    background: transparent; color: var(--muted); font-size: 14px; font-weight: 500;
    display: inline-flex; align-items: center; gap: 7px; transition: background .15s, color .15s, border-color .15s;
  }
  .chip:hover { color: var(--ink); border-color: var(--line-strong); }
  .chip .count { color: var(--faint); font-size: 13px; font-variant-numeric: tabular-nums; }
  .chip[aria-pressed="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  .chip[aria-pressed="true"] .count { color: inherit; opacity: .7; }
  .tdot { width: 8px; height: 8px; border-radius: 50%; background: var(--c, var(--faint)); flex: none; }
  .filters .field { height: 38px; font-size: 14px; border-radius: 10px; }
  .filters select.field { flex: none; }
  .search-box { position: relative; margin-left: auto; }
  .search-box .i { position: absolute; left: 11px; top: 10px; color: var(--faint); pointer-events: none; }
  .search-box .field { padding-left: 36px; width: 190px; }
  /* Reload matters in the installed app on a phone, which has no browser
     chrome. On a wide screen it only crowded the filter row onto two lines. */
  #refreshBtn { display: none; }

  /* --- Grid + cards --- */
  .grid { list-style: none; margin: 0; padding: 14px 0 64px; display: grid; grid-template-columns: repeat(auto-fill, minmax(172px, 1fr)); gap: 24px 18px; }
  .card { display: block; width: 100%; padding: 0; border: 0; background: none; text-align: left; color: inherit; border-radius: 14px; }
  .card:focus-visible { outline: none; }
  .card:focus-visible .poster { outline: 3px solid var(--focus); outline-offset: 3px; }
  .poster {
    position: relative; display: block; aspect-ratio: 2 / 3; border-radius: 12px; overflow: hidden;
    background: var(--surface-2); box-shadow: var(--shadow); transition: transform .18s ease, box-shadow .18s ease;
  }
  .card:hover .poster { transform: translateY(-3px); box-shadow: var(--shadow-lift); }
  .poster .art { position: relative; z-index: 1; display: block; width: 100%; height: 100%; object-fit: cover; }
  /* Square and 16:9 art (podcasts, music, videos) is shown whole over a blurred
     copy of itself, rather than cropped into a portrait frame: cropping cut the
     titles off video thumbnails. */
  .poster.fit .art { object-fit: contain; }
  .poster .backdrop { position: absolute; inset: -24px; width: calc(100% + 48px); height: calc(100% + 48px); object-fit: cover; filter: blur(22px) saturate(1.3) brightness(.62); }
  .poster.ph {
    display: flex; flex-direction: column; justify-content: space-between; padding: 14px;
    background: var(--surface-2);
    background: linear-gradient(165deg, color-mix(in srgb, var(--c) 24%, var(--surface-2)) 0%, var(--surface-2) 70%);
  }
  .poster.ph > .i { width: 28px; height: 28px; color: var(--c); }
  .ph-title {
    font-size: 17px; font-weight: 700; line-height: 1.22; letter-spacing: -0.01em; color: var(--ink);
    display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere;
  }
  .poster.quote { display: flex; flex-direction: column; padding: 16px 14px 14px; background: var(--surface-2); }
  .quote-text {
    font-size: 14px; line-height: 20px; color: var(--ink); flex: 0 1 auto; min-height: 0;
    display: -webkit-box; -webkit-line-clamp: 9; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere;
  }
  .poster.quote .quote-mark { width: 22px; height: 22px; color: var(--t-post); margin-bottom: 8px; }
  .quote-by { display: flex; align-items: center; gap: 8px; margin-top: auto; padding-top: 10px; font-size: 13px; font-weight: 600; color: var(--t-post); min-width: 0; }
  .quote-by span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .avatar { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; flex: none; }
  .tag-status {
    position: absolute; z-index: 2; left: 8px; top: 8px; display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 9px 3px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; color: #fff;
    background: rgba(10, 12, 18, .74); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
  }
  .tag-status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--sc); }
  .card-title {
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    margin-top: 10px; font-size: 15px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere;
  }
  .card-meta { display: flex; align-items: center; gap: 7px; margin-top: 3px; font-size: 13px; color: var(--muted); min-width: 0; }
  .card-meta span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .enter { animation: enter .32s ease both; }
  @keyframes enter { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  .skeleton .poster { animation: pulse 1.4s ease-in-out infinite; box-shadow: none; }
  .skeleton .bar { display: block; height: 12px; border-radius: 6px; background: var(--surface-2); margin-top: 12px; width: 75%; }
  .skeleton .bar.short { width: 45%; margin-top: 8px; }
  @keyframes pulse { 50% { opacity: .55; } }

  /* --- Empty and error states --- */
  .empty { grid-column: 1 / -1; text-align: center; padding: 48px 16px 72px; color: var(--muted); }
  .empty .mark { width: 56px; height: 56px; border-radius: 14px; }
  .empty h2 { margin: 16px 0 6px; color: var(--ink); font-size: 20px; letter-spacing: -0.01em; }
  .empty p { margin: 0 auto 8px; max-width: 480px; }
  .empty .text-btn { margin-top: 12px; }

  /* --- Detail sheet --- */
  dialog.sheet {
    width: min(880px, calc(100% - 32px)); max-height: min(88vh, 920px); padding: 0; border: 0; border-radius: 20px;
    background: var(--surface); color: var(--ink); box-shadow: 0 30px 90px rgba(0, 0, 0, .45); overflow: hidden;
  }
  dialog.sheet[open] { display: grid; grid-template-columns: 280px minmax(0, 1fr); grid-template-rows: 0 auto; animation: sheet-in .2s ease; }
  dialog.sheet::backdrop { background: rgba(6, 8, 12, .62); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
  @keyframes sheet-in { from { opacity: 0; transform: translateY(12px) scale(.985); } to { opacity: 1; transform: none; } }
  /* A zero-height sticky bar, so the close button stays in reach while a long
     sheet scrolls on a phone, without taking any room in the layout. */
  .sheet-bar { grid-column: 1 / -1; position: sticky; top: 0; z-index: 4; height: 0; display: flex; justify-content: flex-end; }
  .close-btn { margin: 14px 14px 0 0; width: 38px; height: 38px; border-radius: 50%; border: 1px solid var(--line); background: var(--surface); color: var(--muted); display: inline-flex; align-items: center; justify-content: center; flex: none; }
  .close-btn:hover { color: var(--ink); background: var(--surface-2); }
  .sheet-art { position: relative; overflow: hidden; background: var(--surface-2); padding: 24px; }
  .sheet-art .poster { box-shadow: 0 12px 40px rgba(0, 0, 0, .45); }
  .sheet-art .poster.fit { aspect-ratio: auto; }
  .sheet-art .poster.fit .art { height: auto; }
  .sheet-art .poster.fit .backdrop { display: none; }
  .sheet-art .glow { position: absolute; inset: -40px; width: calc(100% + 80px); height: calc(100% + 80px); object-fit: cover; filter: blur(40px) saturate(1.4) brightness(.55); }
  .sheet-body { overflow-y: auto; max-height: min(88vh, 920px); padding: 26px 30px 26px 28px; }
  .pick-banner { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 48px 16px 0; padding: 8px 8px 8px 14px; border-radius: 12px; background: var(--accent-soft); font-size: 14px; }
  .pick-banner .i { color: var(--accent-ink); }
  .pick-banner .text-btn { height: 32px; margin-left: auto; font-size: 13px; }
  .kicker { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); padding-right: 48px; }
  .sheet-title { margin: 6px 48px 2px 0; font-size: 28px; line-height: 1.15; letter-spacing: -0.02em; overflow-wrap: anywhere; }
  .byline { color: var(--muted); font-size: 15px; }
  .seg-group { display: flex; flex-wrap: wrap; gap: 6px; margin: 18px 0 4px; }
  .seg { height: 36px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--line-strong); background: transparent; color: var(--ink); font-size: 14px; transition: background .15s, border-color .15s; }
  .seg:hover { border-color: var(--accent); }
  .seg[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 650; }
  .seg:disabled { cursor: progress; }
  .links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
  .link-btn { display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface-2); color: var(--ink); font-weight: 600; font-size: 14px; text-decoration: none; }
  .link-btn:hover { border-color: var(--line-strong); }
  .link-btn .i { width: 15px; height: 15px; color: var(--muted); }
  .section-label { margin: 22px 0 6px; font-size: 12px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
  .synopsis { margin: 0; font-size: 15px; line-height: 1.6; white-space: pre-line; }
  .facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; margin: 0; font-size: 14px; }
  .facts dt { color: var(--muted); }
  .facts dd { margin: 0; }
  .tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .tag { padding: 3px 10px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--line); font-size: 13px; color: var(--muted); }
  .sheet-tools { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 24px; padding-top: 14px; border-top: 1px solid var(--line); }
  .ghost-btn { height: 34px; padding: 0 11px; border-radius: 8px; border: 0; background: transparent; color: var(--muted); font-size: 14px; display: inline-flex; align-items: center; gap: 6px; }
  .ghost-btn .i { width: 16px; height: 16px; }
  .ghost-btn:hover { background: var(--surface-2); color: var(--ink); }
  .ghost-btn.danger { color: var(--danger); }
  .ghost-btn.danger:hover { background: var(--danger-soft); }
  .ghost-btn:disabled { opacity: .6; cursor: progress; }
  .inline-form { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; }
  .inline-form .field { height: 40px; font-size: 15px; flex: 1 1 200px; border-radius: 10px; }
  .inline-form .btn-primary { height: 40px; padding: 0 16px; border-radius: 10px; font-size: 14px; }
  .btn-danger { height: 40px; padding: 0 16px; border-radius: 10px; border: 0; background: var(--danger); color: #fff; font-weight: 700; font-size: 14px; }
  .confirm-text { flex: 1 1 100%; font-size: 14px; }

  @media (max-width: 760px) {
    .wrap { padding: 0 16px; }
    .who { display: none; }
    .capture { grid-template-columns: 1fr auto; }
    .capture #submitInput { grid-column: 1 / -1; }
    .overview { margin-top: 16px; }
    .headline { font-size: 21px; }
    .picks { margin-left: 0; width: 100%; }
    .pick-btn { flex: 1; justify-content: center; padding: 0 10px; }
    .chips { order: -1; flex: 1 1 100%; margin: -3px -16px; padding: 3px 16px; }
    .search-box { flex: 1; min-width: 0; margin-left: 0; }
    #refreshBtn { display: inline-flex; }
    .search-box .field { width: 100%; }
    .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px 12px; }
    .card-title { font-size: 14px; }
    dialog.sheet { width: 100%; max-width: 100%; max-height: 92vh; margin: auto 0 0; border-radius: 20px 20px 0 0; overflow-y: auto; }
    dialog.sheet[open] { display: block; animation-name: sheet-up; }
    @keyframes sheet-up { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
    .sheet-art { height: 236px; padding: 20px; display: flex; justify-content: center; }
    .sheet-art { align-items: center; }
    .sheet-art .poster { height: 100%; width: auto; }
    .sheet-art .poster.fit { height: auto; width: 100%; max-width: 380px; }
    .sheet-body { max-height: none; overflow: visible; padding: 20px 18px 32px; }
    .sheet-title { font-size: 24px; margin-right: 0; }
    .kicker, .pick-banner { padding-right: 0; margin-right: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
  }
</style>
</head>
<body>
${BRAND_SPRITE}
<div class="wrap">
  <header class="top">
    <a class="brand" href="/dashboard" aria-label="Lighthouse, home">
      <svg class="mark" viewBox="0 0 512 512" aria-hidden="true"><use href="#lh-mark"></use></svg>
      <span>Lighthouse</span>
    </a>
    <div class="top-actions">
      <span class="who">${safeName}</span>
      <button class="icon-btn" id="themeBtn" type="button" title="Switch between light and dark" aria-label="Switch between light and dark">
        <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-contrast"></use></svg>
      </button>
      <button class="text-btn" id="logoutBtn" type="button">Sign out</button>
    </div>
  </header>

  <form class="capture" id="submitForm" autocomplete="off">
    <label class="sr-only" for="submitInput">Add to your list</label>
    <input class="field" id="submitInput" name="text" placeholder="Paste a link, or type a title" enterkeyhint="send" autocapitalize="sentences">
    <label class="sr-only" for="submitType">Type</label>
    <select class="field" id="submitType" title="What is it? Auto lets Lighthouse work it out.">
      <option value="auto">Auto</option>
      <option value="movie">Movie</option>
      <option value="series">Series</option>
      <option value="book">Book</option>
      <option value="podcast">Podcast</option>
      <option value="youtube">Video</option>
      <option value="song">Music</option>
      <option value="post">Post (X or Reddit)</option>
    </select>
    <button class="btn-primary" type="submit" id="submitBtn">Save</button>
  </form>
  <div class="line-status" id="submitToast" role="status" aria-live="polite"></div>

  <section class="overview" aria-label="Summary">
    <h1 class="headline" id="headline">Your watchlist</h1>
    <div class="picks">
      <button class="pick-btn" id="pickToday" type="button" title="Pick one thing from your list">
        <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-sparkle"></use></svg>Surprise me
      </button>
      <button class="pick-btn" id="pickShort" type="button" title="Pick something low-commitment: a short film, one season, a slim book">
        <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-clock"></use></svg>Something short
      </button>
    </div>
  </section>
  <div class="pick-note" id="pickNote" role="status" aria-live="polite"></div>

  <nav class="filters" aria-label="Filters">
    <div class="filters-inner">
      <label class="sr-only" for="statusFilter">Show</label>
      <select class="field" id="statusFilter" title="Which statuses to show"></select>
      <div class="chips" id="tabs" role="group" aria-label="Type"></div>
      <div class="search-box">
        <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-search"></use></svg>
        <label class="sr-only" for="search">Search</label>
        <input class="field" id="search" type="search" placeholder="Search" autocomplete="off">
      </div>
      <button class="icon-btn" id="refreshBtn" type="button" title="Reload the list" aria-label="Reload the list">
        <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-reload"></use></svg>
      </button>
    </div>
  </nav>

  <ul class="grid" id="grid" aria-busy="true"></ul>
</div>

<dialog class="sheet" id="modal" aria-labelledby="sheetTitle">
  <div class="sheet-bar">
    <button class="close-btn" id="modalClose" type="button" aria-label="Close">
      <svg class="i" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-close"></use></svg>
    </button>
  </div>
  <div class="sheet-art" id="sheetArt"></div>
  <div class="sheet-body" id="modalBody"></div>
</dialog>

<script>
var TYPES = {
  movie: { one: "Movie", many: "Movies" },
  series: { one: "Series", many: "Series" },
  book: { one: "Book", many: "Books" },
  podcast: { one: "Podcast", many: "Podcasts" },
  youtube: { one: "Video", many: "Videos" },
  song: { one: "Music", many: "Music" },
  post: { one: "Post", many: "Posts" },
  unknown: { one: "Other", many: "Other" }
};
var TYPE_ORDER = ["movie", "series", "book", "podcast", "youtube", "song", "post", "unknown"];
var TYPE_ICON = { movie: "i-film", series: "i-tv", book: "i-book", podcast: "i-mic", youtube: "i-play", song: "i-note", post: "i-quote", unknown: "i-bookmark" };
var STATUS = { inbox: "Inbox", interested: "Interested", started: "In progress", finished: "Done", dropped: "Dropped" };
var STATUS_ORDER = ["inbox", "interested", "started", "finished", "dropped"];
var ACTIVE = ["inbox", "interested", "started"];
// Status views. "Up next" is the default and replaces the old rule where the
// All tab silently hid finished items AND music, so choosing "Finished" while
// on All showed nothing at all.
var VIEWS = {
  next: { label: "Up next", statuses: ACTIVE },
  inbox: { label: "Inbox", statuses: ["inbox"] },
  interested: { label: "Interested", statuses: ["interested"] },
  started: { label: "In progress", statuses: ["started"] },
  finished: { label: "Done", statuses: ["finished"] },
  dropped: { label: "Dropped", statuses: ["dropped"] },
  all: { label: "Everything", statuses: STATUS_ORDER }
};
// Types whose art is square or 16:9 rather than a portrait poster.
var FIT_TYPES = ["youtube", "podcast", "song", "post"];
var ERRORS = {
  network: "Can't reach Lighthouse. Check your connection and try again.",
  text_required: "Type a title or paste a link first.",
  not_found: "That item no longer exists, so it has been taken off the list.",
  no_new_data: "No new details found for this one.",
  invalid_status: "That isn't a status Lighthouse knows.",
  internal_error: "Something went wrong on the server. Try again in a moment.",
  no_candidates: "Nothing to pick from yet. Save something first."
};
var SEP = " · ";

var state = {
  items: [],
  type: "",
  view: readPref("lh_view", "next"),
  query: "",
  loadedAt: 0,
  animateNext: true,
  openId: null,
  pick: null,
  lastPickId: null
};
if (!VIEWS[state.view]) state.view = "next";

// --- Small helpers ---

function readPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch (err) { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch (err) { /* private mode: not remembered, still works */ }
}
function byId(id) { return document.getElementById(id); }
// Escapes quotes too. The previous helper did not, and its output went into
// src attributes, so an image URL with a double quote in it (enrichment data
// comes from third-party APIs) could break out of the attribute.
function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
// Only web links reach an href or src: a javascript: URL in an href runs when
// it is clicked. Data URLs are allowed for images only (the demo uses them).
function safeUrl(value) {
  var url = typeof value === "string" ? value.trim() : "";
  var lower = url.toLowerCase();
  return lower.indexOf("https://") === 0 || lower.indexOf("http://") === 0 ? url : "";
}
function safeImg(value) {
  var url = typeof value === "string" ? value.trim() : "";
  return safeUrl(url) || (url.indexOf("data:image/") === 0 ? url : "");
}
function icon(name, cls) {
  return '<svg class="i' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true"><use href="#' + name + '"></use></svg>';
}
function meta(item) {
  if (!item._m) { try { item._m = JSON.parse(item.metadata_json || "{}") || {}; } catch (err) { item._m = {}; } }
  return item._m;
}
function avail(item) {
  if (!item._a) { try { item._a = JSON.parse(item.availability_json || "{}") || {}; } catch (err) { item._a = {}; } }
  return item._a;
}
function typeOf(item) { return TYPES[item.media_type] ? item.media_type : "unknown"; }
function list(value) { return Array.isArray(value) ? value.filter(Boolean) : []; }
function plural(n, one, many) { return n + " " + (Number(n) === 1 ? one : many); }
function minutes(total) {
  var n = Math.round(Number(total));
  if (!n) return "";
  var h = Math.floor(n / 60);
  var m = n % 60;
  return h ? h + "h" + (m ? " " + m + "m" : "") : m + "m";
}
function clock(totalSeconds) {
  var s = Math.round(Number(totalSeconds));
  if (!s) return "";
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var r = String(s % 60).padStart(2, "0");
  return h ? h + ":" + String(m).padStart(2, "0") + ":" + r : m + ":" + r;
}
function compact(n) {
  try { return new Intl.NumberFormat(undefined, { notation: "compact" }).format(Number(n)); } catch (err) { return String(n); }
}
function niceDate(value) {
  var d = new Date(value);
  if (isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function findItem(id) {
  for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
  return null;
}
// Puts a fresh copy from the server into the list. In place by default, so a
// status change does not reshuffle the grid under the user; at the top for a
// new save.
function replaceItem(item, toTop) {
  if (!item) return;
  var index = -1;
  for (var i = 0; i < state.items.length; i++) if (state.items[i].id === item.id) { index = i; break; }
  if (index !== -1 && !toTop) { state.items[index] = item; return; }
  if (index !== -1) state.items.splice(index, 1);
  state.items.unshift(item);
}
function isTyping(el) {
  var tag = el && el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || Boolean(el && el.isContentEditable);
}

// --- Talking to the Worker ---

async function api(path, options) {
  // redirect: manual so a sign-in redirect from Cloudflare Access is seen as
  // one, rather than followed cross-site and reported as "can't reach".
  var init = { credentials: "same-origin", redirect: "manual", method: (options && options.method) || "GET", headers: {} };
  if (options && options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    init.headers["Content-Type"] = "application/json";
  }
  var res;
  try { res = await fetch(path, init); } catch (err) { return { ok: false, status: 0, data: { error: "network" } }; }
  // Cloudflare Access wants the person to sign in again. Reloading the page
  // is a navigation, which Access can send to its sign-in screen and back.
  if (res.type === "opaqueredirect") { location.reload(); return { ok: false, status: 0, data: { error: "reauth" } }; }
  // An expired session used to come back as an empty list, which showed "Your
  // watchlist is empty" and read as lost data. Go and sign in instead.
  if (res.status === 401) { goToLogin(); return { ok: false, status: 401, data: { error: "unauthorized" } }; }
  var data = {};
  try { data = (await res.json()) || {}; } catch (err) { data = {}; }
  if (res.status === 403 && data.error === "access_required") { location.reload(); return { ok: false, status: 403, data: data }; }
  return { ok: res.ok, status: res.status, data: data };
}
function goToLogin() {
  location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search);
}
function errorText(r) {
  var d = r.data || {};
  if (d.hint) return d.hint;
  if (d.error === "title_conflict") return "You already have “" + (d.conflict_title || "that title") + "” of this type.";
  if (d.error === "type_conflict") return "“" + (d.conflict_title || "That title") + "” is already saved as that type.";
  if (ERRORS[d.error]) return ERRORS[d.error];
  return d.error ? "That didn't work (" + d.error + ")." : "That didn't work (HTTP " + r.status + ").";
}
function setLine(el, text, kind) {
  el.textContent = text;
  el.className = "line-status" + (kind ? " is-" + kind : "");
}

// --- The grid ---

function showSkeleton() {
  var html = "";
  for (var i = 0; i < 10; i++) html += '<li class="skeleton" aria-hidden="true"><span class="poster"></span><span class="bar"></span><span class="bar short"></span></li>';
  byId("grid").innerHTML = html;
}

async function loadItems() {
  var grid = byId("grid");
  if (!state.items.length) showSkeleton();
  grid.setAttribute("aria-busy", "true");
  var r = await api("/items?limit=500");
  grid.setAttribute("aria-busy", "false");
  if (!r.ok) {
    if (r.status === 401) return;
    if (state.items.length) { setLine(byId("submitToast"), errorText(r), "error"); return; }
    grid.innerHTML = '<li class="empty"><h2>Could not load your list</h2><p>' + esc(errorText(r)) + '</p><button class="text-btn" type="button" data-action="reload">Try again</button></li>';
    return;
  }
  state.items = r.data.items || [];
  state.loadedAt = Date.now();
  render();
}

function haystack(item) {
  if (item._h === undefined) {
    var m = meta(item);
    item._h = [item.title, item.synopsis, m.author_name, m.author_handle, m.subreddit, m.channel_name, m.artist, m.publisher,
      list(m.authors).join(" "), list(m.genres).join(" "), list(m.categories).join(" "), TYPES[typeOf(item)].one]
      .filter(Boolean).join(" ").toLowerCase();
  }
  return item._h;
}

function render() {
  var statuses = VIEWS[state.view].statuses;
  var inView = state.items.filter(function (item) { return statuses.indexOf(item.status) !== -1; });
  renderHeadline();
  renderChips(inView);
  var q = state.query.trim().toLowerCase();
  var shown = inView.filter(function (item) {
    if (state.type && typeOf(item) !== state.type) return false;
    return !q || haystack(item).indexOf(q) !== -1;
  });
  var grid = byId("grid");
  var animate = state.animateNext;
  state.animateNext = false;
  grid.innerHTML = shown.length
    ? shown.map(function (item, i) { return cardHtml(item, i, animate); }).join("")
    : emptyHtml();
}

function renderHeadline() {
  var c = { inbox: 0, interested: 0, started: 0, finished: 0, dropped: 0 };
  state.items.forEach(function (item) { if (c[item.status] !== undefined) c[item.status]++; });
  var h = byId("headline");
  if (!state.items.length) { h.textContent = "Your watchlist"; return; }
  var html = "<b>" + (c.inbox + c.interested) + "</b> waiting";
  if (c.started) html += ", <b>" + c.started + "</b> in progress";
  if (c.finished) html += ' <span class="soft">' + SEP.trim() + " " + c.finished + " done</span>";
  h.innerHTML = html;
}

function renderChips(inView) {
  var counts = {};
  inView.forEach(function (item) { var t = typeOf(item); counts[t] = (counts[t] || 0) + 1; });
  var html = chipHtml("", "All", inView.length);
  TYPE_ORDER.forEach(function (t) {
    if (counts[t] || state.type === t) html += chipHtml(t, TYPES[t].many, counts[t] || 0);
  });
  byId("tabs").innerHTML = html;
}
function chipHtml(type, label, n) {
  return '<button type="button" class="chip" data-type="' + type + '" aria-pressed="' + (state.type === type) + '"' +
    (type ? ' style="--c: var(--t-' + type + ')"' : "") + ">" + (type ? '<span class="tdot"></span>' : "") +
    esc(label) + ' <span class="count">' + n + "</span></button>";
}

function emptyHtml() {
  var mark = '<svg class="mark" viewBox="0 0 512 512" aria-hidden="true"><use href="#lh-mark"></use></svg>';
  if (!state.items.length) {
    return '<li class="empty">' + mark + "<h2>Nothing saved yet</h2>" +
      "<p>Paste a link above or just type a title. A film, a book, a YouTube video, a podcast, an X or Reddit post: Lighthouse works out what it is and fills in the details.</p>" +
      "<p>On Android, install Lighthouse from the browser menu and it shows up in every app's share sheet.</p></li>";
  }
  var filtered = Boolean(state.type || state.query.trim());
  var message = filtered ? "Nothing matches." : state.view === "next" ? "Nothing waiting. Everything is done or dropped." : "Nothing here yet.";
  var reset = filtered || state.view !== "next";
  return '<li class="empty">' + mark + "<h2>" + esc(message) + "</h2>" +
    (reset ? '<button class="text-btn" type="button" data-action="clear">Show everything up next</button>' : "") + "</li>";
}

function statusTag(item) {
  if (item.status === "inbox" || !STATUS[item.status]) return "";
  return '<span class="tag-status" style="--sc: var(--s-' + item.status + ')">' + STATUS[item.status] + "</span>";
}

// --- Posts: X or Reddit ---
// Items saved before Reddit support carry no platform, so the link decides.
function postPlatform(item) {
  var p = meta(item).platform;
  if (p === "x" || p === "reddit") return p;
  return String(avail(item).post_url || "").indexOf("reddit.com") !== -1 ? "reddit" : "x";
}
function postAuthor(item) {
  var m = meta(item);
  if (postPlatform(item) === "reddit") return m.author_handle ? "u/" + m.author_handle : "";
  return m.author_handle ? "@" + m.author_handle : m.author_name || "";
}
// Where a post came from, in one short phrase: r/books, or @someone.
function postWhere(item) {
  return postPlatform(item) === "reddit" ? meta(item).subreddit || postAuthor(item) : postAuthor(item);
}
function typeLabel(item) {
  var t = typeOf(item);
  if (t === "post") return postPlatform(item) === "reddit" ? "Reddit post" : "X post";
  return TYPES[t].one;
}

// The art for a card or the sheet. Falls back to a drawn tile when there is no
// image, and to the post text for posts without media.
function posterHtml(item, withTag) {
  var img = safeImg(item.image_url);
  if (!img) return fallbackPoster(item, withTag);
  var fit = FIT_TYPES.indexOf(typeOf(item)) !== -1;
  return '<span class="poster' + (fit ? " fit" : "") + '">' +
    (fit ? '<img class="backdrop" src="' + esc(img) + '" alt="" loading="lazy">' : "") +
    '<img class="art" src="' + esc(img) + '" alt="" loading="lazy">' + (withTag ? statusTag(item) : "") + "</span>";
}
function fallbackPoster(item, withTag) {
  var t = typeOf(item);
  var tag = withTag ? statusTag(item) : "";
  if (t === "post") {
    var m = meta(item);
    var who = postWhere(item);
    var avatar = safeImg(m.avatar_url);
    // A Reddit post's title is its headline; an X post's text is the post.
    var quote = postPlatform(item) === "reddit" ? item.title : item.synopsis || item.title;
    return '<span class="poster quote">' + icon("i-quote", "quote-mark") +
      '<span class="quote-text">' + esc(quote) + "</span>" +
      (who ? '<span class="quote-by">' + (avatar ? '<img class="avatar" src="' + esc(avatar) + '" alt="" loading="lazy">' : "") + "<span>" + esc(who) + "</span></span>" : "") +
      tag + "</span>";
  }
  return '<span class="poster ph">' + icon(TYPE_ICON[t]) + '<span class="ph-title">' + esc(item.title) + "</span>" + tag + "</span>";
}

// The short line under a card: the two or three facts that tell items apart.
function metaLine(item) {
  var m = meta(item);
  var t = typeOf(item);
  var parts = [typeLabel(item)];
  if (t === "movie") parts.push(item.release_year, minutes(m.runtime));
  else if (t === "series") parts.push(item.release_year, m.number_of_seasons ? plural(m.number_of_seasons, "season", "seasons") : "");
  else if (t === "book") parts.push(list(m.authors)[0], m.page_count ? m.page_count + " pages" : "");
  else if (t === "podcast") parts.push(m.publisher);
  else if (t === "youtube") parts.push(m.channel_name, clock(m.duration_seconds));
  else if (t === "song") parts.push(m.artist || m.channel_name, clock(m.duration_seconds));
  else if (t === "post") parts.push(postWhere(item));
  else parts.push(item.release_year);
  return parts.filter(Boolean).join(SEP);
}

function cardTitle(item) {
  // A text-only post already shows its words on the card; who posted it is the
  // more useful caption than the same words again.
  if (typeOf(item) === "post" && !safeImg(item.image_url)) {
    return (postPlatform(item) === "reddit" ? postAuthor(item) : meta(item).author_name) || item.title;
  }
  return item.title;
}

function cardHtml(item, i, animate) {
  var t = typeOf(item);
  var style = "--c: var(--t-" + t + ")" + (animate ? "; animation-delay: " + Math.min(i, 14) * 28 + "ms" : "");
  return '<li><button type="button" class="card' + (animate ? " enter" : "") + '" data-id="' + item.id + '" style="' + style + '">' +
    posterHtml(item, true) +
    '<span class="card-title">' + esc(cardTitle(item)) + "</span>" +
    '<span class="card-meta"><span class="tdot"></span><span>' + esc(metaLine(item)) + "</span></span></button></li>";
}

// A broken image becomes the drawn tile instead of a broken-image icon. Error
// events do not bubble, so this listens in the capture phase.
function handleImageError(e) {
  var img = e.target;
  if (!img || img.tagName !== "IMG") return;
  if (!img.classList.contains("art")) { img.remove(); return; }
  var poster = img.closest(".poster");
  var holder = img.closest("[data-id]");
  var item = holder ? findItem(Number(holder.getAttribute("data-id"))) : null;
  if (poster && item) poster.outerHTML = fallbackPoster(item, Boolean(img.closest(".card")));
}

// --- The detail sheet ---

function providerLines(a) {
  var wp = a.tmdb_watch_providers;
  if (!wp) return [];
  var labels = { flatrate: "Stream", free: "Free", ads: "Free with ads", rent: "Rent", buy: "Buy" };
  var seen = {};
  var lines = [];
  ["flatrate", "free", "ads", "rent", "buy"].forEach(function (key) {
    var names = list(wp[key]).map(function (p) { return p.provider_name; }).filter(function (n) {
      if (!n || seen[n]) return false;
      seen[n] = true;
      return true;
    });
    if (names.length) lines.push([labels[key], names.join(", ")]);
  });
  return lines;
}

function renderSheet(item) {
  var t = typeOf(item);
  var m = meta(item);
  var a = avail(item);
  var img = safeImg(item.image_url);
  var art = byId("sheetArt");
  art.setAttribute("data-id", item.id);
  art.innerHTML = (img ? '<img class="glow" src="' + esc(img) + '" alt="">' : "") + posterHtml(item, false);

  var h = "";
  if (state.pick) {
    h += '<div class="pick-banner">' + icon(state.pick.mode === "short" ? "i-clock" : "i-sparkle") +
      "<span>" + (state.pick.mode === "short" ? "Short pick" : "Tonight's pick") + " from " + state.pick.candidates + "</span>" +
      '<button class="text-btn" type="button" data-action="pick-again">Pick another</button></div>';
  }

  var length = t === "movie" ? minutes(m.runtime)
    : t === "series" && m.number_of_seasons ? plural(m.number_of_seasons, "season", "seasons")
    : t === "book" && m.page_count ? m.page_count + " pages"
    : t === "youtube" || t === "song" ? clock(m.duration_seconds) : "";
  h += '<div class="kicker" style="--c: var(--t-' + t + ')"><span class="tdot"></span><span>' +
    esc([typeLabel(item), t === "youtube" || t === "post" ? "" : item.release_year, length].filter(Boolean).join(SEP)) + "</span></div>";
  var xTextOnly = t === "post" && !img && postPlatform(item) === "x";
  h += '<h2 class="sheet-title" id="sheetTitle">' + esc(xTextOnly ? m.author_name || "X post" : item.title) + "</h2>";

  var by = t === "book" ? list(m.authors).join(", ")
    : t === "youtube" ? m.channel_name
    : t === "song" ? m.artist || m.channel_name
    : t === "podcast" ? m.publisher
    : t === "post" ? (postPlatform(item) === "reddit" ? [m.subreddit, postAuthor(item)].filter(Boolean).join(SEP) : postAuthor(item)) : "";
  if (by) h += '<div class="byline">' + esc((t === "book" ? "by " : "") + by) + "</div>";

  h += '<div class="seg-group" role="group" aria-label="Status">' + STATUS_ORDER.map(function (s) {
    return '<button type="button" class="seg" data-status="' + s + '" aria-pressed="' + (item.status === s) + '">' + STATUS[s] + "</button>";
  }).join("") + "</div>";

  var links = [];
  function addLink(url, label) {
    var u = safeUrl(url);
    if (u) links.push('<a class="link-btn" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + icon("i-out") + "</a>");
  }
  if (t === "youtube") addLink(a.video_url, "Watch on YouTube");
  if (t === "song") addLink(a.video_url, "Listen");
  if (t === "post") { addLink(a.post_url, postPlatform(item) === "reddit" ? "Open on Reddit" : "Open on X"); addLink(m.link_url, "Linked page"); }
  if (t === "book") { addLink(a.info_link, "Book details"); addLink(a.preview_link, "Preview"); }
  if (t === "podcast") { addLink(a.apple_url, "Apple Podcasts"); addLink(a.website, "Website"); addLink(a.rss_feed, "RSS feed"); }
  if (t === "movie" || t === "series") addLink(m.homepage, "Official site");
  if (links.length) h += '<div class="links">' + links.join("") + "</div>";

  var watch = providerLines(a);
  if (watch.length) {
    h += '<div class="section-label">Where to watch' + (a.region ? " in " + esc(a.region) : "") + "</div>" +
      '<dl class="facts">' + watch.map(function (w) { return "<dt>" + esc(w[0]) + "</dt><dd>" + esc(w[1]) + "</dd>"; }).join("") + "</dl>";
  }

  if (item.synopsis) {
    h += '<div class="section-label">' + (t === "post" ? "Post" : "About") + '</div><p class="synopsis">' + esc(item.synopsis) + "</p>";
  }

  var facts = [];
  if (m.rating) facts.push(["Rating", Math.round(Number(m.rating) * 10) / 10 + " / 10"]);
  else if (m.average_rating) facts.push(["Rating", Math.round(Number(m.average_rating) * 10) / 10 + " / 5"]);
  if (t === "book" && m.publisher) facts.push(["Publisher", m.publisher]);
  if (m.view_count) facts.push(["Views", compact(m.view_count)]);
  if (m.like_count) facts.push(["Likes", compact(m.like_count)]);
  if (m.score) facts.push(["Upvotes", compact(m.score)]);
  if (m.comment_count) facts.push(["Comments", compact(m.comment_count)]);
  if (m.published_at) facts.push(["Published", niceDate(m.published_at)]);
  if (facts.length) {
    h += '<div class="section-label">Details</div><dl class="facts">' +
      facts.map(function (f) { return "<dt>" + esc(f[0]) + "</dt><dd>" + esc(f[1]) + "</dd>"; }).join("") + "</dl>";
  }

  var tags = list(m.genres).concat(list(m.categories)).slice(0, 8);
  if (tags.length) {
    h += '<div class="section-label">Genres</div><div class="tags">' +
      tags.map(function (g) { return '<span class="tag">' + esc(g) + "</span>"; }).join("") + "</div>";
  }

  h += '<div class="sheet-tools">' +
    '<button type="button" class="ghost-btn" data-action="refresh">' + icon("i-reload") + "Refresh details</button>" +
    '<button type="button" class="ghost-btn" data-action="rename">' + icon("i-pencil") + "Rename</button>" +
    '<button type="button" class="ghost-btn" data-action="retype">' + icon("i-tag") + "Change type</button>" +
    '<button type="button" class="ghost-btn danger" data-action="delete">' + icon("i-trash") + "Delete</button>" +
    '</div><div id="sheetForm"></div><div class="line-status" id="sheetStatus" role="status" aria-live="polite"></div>';
  byId("modalBody").innerHTML = h;
}

function openDetail(item, pick) {
  state.openId = item.id;
  state.pick = pick || null;
  renderSheet(item);
  var dialog = byId("modal");
  if (!dialog.open) {
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }
  dialog.scrollTop = 0;
  byId("modalBody").scrollTop = 0;
}
function closeDetail() {
  var dialog = byId("modal");
  if (typeof dialog.close === "function") dialog.close();
  else { dialog.removeAttribute("open"); onDetailClosed(); }
}
function onDetailClosed() {
  state.openId = null;
  state.pick = null;
  byId("sheetArt").innerHTML = "";
}
function sheetMessage(text, kind) {
  var el = byId("sheetStatus");
  if (el) setLine(el, text, kind);
}
function clearSheetForm() {
  var form = byId("sheetForm");
  if (form) form.innerHTML = "";
}
// The server says the item is gone (deleted elsewhere, or merged into another
// by a refresh). Drop it here too rather than leave a card that cannot open.
function dropMissing(id) {
  state.items = state.items.filter(function (item) { return item.id !== id; });
  closeDetail();
  render();
  setLine(byId("submitToast"), ERRORS.not_found, "error");
}

async function setStatus(item, status, button) {
  if (item.status === status) return;
  var buttons = Array.prototype.slice.call(button.parentElement.querySelectorAll(".seg"));
  buttons.forEach(function (b) { b.disabled = true; b.setAttribute("aria-pressed", String(b === button)); });
  var r = await api("/items/" + item.id + "/status", { method: "PATCH", body: { status: status } });
  buttons.forEach(function (b) { b.disabled = false; });
  if (!r.ok) {
    if (r.status === 404) return dropMissing(item.id);
    buttons.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-status") === item.status)); });
    sheetMessage(errorText(r), "error");
    return;
  }
  replaceItem(r.data.item);
  render();
  sheetMessage("Moved to " + STATUS[status] + ".", "ok");
  button.focus();
}

async function refreshDetails(item, button) {
  button.disabled = true;
  sheetMessage("Looking for fresh details...", "");
  var r = await api("/items/" + item.id + "/refresh", { method: "POST" });
  button.disabled = false;
  if (!r.ok) {
    if (r.data.error === "not_found") return dropMissing(item.id);
    sheetMessage(errorText(r), r.data.error === "no_new_data" ? "" : "error");
    return;
  }
  // A refresh can merge this item into an existing one with the enriched
  // title, in which case the original id no longer exists.
  if (!r.data.item) { closeDetail(); await loadItems(); return; }
  replaceItem(r.data.item);
  render();
  renderSheet(r.data.item);
  sheetMessage("Details updated.", "ok");
}

function showRename(item) {
  byId("sheetForm").innerHTML = '<form class="inline-form" data-form="rename">' +
    '<label class="sr-only" for="renameInput">New title</label>' +
    '<input class="field" id="renameInput" value="' + esc(item.title) + '" required>' +
    '<button class="btn-primary" type="submit">Save title</button>' +
    '<button class="text-btn" type="button" data-action="cancel">Cancel</button></form>';
  var input = byId("renameInput");
  input.focus();
  input.select();
}

function showRetype(item) {
  var options = TYPE_ORDER.map(function (t) {
    return '<option value="' + t + '"' + (t === typeOf(item) ? " selected" : "") + ">" + TYPES[t].one + "</option>";
  }).join("");
  byId("sheetForm").innerHTML = '<form class="inline-form" data-form="retype">' +
    '<label class="sr-only" for="retypeSelect">Type</label>' +
    '<select class="field" id="retypeSelect">' + options + "</select>" +
    '<button class="btn-primary" type="submit">Change type</button>' +
    '<button class="text-btn" type="button" data-action="cancel">Cancel</button></form>';
  byId("retypeSelect").focus();
}

function confirmDelete(item) {
  byId("sheetForm").innerHTML = '<div class="inline-form"><span class="confirm-text">Delete “' + esc(item.title) +
    "” from your list? This can't be undone.</span>" +
    '<button class="btn-danger" type="button" data-action="confirm-delete">Delete</button>' +
    '<button class="text-btn" type="button" data-action="cancel">Keep it</button></div>';
}

async function doDelete(item, button) {
  button.disabled = true;
  var r = await api("/items/" + item.id, { method: "DELETE" });
  if (!r.ok && r.status !== 404) {
    button.disabled = false;
    sheetMessage(errorText(r), "error");
    return;
  }
  state.items = state.items.filter(function (i) { return i.id !== item.id; });
  closeDetail();
  render();
  setLine(byId("submitToast"), "Deleted “" + item.title + "”.", "");
}

async function submitSheetForm(form) {
  var item = findItem(state.openId);
  if (!item) return;
  var kind = form.getAttribute("data-form");
  var body = kind === "rename" ? { title: byId("renameInput").value.trim() } : { media_type: byId("retypeSelect").value };
  if (kind === "rename" && (!body.title || body.title === item.title)) { clearSheetForm(); return; }
  var submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  var r = await api("/items/" + item.id, { method: "PATCH", body: body });
  submit.disabled = false;
  if (!r.ok) {
    if (r.status === 404) return dropMissing(item.id);
    sheetMessage(errorText(r), "error");
    return;
  }
  replaceItem(r.data.item);
  render();
  renderSheet(r.data.item);
  sheetMessage(kind === "rename" ? "Renamed." : "Type changed.", "ok");
}

// --- Surprise me / Something short ---
// The server scores and picks. Each call excludes whatever was picked last, so
// tapping again moves on instead of returning the same thing; the server
// ignores the exclusion when it would leave nothing.
async function pick(mode, fromSheet) {
  var buttons = [byId("pickToday"), byId("pickShort")];
  buttons.forEach(function (b) { b.disabled = true; });
  var note = byId("pickNote");
  if (!fromSheet) note.textContent = "Picking...";
  var exclude = state.openId || state.lastPickId;
  var r = await api("/pick?mode=" + mode + (exclude ? "&exclude=" + encodeURIComponent(exclude) : ""));
  buttons.forEach(function (b) { b.disabled = false; });
  if (!r.ok) {
    if (fromSheet) sheetMessage(errorText(r), "error");
    else note.textContent = errorText(r);
    return;
  }
  note.textContent = "";
  state.lastPickId = r.data.item.id;
  replaceItem(r.data.item);
  openDetail(findItem(r.data.item.id) || r.data.item, { mode: r.data.mode, candidates: r.data.candidates });
}

// --- Share sheet intake ---
// /share redirects here with ?prefill=<shared url>. Fill the box so the user
// confirms before saving, and preselect Post for an X or Reddit link.
function applySharePrefill() {
  var raw = new URLSearchParams(location.search).get("prefill");
  var value = raw ? raw.trim() : "";
  if (!value) return;
  var input = byId("submitInput");
  input.value = value;
  var host = "";
  try { host = new URL(value).hostname.toLowerCase(); } catch (err) { host = ""; }
  if (host.indexOf("www.") === 0) host = host.slice(4);
  var reddit = host === "reddit.com" || host === "redd.it" || host.slice(-11) === ".reddit.com";
  if (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com" || reddit) setSubmitType("post", true);
  try { input.focus(); } catch (err) { /* focus can fail in a background tab */ }
  setLine(byId("submitToast"), "Shared from another app. Check it and press Save.", "");
  try { history.replaceState(null, "", location.pathname); } catch (err) { /* keep the query, harmless */ }
}

function setSubmitType(value, remember) {
  var select = byId("submitType");
  if (!Array.prototype.some.call(select.options, function (o) { return o.value === value; })) value = "auto";
  select.value = value;
  select.classList.toggle("type-set", value !== "auto");
  if (remember) writePref("lh_submit_type", value);
}

// --- Wiring ---

byId("submitForm").addEventListener("submit", async function (e) {
  e.preventDefault();
  var input = byId("submitInput");
  var button = byId("submitBtn");
  var line = byId("submitToast");
  var text = input.value.trim();
  if (!text) { setLine(line, ERRORS.text_required, "error"); input.focus(); return; }
  var type = byId("submitType").value;
  button.disabled = true;
  button.textContent = "Saving...";
  setLine(line, "Looking it up" + (type === "auto" ? "" : " as " + TYPES[type].one.toLowerCase()) + "...", "");
  var r = await api("/items", { method: "POST", body: { text: text, media_type: type } });
  button.disabled = false;
  button.textContent = "Save";
  if (!r.ok || !r.data.item) {
    setLine(line, errorText(r), "error");
    input.focus();
    return;
  }
  var item = r.data.item;
  replaceItem(item, true);
  input.value = "";
  render();
  line.className = "line-status is-ok";
  line.innerHTML = "Saved “" + esc(item.title) + "” to " + esc(TYPES[typeOf(item)].many) + '. <button type="button" class="linklike" data-open="' + item.id + '">Open</button>';
});

byId("submitToast").addEventListener("click", function (e) {
  var button = e.target.closest("[data-open]");
  var item = button ? findItem(Number(button.getAttribute("data-open"))) : null;
  if (item) openDetail(item);
});

byId("submitType").addEventListener("change", function () { setSubmitType(byId("submitType").value, true); });

byId("tabs").addEventListener("click", function (e) {
  var chip = e.target.closest(".chip");
  if (!chip) return;
  state.type = chip.getAttribute("data-type") || "";
  // Browsing a type makes it the type for the next save, so adding a book
  // while looking at books does not get classified as something else.
  setSubmitType(state.type && state.type !== "unknown" ? state.type : "auto", false);
  render();
  var again = byId("tabs").querySelector('[data-type="' + state.type + '"]');
  if (again) again.focus();
});

(function setupStatusFilter() {
  var select = byId("statusFilter");
  select.innerHTML = Object.keys(VIEWS).map(function (key) {
    return '<option value="' + key + '">' + VIEWS[key].label + "</option>";
  }).join("");
  select.value = state.view;
  select.addEventListener("change", function () {
    state.view = select.value;
    writePref("lh_view", state.view);
    render();
  });
})();

(function setupSearch() {
  var timer = null;
  byId("search").addEventListener("input", function (e) {
    clearTimeout(timer);
    timer = setTimeout(function () { state.query = e.target.value; render(); }, 120);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && !isTyping(e.target) && !byId("modal").open) {
      e.preventDefault();
      byId("search").focus();
    }
  });
})();

byId("grid").addEventListener("click", function (e) {
  var action = e.target.closest("[data-action]");
  if (action) {
    if (action.getAttribute("data-action") === "reload") loadItems();
    if (action.getAttribute("data-action") === "clear") {
      state.type = "";
      state.query = "";
      state.view = "next";
      byId("search").value = "";
      byId("statusFilter").value = "next";
      writePref("lh_view", "next");
      setSubmitType(readPref("lh_submit_type", "auto"), false);
      render();
    }
    return;
  }
  var card = e.target.closest(".card");
  var item = card ? findItem(Number(card.getAttribute("data-id"))) : null;
  if (item) openDetail(item);
});
byId("grid").addEventListener("error", handleImageError, true);
byId("sheetArt").addEventListener("error", handleImageError, true);

byId("modal").addEventListener("click", function (e) {
  // A click on the dialog element itself is a click on the backdrop.
  if (e.target === e.currentTarget) { closeDetail(); return; }
  var button = e.target.closest("button");
  var item = findItem(state.openId);
  if (!button || !item) return;
  var status = button.getAttribute("data-status");
  if (status) { setStatus(item, status, button); return; }
  var action = button.getAttribute("data-action");
  if (action === "pick-again" && state.pick) pick(state.pick.mode, true);
  else if (action === "refresh") refreshDetails(item, button);
  else if (action === "rename") showRename(item);
  else if (action === "retype") showRetype(item);
  else if (action === "delete") confirmDelete(item);
  else if (action === "confirm-delete") doDelete(item, button);
  else if (action === "cancel") clearSheetForm();
});
byId("modal").addEventListener("submit", function (e) {
  e.preventDefault();
  submitSheetForm(e.target);
});
byId("modal").addEventListener("close", onDetailClosed);
byId("modalClose").addEventListener("click", closeDetail);

byId("pickToday").addEventListener("click", function () { pick("today", false); });
byId("pickShort").addEventListener("click", function () { pick("short", false); });
byId("refreshBtn").addEventListener("click", function () { loadItems(); });

byId("themeBtn").addEventListener("click", function () {
  var root = document.documentElement;
  var current = root.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  var next = current === "light" ? "dark" : "light";
  root.setAttribute("data-theme", next);
  writePref("lh_theme", next);
  byId("themeColor").setAttribute("content", next === "light" ? "#f5f3ee" : "#0d1017");
});

byId("logoutBtn").addEventListener("click", async function () {
  var r = await api("/auth/logout", { method: "POST" });
  // Under Cloudflare Access the server names Access's own sign-out address.
  var next = r.data && r.data.redirect;
  location.href = typeof next === "string" && next.charAt(0) === "/" ? next : "/login";
});

// Coming back to the app (after sharing into it from another app, say) shows
// the current list rather than whatever was loaded an hour ago.
document.addEventListener("visibilitychange", function () {
  if (document.visibilityState === "visible" && state.loadedAt && Date.now() - state.loadedAt > 60000) loadItems();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function (err) { /* the app works without it */ });
  });
}

setSubmitType(readPref("lh_submit_type", "auto"), false);
applySharePrefill();
loadItems();
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
