# Notes to tasks (desktop and mobile)

Plan, 2026-11-19. In progress: the contract, fixture and desktop are built (harness `notes-import`, 18 checks); mobile (Android and iOS) is next.

Turn notes from outside Vicu into tasks with the assistant: typed meeting notes, a long text dump,
PDFs, photos of handwritten pages, and pages scanned with the phone's camera. The motivating case:
an offsite with pages of action items, some with a person's name on them.

Both repos (desktop `vicu`, mobile `vicu-android` with its iOS app), one contract, same release.

---

## 1. What exists already

- **Brain dump** (`docs/ai-assistant-v1.md` 4.8): one request turns a long text into new projects,
  tasks, subtasks and notes; checks in `src/shared/ai/brain-dump.ts` (mobile `BrainDumpChecks.kt`),
  a plan grouped by project, Update by edit, Add with one Undo, the dump kept until added or
  discarded. This is the backend to reuse.
- **Make tasks from this** (`MakeTasksDialog.tsx`): pasted text through the dictation request,
  at most 25 drafts, no projects.
- **Pro import** (semantics 21.12): `vicu-import/1` with `owner`, `what`, `due`, decisions, open
  items; people matched by 21.5 (`pro.personMatch`), promises of theirs land in Waiting on.
  "Convert with the assistant" (ai 11.1) already turns pasted meeting text into that format.
- **Mobile**: photo picker, file picker and `TakePicture` (`PlatformPickers.android.kt`, no CAMERA
  permission on purpose), PHPicker on iOS, and a share target for `SEND` / `SEND_MULTIPLE` of
  text, images and files (`MainActivity.kt`).
- **Not there**: no image or PDF ever reaches a model. Both wire formats send user content as a
  plain string (`wire.ts`, `WireProtocols.kt`); the contract says attachments are never sent
  (ai 7.1). No PDF text extraction on either side. No vision check in Test connection.

---

## 2. Shape of the feature

One flow, "Make tasks from notes", with three steps:

1. **Add sources.** Text (typed or pasted), files (`.txt`, `.md`, `.pdf`, images), photos, and on
   a phone the camera's document scanner. Several at once, in order; pages can be reordered and
   removed. A **date of the notes** field (from the file or photo date, else today) and an
   optional **title** ("Offsite Q4").
2. **Read.** Every source becomes text, page by page:
   - text and text files as they are;
   - a PDF with a text layer: its text, read on the device (no model);
   - an image, or a PDF page without text: sent to a model that can read images, which writes
     out the page as text (the `notesRead` request, section 4). One request per page, several in
     parallel, with progress ("Reading page 3 of 11").
   The result is shown as the **transcript**, page by page next to a thumbnail, and can be
   corrected before anything is organized. This is where a misread name or date gets fixed.
3. **Organize and review.** The transcript goes through the brain dump request with a notes
   prompt added (section 4). The plan is the brain dump's plan (projects, tasks grouped by
   project, Update, Add, one Undo) plus, per card: who the item is for (section 3) and the line
   it came from, with its page.

Why two steps (read, then organize) and not one request with the images:

- The person can check the reading. Handwriting and names are where it goes wrong, and a wrong
  name is worse than a missing task.
- The organize step reuses the brain dump unchanged in spirit: text in, checked plan out, same
  vectors style, same review screen.
