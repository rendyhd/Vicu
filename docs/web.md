# Vicu web: hosting it yourself

Vicu web is the desktop app's main window as a website. You run it as a container next to your
Vikunja server and open it in a desktop browser. It is for a computer where you cannot or may not
install an app; on your own computer the desktop app does more.

This page is for the person who hosts it. What it is like to use is in the user guide
(`docs/guide/web.md`, "Vicu in a browser").

## What it is, and is not

- The same lists, projects, Plan screen, Events, routines, custom lists, comments, sharing, guided
  sessions and Pro as the desktop app, reading the same account.
- For desktop browsers (a current Chrome, Edge, Firefox or Safari). It is not laid out for phones;
  use the Android or iOS app there.
- It needs the server: there is no offline queue and no standalone mode. A change made while the
  server cannot be reached fails and says so.
- Not in it: the assistant, voice input, connected calendars (your own Events and importing a
  calendar file are), Quick Entry and Quick View, the browser extension and Obsidian links, the
  update check. Reminders show as browser notifications while a Vicu tab is open.
- It keeps no data of its own on the server. The container is static files and a proxy; everything
  lives in Vikunja and, for settings of that browser, in the browser.

## How it fits together

```
browser ──HTTPS──> your reverse proxy ──HTTP──> vicu-web container (nginx, port 8080)
                                                   ├── /            the app (static files)
                                                   └── /api/  ───>  your Vikunja server
```

The app and the Vikunja API must be on **one origin**. The app sends every request to its own
address, and the session cookie Vikunja sets at sign-in only goes back there. That is why the
container forwards `/api/` to Vikunja instead of the app calling Vikunja's address directly, and
why the app has to be at the root of its address (not under a path such as `/vicu/`).

## Run it

With Docker Compose, next to a new Vikunja (see `docker/web/docker-compose.example.yml`):

```
docker compose -f docker/web/docker-compose.example.yml up -d
```

Next to a Vikunja you already run, behind Traefik: `docker/web/docker-compose.traefik.example.yml`
(the address, the entry point and the shared network are the three things to change). Or with
any other reverse proxy:

```
docker run -d --name vicu-web -p 8080:8080 \
  -e VIKUNJA_URL=http://vikunja:3456 \
  ghcr.io/rendyhd/vicu-web:latest
```

Or build the image from a checkout (the only way until an image has been published to `ghcr.io`):

```
docker build -f docker/web/Dockerfile -t vicu-web .
```

| Variable | Default | Meaning |
|---|---|---|
| `VIKUNJA_URL` | `http://vikunja:3456` | Where the container reaches Vikunja: scheme, host and port, no path and no trailing slash. An internal address is fine; browsers never see it. |
| `VICU_MAX_UPLOAD` | `25m` | The largest attachment the proxy lets through (nginx `client_max_body_size`). Keep it at or above Vikunja's own limit (`files.maxsize`, 20 MB by default). |

The container listens on port 8080 as an unprivileged user and answers `GET /healthz` with `ok`
without asking Vikunja. It can run with a read-only file system and no capabilities, given two
places to write: `/tmp` and `/etc/nginx/conf.d` (owned by user 101), as the compose example shows.
Vikunja's address is looked up again while the container runs, so Vikunja can be restarted or
recreated without restarting Vicu web.

## TLS and your reverse proxy

Put your own reverse proxy with TLS in front of the container and send the whole site to it. Use
HTTPS for anything but a test on your own machine: browsers only offer notifications and the
clipboard on HTTPS (or `localhost`), and a sign-in over plain HTTP can be read on the way.

- Forward `X-Forwarded-Proto` and `X-Forwarded-For` (Traefik, Caddy and nginx Proxy Manager do).
  `X-Forwarded-Proto: https` is how the container knows the visitor used HTTPS: it then tells the
  browser to never use plain HTTP for the address again (HSTS) and marks Vikunja's session cookie
  `Secure`. Without that header neither happens.
