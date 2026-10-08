# UI verification harness (desktop)

Drives the built Vicu with `playwright-core` against a throwaway local Vikunja, with real mouse and
keyboard input, and leaves captures plus one JSON line per assertion in `out/<run>/`. It is a
developer tool: `electron-builder.yml` does not package `scripts/`, and `npm run verify` does not
run it.

Everything under `.local/` (test credentials, the API token, seed ids, app profiles) and `out/` is
git-ignored. No script prints a credential or the token.

## 1. The test server

Git Bash (the `MSYS_NO_PATHCONV` line stops Git Bash from rewriting `/tmp/...` into a Windows path):

```bash
export MSYS_NO_PATHCONV=1
SECRET=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
docker run -d --name vicu-test-vikunja -p 127.0.0.1:3456:3456 \
  -e VIKUNJA_SERVICE_PUBLICURL=http://localhost:3456/ \
  -e VIKUNJA_SERVICE_SECRET=$SECRET \
  -e VIKUNJA_FILES_BASEPATH=/tmp/files \
  -e VIKUNJA_DATABASE_PATH=/tmp/vikunja.db \
  -e VIKUNJA_SERVICE_ENABLEREGISTRATION=false \
  vikunja/vikunja:2.4.0
```

- The API is `http://127.0.0.1:3456/api/v2`. The container keeps its data until it is removed, so
  later sessions only need `docker start vicu-test-vikunja`.
- A completely fresh server: `docker rm -f vicu-test-vikunja`, then the `docker run` above.
- Users are made with `docker exec vicu-test-vikunja /app/vikunja/vikunja user create ...`;
  `seed.mjs` does this for its own test user, you do not have to.
- Other port or container: set `VICU_TEST_SERVER` (default `http://127.0.0.1:3456`) and
  `VICU_TEST_CONTAINER` (default `vicu-test-vikunja`). `VICU_UI_LOCAL` moves `.local/` elsewhere.

## 2. Seed and profiles

```bash
node scripts/ui-verify/seed.mjs       # test user, API token and the dataset
node scripts/ui-verify/profile.mjs    # .local/profile-light and .local/profile-dark
```

`seed.mjs` is idempotent and can refresh the data at any time (the dates are relative to today, so
run it again when the day changes). It makes sure the test user exists (a new password is made up
and stored in `.local/credentials.json` on the first run; if the user exists but the file is lost,
the password is reset through the container), deletes that user's projects, labels and tasks (the
default Inbox project stays, emptied), then creates:

- Areas Work and Personal with child projects (Website redesign, Q4 planning, Home renovation,
  Trip to Lisbon), the Inbox, and labels, all in Vikunja's preset colours.
- Overdue, today, timed (14:00 with a reminder), upcoming (tomorrow to six weeks out), undated,
  repeating, checklist (task list in the description), subtasks, priorities 1 to 5, a very long
  title, and finished tasks for the Logbook (the server stamps them with the time of the run).
- Review footers on the projects: reviewed recently, overdue, never, excluded, and a 30-day cadence.
- Routines are not seeded (the Routines view shows its empty state).

`profile.mjs` rebuilds the throwaway `VICU_USER_DATA_DIR` folders from scratch: the API token,
the Inbox id, Vikunja syntax for the quick-add parser, Quick Entry and Quick View switched on with
unusual hotkeys (so a run never takes the hotkeys of a Vicu you use), no sounds or notifications.
To look at a profile by hand:

```bash
VICU_USER_DATA_DIR=scripts/ui-verify/.local/profile-light npx electron .
```

## 3. Build and run

```bash
npm run build
npm run ui:verify -- --scenario baseline --theme light
npm run ui:verify -- --scenario baseline --theme dark
```

