# Vicu website

The website is this folder: plain HTML (`index.html`), one stylesheet (`assets/css/site.css`), one
small script (`assets/js/site.js`) and WebP screens. There is no build step, it uses the system
font, and it loads nothing from other sites.

## Preview

```bash
npm run site
```

Then open http://127.0.0.1:8096/ (or pass another port: `node site/tools/serve.mjs 8100`).

Before publishing, run `npm run site:check`. It checks every local link, image, `#anchor` and id
reference, alt text and image sizes, and that nothing loads from another site.

## The guide

The guide at https://vicutodo.app/guide/ is written in Markdown in `docs/guide/` (one file per page,
`pro/*.md` for the Pro pages) and turned into static pages by a small generator:

```bash
npm run site:guide
```

It writes `site/guide/<page>/index.html` and the search index `assets/js/guide-index.js`; commit
both with the Markdown. Never edit the generated pages. `npm run site:check` fails when they are out
of date with `docs/guide/`, when a `guide:` link or `#anchor` points nowhere, or when a page is
missing from the contents.

- **Contents**: the order and sections are `NAV` at the top of `site/tools/guide.mjs`. A new page
  needs an entry there.
- **A page** starts with front matter (`title`, `description`, `lead`, optional `nav` for a shorter
  sidebar name), opens with `## In short`, then the tasks, then details, and ends with `## Related`.
- **Syntax** beyond plain Markdown: links between pages as `[text](guide:slug#heading)`, platform
  badges `{desktop}` `{android}` `{ios}` `{phone}` `{all}` `{pro}`, callouts (`> [!NOTE]`, `TIP`,
  `PRO`, `WARNING`, `PHONE`, `DESKTOP`), `:::cards` and `:::steps` blocks, and screens as
  `![alt](screen:desktop-today.webp "caption")` (the dark twin is found by name).
- **Writing**: plain words, second person, the app's own labels in bold, no emojis. Say where each
  feature works.

The site workflow also runs on changes to `docs/guide/`.

## Screens

Screens show the seeded, made-up data of the UI harness (`scripts/ui-verify/seed.mjs`). To replace
them, keep the names.

- **Desktop** (`desktop-<name>.webp`, `desktop-<name>-dark.webp`): run the `site-screens` scenario in
  both themes at twice the scale, then convert:

  ```bash
  node scripts/ui-verify/seed.mjs
  npm run ui:verify -- --scenario site-screens --scale 2 --size 1280x800 --theme light --run site-light
  npm run ui:verify -- --scenario site-screens --scale 2 --size 1280x800 --theme dark --run site-dark
  node site/tools/screens.mjs desktop scripts/ui-verify/out/site-light scripts/ui-verify/out/site-dark
  ```

- **Phones** (`android-<screen>-<theme>.webp`, `ios-<screen>-<theme>.webp`): captures from the
  `vicu-android` harness (`scripts/ui-verify/shots.mjs` on the emulator) and the iOS simulator
  (`xcrun simctl io booted screenshot`), against the same seeded server. Put the PNGs in one folder
  and run `node site/tools/screens.mjs mobile <folder>`.

`screens.mjs` needs `cwebp` (`brew install webp`).

## Publish with GitHub Pages

The site lives at https://vicutodo.app/ (`canonical`, `og:url` and `og:image` in `index.html` use
it). `.github/workflows/site.yml` checks the site and publishes this folder on every push to `main`
that changes it (or by hand from the Actions tab). A deploy from Actions needs no `CNAME` file; the
domain is a repository setting.

1. In the repository on GitHub: **Settings, Pages, Build and deployment, Source: GitHub Actions**,
   then **Custom domain: vicutodo.app**.
2. DNS for `vicutodo.app` is on Cloudflare. Add, all **DNS only** (grey cloud, not proxied, or
   GitHub cannot issue the certificate):
   - `A` `@` to `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `AAAA` `@` to `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`,
     `2606:50c0:8003::153`
   - `CNAME` `www` to `rendyhd.github.io` (GitHub then redirects www to the apex)
3. Once the DNS check passes and the certificate is issued, tick **Enforce HTTPS**. `.app` domains
   only work over HTTPS, so the site does not load at all until then.
4. Optional, against takeover of the domain: verify it under your GitHub account, **Settings,
   Pages, Add a domain**, with the `TXT` record GitHub shows.