- Organizing can run on a model without vision (a local model, or Ask's model), and only the
  reading needs one.
- A failed page is retried alone; a 15-page offsite is not one huge request.

On-device OCR (ML Kit, Apple Vision, Windows OCR) is not in v1: only Apple's handles handwriting
reasonably, and a vision model reads crossed-out lines, arrows and columns far better. It can come
later as the fallback for a model that cannot read images.

---

## 3. Names on action items

The organize answer gets an `owner` per task: the name as written in the notes, `"me"` when the
item is the person's own (their name, "I", their initials), or `null` when none is given. The
context gets `me` (the account's name) and `people` (names Vicu knows: members of shared
projects, and Pro people while Pro and the Pro assistant are on).

The name is matched on the device by the 21.5 rules (title, alias, unique first name; ambiguous
is no match), never trusted from the model. What the card does with it:

| Owner | Default on the card | Other choices on the owner chip |
|---|---|---|
| `null` or me | a normal task of mine | |
| a member of the task's shared project | assigned to them (contract 9.2) | not assigned, Waiting on (Pro) |
| a Pro person (promises layer on) | open, see section 9: by Pro's rule (21.6, decision 31) a promise without a clear yes is a task of mine, "Confirm with Lalith: ..." | a promise of theirs (Waiting on), assign, keep as my task |
| a name nobody has | unticked, title kept as written with the name: "Lalith: send the budget" | make the person (Pro, `pro:ensure-person`), tick it |

A filter over the plan: **Mine only**, **Mine and waiting on others** (default), **Everything**.
At an offsite most lines belong to someone else; the person decides how much of that they want to
track.

Pro on also maps two more kinds of lines when the organize answer marks them: a decision becomes
a ledger log entry, an open question an "Ask <name>: <what>" task (both as in 21.12). Without Pro
they are listed under the plan with Copy, and are not written anywhere.

---

## 4. Contract changes (both repos first, byte-identical)

`docs/ai-assistant-v1.md`, new section **4.9 Notes**, and `test-fixtures/ai-tools-v1.json`:

- **`notesRead` prompt** (version 1): write out the page as plain text, keep the line structure,
  mark crossed-out text as left out, mark what cannot be read as `[unreadable]`, never add
  anything not on the page. Plain text answer, no schema. User message: the image, then
  `<page>N of M</page>` and the notes' title.
- **`notes` prompt** (version 1), added after `dictation` and `brainDump` in the system prompt:
  these are notes of a meeting held on the notes' date; dates are read from that date, not now;
  action items become tasks, decisions and discussion do not; the owner rule above.
- **Context**: `now` is the notes' date (noon local when only a date is known), plus `me` and
  `people`. The transcript tag is `<notes>` with `<page n="3">` blocks, so `page` can be checked.
- **Answer schema** `notes.answerSchema`: the brain dump answer plus per task `owner` (string or
  null), `page` (integer or null) and `from` (the line it came from, or null), and a top-level
  `decisions` list (`what`, `by`, `page`).
- **Checks** after 4.8.3: `page` must be a page that exists, else null; `from` must appear in that
  page's transcript (spacing and case ignored), else null; `owner` is matched as in section 3 and
  the card keeps the raw name; drafts with the same title and owner across batches are merged.
- **Volume**: pages of action items can exceed one answer (60 tasks, 16,000 tokens). The
  transcript is organized in **batches** of at most `limits.notes_batch_chars` (about 8,000)
  cut at page boundaries (a longer page is cut at a line break). Every batch answers with refs
  from `p1` and `d1`; the device renumbers them over the whole plan. A batch after the first gets
  a `<projects_so_far>` block before `<notes>`: the kept new projects of earlier batches, with
  their final refs, `[{"ref", "title", "path"}]`; a `project_ref` or `parent_ref` may name one,
  and a new project with the same path is merged into it by 4.8.3 step 4. Batches run one after
  another, because each needs the projects of the one before. The plan shows them as one.
- **Update** (4.8.4) sends the whole plan and gets the whole plan back, which only fits a small
  one: it is offered while the plan came from one batch and has at most
  `limits.brain_dump_tasks_max` tasks. A larger plan is changed by hand on the cards. New limits:
  `notes_pages_max` (30), `notes_tasks_max` (200 over all batches), `notes_batch_chars`,
  `notes_read_max_tokens` (4,096 per page), `notes_image_long_edge` (2,048 px),
  `notes_file_max_mb` (50).
- **Vision probe** in Test connection (2.4): a small fixed PNG in the fixture with a printed word
  and a number; the model must answer both. Settings shows "Reads images" per model. The result
  is kept with the model's other capabilities (`tested`: `structured`, `tools`, now `vision`). A
  model tested before this version has no result: the probe runs for it the first time an image
  is added, and in Settings.
- **Reading model** (settled): the dictation model when it reads images, else Ask's model when it
  does, else the person picks one: "Use a different model to read images", a third model slot
  stored per preset like the others, shown only when neither model reads images (or when the
  person opens it). Both models are on the same provider and key, so the fallback sends nothing
  to anyone new. Settings and the notes screen say which model reads the pages. The organize step
  stays on the dictation model.
- **Wire** (2.2, 2.5): a user message can hold parts. `openai-chat`: `content` is a list of
  `{"type": "text"}` and `{"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,..."}}`
  (OpenAI, Gemini's compatible endpoint, OpenRouter and Ollama take this shape).
  `anthropic-messages`: `{"type": "image", "source": {"type": "base64", ...}}`. PDFs are never
  sent as documents: pages without text are drawn to images on the device, so one path serves
  every provider. Reading requests time out at 120 s without data. `openai-chat` sends
  `"detail": "high"` with each image (a field a 400 names is left out for that model, as in 2.5).
- **Risk, small handwriting**: many models shrink an image before reading it (to about 768 px on
  the short side, or about 1,568 px on the long side), which can lose dense handwriting on a full
  page. Phase 3 starts by reading real offsite pages on two or three providers. If that is weak, a
  page is cut into two overlapping halves, read apart and joined (`notes_page_split`), decided in
  the contract before the UI is built.
- **Privacy** (7.1): a new row, "Notes: the pages you add (their images or text), the notes'
  title and date, and the context of 4.1 with the names of `me` and `people`". Images are
  downscaled, re-encoded as JPEG and stripped of metadata (no location) before they leave the
  device. A local server skips the question as today.
- **Agreement**: today the agreement is one per provider and address (`consented`), and it says
  attachments are never sent. So images need their own: a second key (`<consentKey>|images`)
  asked before the first page image goes to a cloud provider, also from people who agreed before.
  Text and PDFs with a text layer send only text and stay under the existing agreement.
- **Vectors**: `notes.checks` (page, from, owner matching, batch merge) under the three zones;
  `notes.context`; `notes.wire` (the two part shapes); `notes.batches` (where a transcript is cut).

---

## 5. The source is not kept (settled)

The pages and files are never uploaded to Vikunja. They stay on the device only while the import
is open (so it survives the app closing) and are deleted on Add or Discard.

Each created task's notes end with where it came from, as plain text: "From Offsite Q4, page 3:
<the line>" (the title, else "Notes <date>"; the line when `from` was kept by the checks).

---

## 6. Desktop

- **Ways in**: the palette's "Make tasks from notes"; an Add files button in the existing Make
  tasks from this dialog (which grows into this flow); dropping files on the main window outside a
  task card (a card keeps its attachment drop); pasting an image (a whiteboard screenshot).
- **Files**: main's own open dialog (as `calendar:file-add`), so the window never sees paths;
  copies kept under `userData/notes-import/<id>/` until added or discarded; at most
  `notes_file_max_mb` per file. Nothing handles a file dropped on the window today (only a task
  row and the comments pane read a drop), so the new handler is the only one outside those.
- **PDF**: `pdfjs-dist` in the renderer, its own lazy chunk (add to `code-splitting.test.ts`):
  text per page; a page with almost no text is drawn to a canvas and treated as an image. Every
  PDF page also has "Read as image" in the transcript, for a scan whose own text layer is junk.
  The page's CSP is `default-src 'self'`: the pdf.js worker must be a file of the build (like
  `pcm-worklet.js`), not a blob, and its WebAssembly image decoders are blocked, so pdf.js runs
  with them off (the script fallback). Phase 2 checks this with a scanned PDF (JBIG2 and JPEG
  2000 pages) before anything else is built on it. A password-protected PDF is refused with a
  sentence.
- **Images**: decoded and downscaled in the renderer (canvas, `createImageBitmap` with
  `imageOrientation: 'from-image'`), JPEG out. HEIC is not drawn by Chromium: on macOS convert in
  main with `sips`, elsewhere say it cannot be read.
- **No camera** (settled): the camera is mobile only. Pages scanned on a phone become tasks there
  and sync; on desktop, photos come in as files, a drop or a paste.
- **Main**: `ai:read-page` (one image, the `notesRead` prompt, the reading model) and
  `ai:dictate` with `notes: true` (the organize batches); `wire.ts` learns message parts;
  `ai:cancel-dictation` cancels both.
- **Renderer**: `stores/notes-import-store.ts` (sources, pages, transcript, batches, plan; kept
  until added or discarded, like the dump), `components/ai/NotesImport*.tsx` (sources, transcript,
  plan with the owner chip and the Mine filter), `lib/ai/add-notes.ts` on top of
  `add-brain-dump.ts` (assignees through the collaboration path, Pro promises through
  `writeLedger` once tasks have ids).
- **Harness**: `scenarios/notes-import.mjs` with the fake OpenAI-compatible model of the guided
  scenario, answering the read and organize requests; a sample PDF with a text page and an image
  page; asserts what the server holds and that Undo takes it all back.

---

## 7. Mobile (Android and iOS)

- **Ways in**: the + menu's "Scan notes" and "Notes from files"; the share sheet, which today makes
  a task with an attachment, asks "One task with this" or "Make tasks from notes" when the shared
  items are images, PDFs or long text (several shared photos become pages in order).
- **Camera, Android**: the ML Kit document scanner (`play-services-mlkit-document-scanner`):
  edge detection, crop, several pages, no CAMERA permission (it fits the manifest's rule). Without
  Google Play services, or when the scanner cannot start (it downloads its parts through Play
  services the first time), fall back to `TakePicture` one page at a time with "Add another
  page". The app already depends on Play services for location, and has one build flavour.
- **Camera, iOS**: `VNDocumentCameraViewController` (VisionKit), several pages. The camera key
  is there already (`iosApp/project.yml`), but its sentence says the photo is kept with the task;
  it is reworded to cover scanning notes that are not kept.
- **PDF**: iOS `PDFPage.string` per page; Android `PdfRenderer.Page.getTextContents()` on
  Android 15 and later (API 35, confirmed), otherwise every page goes as an image (drawn with
  `PdfRenderer`), so an older phone needs a model that reads images even for a typed PDF.
  `PdfRendererPreV` brings the Android 15 PDF API to Android 11 to 14; whether it has the text
  call was not confirmed, check it when building and use it if so.
- **Shared code** (`shared/commonMain/.../ai`): message parts in `WireProtocols.kt` and
  `ChatModels.kt`, `NotesChecks.kt` beside `BrainDumpChecks.kt`, the import controller beside
  `DictationController`; platform code only for scanning, PDF text and image downscaling.
- **Background**: reading 15 pages takes a while. On Android the work keeps going when the
  person leaves the screen (a foreground job). iOS gives an app about half a minute after it
  leaves the screen: the page being read finishes or is asked again, and the rest goes on when
  the app is opened. The import survives the app closing on both.
- **Harness**: the `vicu-android` harness with the same fake model; the iOS simulator for the
  scanner's cancel path (the simulator has no camera, so pages come from the photo picker there).

---

## 8. Order of work

Each phase ships on its own and leaves the app working.

1. **Contract** (both repos, one change): section 4.9, the fixture blocks, the vectors. Owner
   rule and the batch rule settled here.
2. **Text and PDFs with text** (both): sources, notes date, transcript, batches, owner chip and
   filter. No vision needed, so this alone handles typed offsite notes and most
   exported PDFs.
3. **Images**: wire parts, vision probe and the reading model slot, image preparation, the
   reading step. Desktop: files, drop, paste. Mobile: photo picker and share sheet.
4. **Camera** (mobile only): Android document scanner with its fallback, iOS VisionKit scanner.
5. **Pro**: owners to people and promises, decisions to the log, open questions to Ask tasks.
   (Small, because 21.12's matching and adding already exist; can move before 4.)

Docs with each phase: `docs/ai-assistant.md` and the user guide (`docs/guide/`, `npm run
site:guide`); translations go straight into `locales/en.json`.

---

## 9. Decisions (2026-11-19)

1. **A name nobody has, without Pro**: kept in the title, "Lalith: ...". No label per person.
2. **The source**: not stored. Pages stay on the device until Add or Discard (section 5).
3. **Reading model**: dictation model, else Ask's model, else the person picks one (section 4).
4. **Mobile camera without the Play services scanner**: `TakePicture` one page at a time is
   enough; no scanner of our own.
5. **Camera**: mobile only, none on desktop.

6. **A Pro person's item** (decided: (a)). Pro's settled rule (decision 31, 21.6, and what the import does today
   in `src/shared/pro/import.ts`): a promise without their own words of a clear yes becomes my
   task "Confirm with Lalith: ...". Handwritten action items never carry those words. Either
   (a) keep the rule, with one switch on the review screen, "Agreed in the meeting", that turns
   every named item into a promise of theirs (recommended: one rule for every import, one tap
   for an offsite), or (b) a name on an action item counts as the yes for this flow.

---

## 10. For the offsite now

Until this is built: photograph the pages, have any vision assistant write them out as text, and
paste the text into a brain dump (type into the dump, then Organize). With Pro on, the Copilot
prompt plus "Convert with the assistant" on the import screen turns the same text into promises
with owners.

---

## 11. Verification (2026-11-19)

Checked against both repos and the platforms' documentation.

Confirmed:

- Brain dump runs on the dictation model (`aiBrainDump` in `src/main/ai/service.ts`), every
  request is streamed, and section 4.9 is free in the contract.
- Both wire formats send user content as a plain string today (`wire.ts`, `WireProtocols.kt`).
- One provider per device with two models on it (`models.dictation`, `models.ask`), so the
  reading fallback stays on the same provider and key.
- Mobile has Pro (`ProLedgerStore.kt`, `ProCapture.kt`), the share target into the task entry
  sheet on Android (`SharedContent`) and a share extension on iOS (`iosApp/VicuShare`), and
  camera capture on both (`TakePicture`, `UIImagePickerController`).
- `pro:ensure-person` and the main-owned open dialog of `calendar:file-add` exist.
- The ML Kit document scanner needs no camera permission (it uses Play services' own) and runs
  from API 21; the app's minimum is 26.
- `PdfRenderer.Page.getTextContents()` is API 35.

Corrected in this pass:

- Batches: refs restart per batch and the earlier projects had no defined way in; now renumbered
  on the device with a `<projects_so_far>` block (section 4).
- Update could not work on a plan of up to 200 tasks; now limited to a one-batch plan.
- The agreement is per provider, not per feature, and promises attachments are never sent; images
  now get their own agreement.
- The vision result of models tested before this version.
- pdf.js under the app's CSP (worker as a file, no WebAssembly decoders), "Read as image" for a
  junk text layer, password-protected PDFs.
- The file limit (its own, 50 MB), iOS background time, the iOS camera sentence, the scanner's
  first-use download, older Android phones and typed PDFs.
- The Pro row of the owner table contradicted decision 31; now an open question (section 9).

Not checked, to settle while building: how well each provider reads dense handwriting (the
phase 3 test), `PdfRendererPreV`'s text call, pdf.js's script decoders on real scans.
