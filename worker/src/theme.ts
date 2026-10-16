/**
 * Shared look for every page the Worker serves: colour tokens for light and
 * dark, the brand mark and icons as an inline SVG sprite, and the tiny script
 * that applies a saved theme before first paint.
 *
 * These are TS template literals that end up inside other template literals,
 * so the same rules apply as in dashboard.ts: no backticks, no dollar-brace,
 * no backslashes.
 */

// Light values, written once and used twice: for "follow the system" when the
// system is light, and for an explicit choice of light.
const LIGHT_TOKENS = `
    color-scheme: light;
    --bg: #f5f3ee; --surface: #ffffff; --surface-2: #f0ede6;
    --line: #e4e0d6; --line-strong: #d0cbbe;
    --ink: #191b22; --muted: #535866; --faint: #6b7080;
    --accent: #f59e0b; --accent-strong: #d97706; --accent-ink: #8a4b06; --on-accent: #1c1404;
    --accent-soft: #fdf0d2; --focus: #d97706;
    --danger: #b42318; --danger-soft: #fde8e6; --ok: #067647;
    --shadow: 0 1px 2px rgba(20, 20, 30, .07), 0 6px 18px rgba(20, 20, 30, .08);
    --shadow-lift: 0 2px 4px rgba(20, 20, 30, .08), 0 14px 30px rgba(20, 20, 30, .14);
    --t-movie: #2563eb; --t-series: #7c3aed; --t-book: #047857; --t-podcast: #b45309;
    --t-youtube: #dc2626; --t-song: #db2777; --t-post: #0284c7; --t-unknown: #6b7280;`;

export const THEME_TOKENS_CSS = `
  :root {
    color-scheme: dark;
    --bg: #0d1017; --surface: #151923; --surface-2: #1d2230;
    --line: #262c3c; --line-strong: #363d52;
    --ink: #eceef4; --muted: #a4aabb; --faint: #8a90a4;
    --accent: #fbbf24; --accent-strong: #f59e0b; --accent-ink: #fcd34d; --on-accent: #1c1404;
    --accent-soft: rgba(251, 191, 36, .13); --focus: #fcd34d;
    --danger: #f87171; --danger-soft: rgba(248, 113, 113, .14); --ok: #34d399;
    --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 6px 18px rgba(0, 0, 0, .3);
    --shadow-lift: 0 2px 4px rgba(0, 0, 0, .45), 0 16px 34px rgba(0, 0, 0, .45);
    --t-movie: #60a5fa; --t-series: #a78bfa; --t-book: #34d399; --t-podcast: #fbbf24;
    --t-youtube: #f87171; --t-song: #f472b6; --t-post: #38bdf8; --t-unknown: #9ca3af;
  }
  @media (prefers-color-scheme: light) {
    :root:not([data-theme="dark"]) {${LIGHT_TOKENS}
    }
  }
  :root[data-theme="light"] {${LIGHT_TOKENS}
  }`;

/**
 * Applies a saved light/dark choice before the first paint, so a light-mode
 * user does not see a dark flash on every load. Also keeps the browser chrome
 * (theme-color) in step with the page.
 */
export const THEME_BOOT_SCRIPT = `<script>
(function () {
  var saved = null;
  try { saved = localStorage.getItem("lh_theme"); } catch (err) { saved = null; }
  if (saved === "light" || saved === "dark") document.documentElement.setAttribute("data-theme", saved);
  var light = saved === "light" || (!saved && window.matchMedia && matchMedia("(prefers-color-scheme: light)").matches);
  var meta = document.getElementById("themeColor");
  if (meta) meta.setAttribute("content", light ? "#f5f3ee" : "#0d1017");
})();
</script>`;

/**
 * The brand mark and every icon, as symbols referenced with use elements.
 *
 * The mark is a lighthouse whose beam is three list lines: the app is a list
 * you shine a light on. Same drawing as src/assets/icon.svg.
 */
export const BRAND_SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="lh-tower" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FDE68A"/><stop offset="1" stop-color="#F59E0B"/></linearGradient>
    <symbol id="lh-mark" viewBox="0 0 512 512">
      <rect width="512" height="512" rx="112" fill="#131722"/>
      <g transform="translate(-14 4)">
        <g stroke="#FBBF24" stroke-width="26" stroke-linecap="round">
          <line x1="272" y1="146" x2="410" y2="146"/>
          <line x1="272" y1="194" x2="370" y2="194"/>
          <line x1="272" y1="242" x2="392" y2="242"/>
        </g>
        <path d="M200 106 L250 156 H150 Z" fill="url(#lh-tower)"/>
        <rect x="164" y="160" width="72" height="68" rx="10" fill="#FEF3C7"/>
        <rect x="150" y="228" width="100" height="18" rx="6" fill="#F59E0B"/>
        <path d="M168 246 H232 L254 424 H146 Z" fill="url(#lh-tower)"/>
        <path d="M159 318 H241 L245 352 H155 Z" fill="#131722"/>
        <rect x="118" y="420" width="164" height="26" rx="13" fill="#F59E0B"/>
      </g>
    </symbol>
    <symbol id="i-sparkle" viewBox="0 0 24 24"><path d="M12 3l1.8 4.9L19 10l-5.2 2.1L12 17l-1.8-4.9L5 10l5.2-2.1z"/><path d="M19 16v4M17 18h4"/></symbol>
    <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></symbol>
    <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></symbol>
    <symbol id="i-reload" viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4.5H15"/></symbol>
    <symbol id="i-contrast" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/></symbol>
    <symbol id="i-close" viewBox="0 0 24 24"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></symbol>
    <symbol id="i-out" viewBox="0 0 24 24"><path d="M8 16L16 8M10 8h6v6"/></symbol>
    <symbol id="i-film" viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7.5 4.5v15M16.5 4.5v15M3.5 9h4M16.5 9h4M3.5 15h4M16.5 15h4"/></symbol>
    <symbol id="i-tv" viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="12" rx="2"/><path d="M9 20.5h6M12 17.5v3"/></symbol>
    <symbol id="i-book" viewBox="0 0 24 24"><path d="M5 4.5h11.5a2 2 0 0 1 2 2v13H7a2 2 0 0 1-2-2z"/><path d="M5 17.5a2 2 0 0 1 2-2h11.5"/></symbol>
    <symbol id="i-mic" viewBox="0 0 24 24"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/></symbol>
    <symbol id="i-play" viewBox="0 0 24 24"><rect x="3.5" y="5.5" width="17" height="13" rx="3"/><path d="M10.5 9.5l4 2.5-4 2.5z"/></symbol>
    <symbol id="i-note" viewBox="0 0 24 24"><path d="M9 17.5V6l10-2v11.5"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/></symbol>
    <symbol id="i-quote" viewBox="0 0 24 24"><path d="M4.5 5.5h15v10h-8l-4.5 3.5v-3.5H4.5z"/></symbol>
    <symbol id="i-bookmark" viewBox="0 0 24 24"><path d="M6.5 4h11v16l-5.5-3.5L6.5 20z"/></symbol>
    <symbol id="i-pencil" viewBox="0 0 24 24"><path d="M14.5 5.5l4 4L9 19H5v-4z"/></symbol>
    <symbol id="i-tag" viewBox="0 0 24 24"><path d="M4 4.5h7l8.5 8.5-6.5 6.5L4.5 11z"/><circle cx="8.5" cy="8.5" r="1.3"/></symbol>
    <symbol id="i-trash" viewBox="0 0 24 24"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7"/></symbol>
  </defs>
</svg>`;