- Do not also publish the container's port 8080 to the internet: it is plain HTTP, and anyone who
  reaches it directly could claim to have come over HTTPS.
- Vikunja's own public address (`service.publicurl`) can stay what it is. With a new Vikunja that
  only Vicu web uses, set it to the address of this container.
- If Vikunja's own web interface is also reachable, on another address, both keep working. They
  are separate sign-ins.

## Signing in

People sign in the way your Vikunja allows: username and password (with a TOTP code when the
account has one), your OIDC provider, or an API token.

**OIDC.** The browser goes to your provider and comes back to
`https://<your vicu address>/auth/openid/<provider key>`. Add that address to the allowed redirect
addresses of the Vikunja client at your provider, next to the one Vikunja's own interface uses. The
provider key is the one in Vikunja's `auth.openid.providers` configuration. Passkeys and security
keys work, because the sign-in happens in the browser itself.

**What is kept where.**

- A password or OIDC sign-in is a Vikunja session: a short-lived token that lives in the page's
  memory only, renewed with a cookie that only the browser can read (`HttpOnly`, sent only to the
  renewal address). Nothing that signs you in is written to the browser's storage. The session
  lasts as long as Vikunja's refresh lifetime (30 days by default) and ends with Sign Out.
- An API token is kept for that browser tab's session, and only for longer when the person ticks
  "Remember on this browser" at setup. On a computer that is not theirs they should leave it
  unticked, or use a password or OIDC sign-in instead.
- Settings of that browser (theme, sidebar) and a copy of the account's synced documents (custom
  lists, the person's own Events, the Pro ledger, the Inbox choice) are in the browser's IndexedDB
  while they are signed in. Tasks, notes and comments are never stored there. Signing out clears
  everything that belongs to the account.

## Security headers

The container sends a Content-Security-Policy that allows scripts, styles, fonts, images and
requests from its own origin only, forbids framing, and sends `nosniff`, `no-referrer` and a closed
Permissions-Policy (`docker/web/security-headers.conf`). If your reverse proxy adds headers of its
own, do not loosen these. Attachments are never shown as pages of the site: a picture, PDF or text
file opens in a new tab from memory, everything else is downloaded.

## What to know before putting it on the internet

- **It adds no way into your data that Vikunja does not already have.** Everything goes through
  Vikunja's API with Vikunja's sign-in; the container holds no accounts, no secrets and no data.
  If your Vikunja is reachable from the internet, Vicu web exposes nothing more. If it is not,
  publishing Vicu web publishes Vikunja's API with it.
- **Sign-in attempts are limited by Vikunja**, not by this container. Keep Vikunja's rate limit on,
  or put your proxy's in front.
- **A page in a browser is one program.** On the desktop a hidden part of the app holds your
  sign-in; in a browser the page holds it. The content policy above is what stands between a task
  someone else wrote and that sign-in: scripts only ever load from the site itself. Keep the
  headers as they are, and keep the image up to date.
- **The address a single sign-on comes back to carries a one-time code.** The container leaves it
  out of its access log; make sure your reverse proxy's log is not public either.
- **People on a shared computer must sign out.** Closing the tab does not end a password or
  single sign-on session.

## Updating

Pull the new image and start the container again. The page itself is never cached, so the next
load is the new version; a tab that was left open loads it when it needs a part that changed.
The web version and the desktop and mobile apps read the same account in the same way, so they
can be on different versions; update them in any order.

## Developing

```
npm run dev:web        # the page with hot reload on http://localhost:5175, /api forwarded to
                       # VICU_WEB_API (default http://127.0.0.1:3456, the local test server)
npm run build:web      # out/web
npm run start:web      # serves out/web the same way
node scripts/ui-verify/web.mjs   # the browser harness (see scripts/ui-verify/README.md)
```

How the web version is built from the desktop's code is in `CLAUDE.md`, "Web version".
