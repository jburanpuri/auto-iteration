# Public repository and demo access

The repository includes source code and an empty `.env.example` template. Real `.env` files, `hosted/.env.local`, `.local/` data and tokens, SQLite databases, private keys, and Vercel linkage are ignored. Do not upload a zip of the working directory: publish the Git repository, which excludes ignored files.

The hosted demo requires its private `DEMO_ACCESS_CODE` for all actions that queue work: POST `/api/feedback`, POST `/api/workflow/start`, and POST `/api/workflow/reset`. The code is set in Vercel's encrypted environment and is never embedded in browser assets. POST `/api/session` checks it and creates an HttpOnly, Secure, SameSite=Strict cookie. The browser keeps the session for one day. Changing the code invalidates existing cookies. Missing configuration fails closed. Product and review pages remain readable without a code.

The feedback form asks for the code only if its session is missing or invalid. No OpenAI key is entered into the site. Codex credentials remain in the operator's local Codex account directory; the Node worker uses that login. A clone of this repository does not include or grant access to that account. Contributors must use their own Codex login and their own Discord/Vercel credentials.

The localhost engineer console trusts the local operator and is bound to loopback. Do not expose it through a tunnel or bind it to a public interface. Discord approvals are restricted to configured engineer IDs. The website has no public approval endpoint.

Before publishing, inspect `git ls-files`, audit reachable Git history for secrets, and keep only empty/example configuration in Git. If a credential is ever committed, rotate it with its provider; deleting the file alone does not remove it from history. Neither this audit nor ignore rules guarantee that future commits are secret-free.

Audit on September 12, 2026: 190 reachable historical file objects checked against the locally configured credential values and common private-key/API-token patterns; no matches. No tracked secret files or history of `.env`, `hosted/.env.local`, or `.local/` were found. Git history did not require rewriting.
