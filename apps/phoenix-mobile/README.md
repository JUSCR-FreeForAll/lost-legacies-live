# Phoenix Fortress Mobile

Installable mobile-first web interface (PWA) for the independent Phoenix Fortress service. It is deliberately a **read-only integration shell** until the separate Fortress backend has passed security and recovery verification.

## Deploy a preview

Create a Vercel project from `JUSCR-FreeForAll/lost-legacies-live` and set its **Root Directory** to `apps/phoenix-mobile`. Framework preset: **Other**. No environment variables or build command are required. Deploy the feature branch as a preview, not production.

You can also serve this folder with any static HTTPS host. For local development, run `python3 -m http.server 8000 --directory apps/phoenix-mobile` from the repository root.

## What works

- Responsive navigation at phone and desktop sizes, keyboard and screen-reader labels.
- Installable PWA app shell, available offline after its first visit.
- A user-initiated, read-only `GET` to an explicitly entered health endpoint (full HTTPS URL), with timeout, failure, and RECOVERY_REQUIRED states. The URL is held only in the current tab's `sessionStorage`.
- Clear warnings and safe-path guidance for consent-based digital recovery.

## What is intentionally gated

The UI **does not** create or extract backups, initiate a restore, manage credentials, offer security guarantees, or claim ledger verification. It never handles a master recovery key or backup extraction key. The backend in `phoenix-fortress/` on this integration branch is only an interoperability adapter, not a verified production recovery engine. These privileged operations must not be turned on until an authenticated API, least-privilege authorization, distinct keys, encrypted recovery packs, fail-closed chain verification, signed checkpoints, durable logs that exclude secrets, rate limiting, tested restores, and a complete threat review exist.

The `GET /health` endpoint must implement CORS if it is on a different origin. A remote response reporting `READY` is displayed as a service claim, **not** as independent proof. The interface never automatically calls the backend or silently tracks contacts or location.

## Verification

Run `node --check apps/phoenix-mobile/app.js` and `node --check apps/phoenix-mobile/sw.js`, then check the layout in a mobile browser and confirm install/offline behavior. Verify the health button against a test server that returns READY, RECOVERY_REQUIRED, malformed JSON, an HTTP error, and a timed-out request. Confirm backup/recovery controls remain disabled in every state.