| Option | Meaning |
|---|---|
| `--theme light\|dark` | Profile theme (default light). |
| `--size WxH` | Content size of the main window (default 1280x820). |
| `--motion full\|reduce` | `full` (default) forces `prefers-reduced-motion: no-preference`, because this PC has Windows animation effects off and reports `reduce`; `reduce` emulates it. |
| `--forced-colors` | Emulate `forced-colors: active`. |
| `--scenario a,b` | Scenarios by file name or id: `baseline`, `e4`, `e04-schedule-popover`. |
| `--wave N` | Every E scenario whose first wave (in the plan, section 5) is N or earlier. |
| `--run NAME` | Folder name under `out/` (default: time stamp, scenarios, theme). |
| `--build` | Run `npm run build` first. |
| `--list` | List the scenarios with their ids and waves. |

With neither `--scenario` nor `--wave`, `baseline` runs. The harness warns when `src/` is newer than
`out/`, when the seed is from another day, and it refuses to run without a build or the server.
Each launch rebuilds the profile, so runs never depend on each other. The GitHub update check is
cut off (no update banner, no outside traffic), device scale is 1, and the app is shut down with
`app.exit()` so no helper process keeps the profile folder.

Output: one JSON object per line on stdout and in `out/<run>/results.jsonl`
(`t` is `run`, `env`, `start`, `capture`, `assert`, `axe`, `skip`, `warn`, `pageerror`, `error` or
`summary`), and the PNGs as `out/<run>/<scenario>--<name>.png`. The exit code is 1 when a scenario
threw, the page threw, or an assertion failed. The baseline gives 16 captures per theme: Inbox,
Today, Upcoming, Anytime, Logbook, Review, Routines, Settings, a project, a tag, an open card, the
date popover on the last Today row, the composer with parsed text, the context menu, Quick Entry
and Quick View.

## 4. Scenarios

`scenarios/<name>.mjs` exports `meta = { id, wave, title }` and a default `async function (h)`.
Files starting with `_` are helpers. `baseline` is not part of a wave. E4 and E13 (wave 1) are
real and assert behaviour that the current app fails (clipped popover, Escape, offset highlights);
the others are stubs that log `skip: not implemented yet` until their card fills them in.
Scenario code computes dates from the run day (`lib.mjs`: `localDate`, `comingWeekday`, `at`).

The helpers on `h`:

- `goto(route)`, `click(textOrSelector)`, `rightClick`, `hover`, `key('Control+F')`, `type(text)`,
  `drag(from, to, { steps, hold })`, `wait(ms)`, `dismiss()` (closes popovers, menus, the composer
  and an expanded card), `rows()`, `lastRow()`, `resize(w, h)`, `setMotion`, `setForcedColors`.
- `capture(name, { clip, page, transparent })` (device scale 1), `assert(label, fn)` (a boolean or
  `{ ok, detail }`), `axe(selector?)` (axe-core; one line per violation, returns them),
  `frames(ms)` (requestAnimationFrame timing sample), `api(method, path)` (reads the server to check
  what was really saved).
- `showQuick('entry' | 'view')` and `hideQuick(...)`: the popups open through the app's own
  second-instance path, the code a global hotkey runs; the returned page is the popup window.
- `h.ids` (seed ids), `h.wave`, `h.options`, `h.app`, `h.page` (the raw Playwright objects).

A text target matches visible text exactly; anything that looks like a selector (`[data-task-id]`,
`.class`, `css=...`, `role=...`) is used as a selector.

## 5. Tools

- `tools/contrast.mjs`: WCAG contrast of colour pairs from the command line or a JSON list.
- `tools/springs.mjs`: damping and stiffness to a CSS `linear()` easing curve and duration.

## Troubleshooting

- "The test server does not answer": `docker start vicu-test-vikunja`.
- "seed-ids.json is missing": run `seed.mjs` first. After a re-seed the Inbox id may change; every
  launch rewrites the profile, so only a manually started app needs `profile.mjs` again.
- A stale `electron.exe` holding `.local/profile-*` (EPERM when the profile is rebuilt): end the
  processes whose command line contains `scripts\ui-verify\.local`.
