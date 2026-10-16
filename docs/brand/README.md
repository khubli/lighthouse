# Lighthouse brand

One look everywhere Lighthouse appears: the app, the installed icon, the sign-in page, the repository.

## Mark

A lighthouse whose beam is three list lines: the app is a list you shine a light on.

| File | Use |
|---|---|
| [`worker/src/assets/icon.svg`](../../worker/src/assets/icon.svg) | Master. README, and the same drawing is inlined in the app as an SVG symbol ([`theme.ts`](../../worker/src/theme.ts)) |
| `icon-192.png`, `icon-512.png` | Browser tab, Android and desktop app icon (rounded square) |
| `icon-maskable-512.png` | Android adaptive icon: full-bleed, mark inside the safe zone |
| `apple-touch-icon.png` | iPhone and iPad home screen (square; iOS rounds the corners) |
| [`social-preview.png`](social-preview.png) | 1280×640 share image for the GitHub social preview, rendered from [`social-preview.html`](social-preview.html) |

The PNGs are rendered from the SVG; after changing the mark, re-render them at the sizes above and run `node scripts/build-pwa.mjs`, which embeds them in the Worker. Keep the mark on its night-blue square; don't recolour or outline it.

## Colour

Defined once in [`worker/src/theme.ts`](../../worker/src/theme.ts) and shared by every page.

| Token | Dark | Light | Where |
|---|---|---|---|
| Background | `#0D1017` | `#F5F3EE` | page, app status bar and splash (`theme-color`, manifest) |
| Surface | `#151923` | `#FFFFFF` | inputs, the detail sheet, the sign-in card |
| Ink | `#ECEEF4` | `#191B22` | text |
| Muted | `#A4AABB` | `#535866` | secondary text (AA contrast on the background) |
| Beam (accent) | `#FBBF24` | `#F59E0B` | primary buttons, the current status, numbers in the headline |
| Accent text | `#FCD34D` | `#8A4B06` | links and highlighted text (AA contrast) |
| Mark background | `#131722` | `#131722` | the icon's square, in both themes |

Each type has its own colour, used as a dot beside its name and never on its own: Movie blue, Series violet, Book green, Podcast amber, Video red, Music pink, Post (X and Reddit) sky.

## Type

The system's own UI font (San Francisco, Segoe UI, Roboto, or Inter where installed), so the app loads no fonts and makes no third-party requests for them. Headlines 700 with slightly tightened tracking; body 400 to 600.

## Voice

Plain and specific, written to you: "12 waiting, 3 in progress", "Saved “Dune” to Movies.", "That name and PIN don't match an account." Say what happened and what to do next. No hype, no exclamation marks, and never a vague "Something went wrong" when the reason is known.
