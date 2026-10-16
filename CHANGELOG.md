# Changelog

## 1.0.0

First public release. Lighthouse is one list for everything you mean to watch, read or listen to, and the posts that told you to.

- **One list for every kind of thing:** films, series, books, podcasts, YouTube videos, music, and X and Reddit posts, with the same five statuses (Inbox, Interested, In progress, Done, Dropped).
- **Share from any app.** It installs as an app, and on Android it sits in every app's share sheet. An X or Reddit link is saved as the post itself, or, if you pick another type, used to find the film or book it recommends.
- **Links become things.** X posts through FxTwitter (author, text, image); Reddit posts through Reddit's embed endpoint (title, author, subreddit), share links from the Reddit app included; any other page through its title and description. A post that can't be read asks for a note instead of saving a bare link.
- **Bring your own AI key, or none.** Claude (`ANTHROPIC_API_KEY`), any OpenRouter model (`OPENROUTER_API_KEY`), or any OpenAI-compatible API including a local one (`OPENAI_BASE_URL`), chosen by which key is set or by `AI_PROVIDER`. Without a key, or when the model is slow, down or declines, built-in rules sort what you save.
- **Details from the source:** TMDB with where to watch in your country, Google Books then Open Library, gpodder, YouTube.
- **Surprise me and Something short** pick one thing to start tonight.
- **Sign in with Cloudflare Access,** where each person's email opens their own list, or with a name and PIN (PBKDF2, 100,000 rounds).
- **On your own domain,** or on `workers.dev`; deploy from your machine or with the [GitHub Action](action.yml) from a private repository ([examples/instance](examples/instance/README.md)).
- **Light and dark themes,** an offline-safe service worker that never caches your list, and a demo with made-up titles.
- **Tested offline:** the real Worker runs in Miniflare against an in-memory database, with recorded provider responses; the docs are checked against the code.

Before 1.0, Lighthouse ran privately for its author.
