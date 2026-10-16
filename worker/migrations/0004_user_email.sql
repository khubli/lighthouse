-- Cloudflare Access sign-in.
--
-- With Access in front of the Worker, a person is identified by the email
-- Access verified, not by a PIN. Each account can be linked to one email; the
-- link is made once, by entering the account's name and PIN on the "connect
-- your list" page (or with `npm run users -- link`).
--
-- Stored lower-case. UNIQUE so one email can never open two lists; SQLite
-- allows any number of NULLs, so unlinked accounts are unaffected.

ALTER TABLE users ADD COLUMN email TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
