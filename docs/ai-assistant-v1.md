# AI assistant v1

> **Status: draft, built in both apps.** The rules and numbers marked as starting values are
> settled by the Phase 0 measurements before the first release that uses them.

This contract defines how Vicu desktop and Vicu mobile (Android and iOS) use a language model the
user brings: smart dictation, Ask (chat with tasks) and Talk (Ask by voice), and the local speech
recognition dictation runs on. Both apps must send the same prompts, schemas and context for the
same state, and apply the same checks to what comes back, so the same words give the same tasks on
every device. The file is kept identical in both repos (`docs/ai-assistant-v1.md`), next to
`cross-app-semantics-v1.md`.

| Fixture | Covers |
|---|---|
| `ai-tools-v1.json` | provider presets, the speech models and settings, the vocabulary hint, the draft task, dictation, brain dump and guided suggestion answer schemas, the Ask tools and starters, the prompts, the limits, the spoken confirmation words, and vectors for the checks |
| `ai-dictation-corpus-v1.json` (planned) | transcripts with the tasks they should give, run against real models by an eval script; not a CI gate |

The shared-contract identity tests keep both copies equal, and both apps' test suites run the
fixture's vectors. Both apps carry the fixture's text and send its prompts, schemas and tools from
it. When behaviour changes, change the fixture first, in both
repos, in the same release.

Times are **local wall-clock times in the device's time zone**, written `YYYY-MM-DDTHH:mm:ss`
(or `YYYY-MM-DD`, `HH:MM`) without an offset, as in `cross-app-semantics-v1.md`. Section numbers
written "semantics 5.1" point into that document.

---

## 1. Principles

- **Off until set up.** Nothing is sent to any model or service until the user chooses a provider
  and agrees to what each feature sends (section 7).
- **Your key, your bill.** The user's key or server is called straight from the device; there is
  no Vicu server. Apps show no prices and keep no usage meter.
- **The model reads, Vicu decides.** A model's answer is a proposal. Dates go through the
  quick-add parser and `DueDates`, every field through the checks of section 4.3, and every write
  through the existing paths (stored first, queued, synced). The model never writes.
- **Every write is confirmed.** Dictation shows draft cards; Ask and Talk show proposal cards.
  Nothing changes until the user adds or applies it, and Undo follows.
- **Hidden tasks never leave the device.** Tasks hidden by semantics 10.1 are left out of every
  context, tool result and count before anything reaches a model.

---

## 2. Providers

### 2.1 Presets

The `providers` block of the fixture lists the presets. Each gives the wire protocol, the default
address, how the key is sent, where the model list is, how structured answers are asked for, and
suggested models per feature.

| Preset | Protocol | Default address | Key |
|---|---|---|---|
| `openai` | `openai-chat` | `https://api.openai.com/v1` | required, `Authorization: Bearer` |
| `anthropic` | `anthropic-messages` | `https://api.anthropic.com/v1` | required, `x-api-key` and `anthropic-version: 2023-06-01` |
| `gemini` | `openai-chat` | `https://generativelanguage.googleapis.com/v1beta/openai` | required, `Authorization: Bearer` |
| `ollama` | `openai-chat` | `http://localhost:11434/v1` | optional |
| `openwebui` | `openai-chat` | `http://localhost:3000/api` | required |
| `openrouter` | `openai-chat` | `https://openrouter.ai/api/v1` | required |
| `other` | `openai-chat` | typed by the user | optional |

- An address the user types is used as given, without a trailing `/`. Plain `http` is allowed (a
  model on the home network); an `http` address outside the local network gets the warning the
  setup screen gives for a Vikunja server. Nothing adds a version path: the field of a preset
  whose address is typed (`addressEditable`) says so under it (`messages.addressHelp`).
- The address of a typed preset is saved with Save address and then shown as a value with Edit,
  not as an open field (section 7.2 keeps the saved ones).
- The chat endpoint is `<address>/chat/completions` (`openai-chat`) or `<address>/messages`
  (`anthropic-messages`); the model list is `<address>/models` for every preset (`protocols` in
  the fixture).
- `transcription` says how a provider takes audio, for users who choose it over local speech: an
  endpoint below the address (OpenAI, OpenRouter, and Open WebUI at `/v1/audio/transcriptions`),
  audio inside the chat request (Gemini), or none.

### 2.2 Structured answers

Dictation answers with JSON that matches a schema (section 4.2). Per preset, `structured` says how:

- `json_schema`: the provider's strict schema mode: on `openai-chat`, `response_format`
  `{"type": "json_schema", "json_schema": {"name": "answer", "strict": true, "schema": ...}}`; on
  `anthropic-messages`, `output_config` `{"format": {"type": "json_schema", "schema": ...}}`.
- `prompt`: the schema goes at the end of the system prompt: the prompt, a blank line, the line
  `Answer with JSON that matches this schema:`, a line break, and the schema as compact JSON in
  the fixture's key order. In both modes the answer is parsed from the first `{` to the last `}`.

Either way the app validates the answer against the schema. An answer that does not parse or does
not match gets **one repair request**: the same request with the model's answer added and the user
message `That answer did not match the schema: <first problem>. Answer again with JSON only.` A
second failure is a failed request (section 4.6).

Schemas stay inside what every strict mode accepts (the `schemaSubset` block): `type`,
`properties`, `required`, `additionalProperties: false` on every object, `items`, `enum`,
`description` and `anyOf` only; every property is listed in `required` and an optional value is a
`null` type, not a missing key; no length, range, pattern or format keywords, no `$ref`, no
recursion. Limits are checked on the device.

### 2.3 Tools on the wire

- Ask offers its tools with `tool_choice` `auto` (or none sent). A forced tool choice is never sent:
  Ollama ignores it and some Claude models refuse it.
- Tool arguments arrive streamed in pieces, whole, or with fields missing, depending on the
  provider. Apps assemble them per tool call id and validate the arguments against the tool's
  schema; invalid arguments go back to the model as a tool result
  `{"error": "invalid_arguments", "detail": "<first problem>"}`.
- Several tool calls in one answer run in order; read tools run without asking, proposal tools
  each produce a card.

### 2.4 Test connection

Before a feature can be switched on, Test connection runs on the chosen model: the model list
(when the provider has one), one structured answer and one tool call (the `probe` block of the
fixture, with the answer each must give). When the structured answer fails with
`json_schema`, it is tried again with `prompt`, and the one that works is kept for that model.
Dictation needs the structured answer; Ask and Talk also need the tool call. The settings show
which features the model can run.

A typed address without its version path usually answers 404 or 405. When a request to a typed
address (the model list, Load models or a probe) answers one of those, and no path segment of the
address starts with `v` and a digit (`v1`, `v1beta`, any case) and its last segment is not `api`,
the failure ends with `messages.addressVersionHint`. The `addressVersion` cases of the fixture pin
the rule.

### 2.5 Requests

- Dictation and repair requests use the lowest reasoning effort the model accepts and temperature 0
  where it is accepted: `reasoning_effort` `low` and `temperature` 0 on `openai-chat`;
  `output_config.effort` `low` on `anthropic-messages`, which gets no temperature (current Claude
  models refuse it). A request refused with an error that names one of these fields is sent again
  without it, and the field is left out for that model from then on.
- No `thinking` setting is sent. On `anthropic-messages` an assistant turn goes back with its
  content blocks exactly as they came (thinking blocks and their signatures included), and the
  tool results with any next user text form one user turn.
- `max_tokens` (`anthropic-messages` only): 8,192 for dictation and repair, 16,000 for an Ask turn.
- Timeouts: 10 s to connect; 60 s for a dictation answer and 120 s for an Ask turn without any
  data arriving (a local model may be slow to start). A timeout is a failed request.
- Keys are never logged; debug logs redact `Authorization`, `x-api-key` and `x-goog-api-key`.

---

## 3. Local speech

Dictation and Talk turn speech into text on the device with a downloaded speech model. Audio is
never sent anywhere unless the user chose a provider's transcription instead.

### 3.1 Audio

- 16 kHz, mono, 16-bit PCM, from one recorder the app owns (on Android, no second recorder or
  system recogniser at the same time).
- Kept in memory only and discarded once its phrase is transcribed. A recording ends at Done, on
  release of the held button, when the microphone is turned off, or after 600 s; with an open
  microphone (3.7) the 600 s count per turn.

### 3.2 Phrases

The Silero voice detector (`speech.vad` in the fixture, bundled with the app) cuts the audio into
phrases while the user talks:

- A phrase ends after a pause of at least `min_silence_ms`, or when it reaches `max_phrase_s`
  (Whisper hears 30 s at a time).
- Silence between phrases is dropped, with `pad_ms` kept on each side of the speech.
- Each finished phrase is transcribed at once, in the background, in order. The transcript is the
  phrases' texts, each trimmed, joined with one space; a phrase with no letters or digits is
  dropped.

The values in the fixture are starting values.

### 3.3 Transcribing

`speech.decode` in the fixture:

- Temperature 0 with no temperature fallback, no conditioning on earlier text, non-speech tokens
  suppressed. These keep Whisper from inventing words in silence.
- Language: the setting `auto` (detect per phrase) or a fixed ISO 639-1 code. Parakeet models
  detect the language themselves and ignore the setting.
- At most 4 threads; the graphics chip or Neural Engine where the engine supports it.

### 3.4 Vocabulary hint

Whisper takes an initial prompt that biases spelling. Apps pass the names the user is likely to
say, built the same way everywhere:

1. Collect, in this order: the Inbox project's title; the other projects' titles that the user can
   write to, not archived, ordered by lowercased title (semantics 12.2); the label titles, ordered
   the same way; the saved place names, ordered the same way.
2. Trim each name. Skip a name that is empty, has no letter, or is longer than 40 characters.
   Skip a name equal, ignoring case (Unicode lowercase), to one already taken.
3. Join with `, ` and end with `.`; stop before the name that would make the hint longer than
   600 characters (UTF-16 code units, as Kotlin and JavaScript count them).
4. No names: no initial prompt.

Parakeet takes no prompt; with it, the names reach the dictation model only through the context
(section 4.1). Vectors: `speech.hintVectors` (projects with `inbox`, `writable` and `archived`;
absent means not the Inbox, writable, not archived).

### 3.5 Models

`speech.models` lists the models apps offer, with the file, its size and SHA-256, the Hugging Face
repository and the commit it is pinned to, the languages and the licence.

- Downloads come from `https://huggingface.co/<repo>/resolve/<commit>/<file>`, can resume (HTTP
  `Range`), run on Wi-Fi only unless the user allows mobile data, and are checked against `sha256`
  before use. A file that fails the check is deleted.
- Files are stored outside backups (Android `noBackupFilesDir`, iOS `isExcludedFromBackup`, the
  desktop's user data folder) and can be deleted from Settings.
- A model with `attribution` shows that line in the app's licences screen.
- Which model a device suggests depends on its memory and speed; the thresholds are set after the
  Phase 0 measurements. `default_for` in the fixture gives the starting suggestion: `computer`,
  `phone`, or `phone_low_memory`.
- Whisper always encodes 30 s of audio, however short the phrase; Parakeet encodes only what was
  said. On a phone's processor that decides it (Pixel 10 Pro, 4 threads, ARMv8.2 build): Whisper
  large-v3-turbo took 21.7 s for 1.25 s of speech, Parakeet q4 0.22 s for 1.5 s. Phones therefore
  suggest Parakeet, computers Whisper large-v3-turbo.

### 3.6 Without a model

No speech model downloaded: the platform recogniser is used as today (Android `SpeechRecognizer`,
Apple `SFSpeechRecognizer` or `SpeechTranscriber`, Windows `System.Speech`); Linux has none. With
a provider's transcription chosen instead, the recording is sent whole to that provider at Done.

### 3.7 Open microphone

Smart dictation once locked (section 4) and Talk (section 6) keep the microphone on instead of
listening only while a button is held. The microphone button turns it on and off.

- **Turns.** What the person says comes in turns. With local speech a turn ends at a pause of
  `speech.turn.end_of_turn_ms` after speech, once the phrases before the pause are transcribed.
  With the platform recogniser (3.6) a turn ends when the recogniser ends its utterance, or when
  its words have not changed for `end_of_turn_ms`. A turn's words are sent at once.
- **Interrupting.** When the person talks again (local speech: `speech.vad.min_speech_ms` of
  speech; platform recogniser: the first words) while the request sent for the previous turn has
  not finished, that request is cancelled and nothing of it is kept; its words and the new ones go
  out together at the end of the new turn. An answer that has finished stays. While a card waits
  for the person (5.4), talking is the answer to it (6.1), not an interruption.
- **Answers read aloud.** The microphone pauses while the device reads an answer, because it would
  hear the device's own voice, and listens again when the voice ends. Pressing the microphone
  button stops the voice and listens at once. An app may keep listening while the voice plays
  through headphones, where the microphone cannot hear it, and stop the voice when the person
  talks.
- **Off.** The microphone turns off after `speech.turn.idle_s` without speech, when the person
  turns it off, and when the app goes to the background (phones). A turn whose speech gave no
  words sends nothing, unless it carries the words of an interrupted request.
- **Brain dump.** In a brain dump (4.8) a turn is not sent: its words are added to the dump, so
  nothing interrupts, and the microphone turns off after `speech.turn.dump_idle_s` without speech
  instead.

The values in the fixture are starting values.

---

## 4. Dictation

The user rambles; the model turns the transcript into draft tasks; Vicu checks them and shows
cards; Add creates them. The same request serves text from outside (Make tasks from this) and a
task's notes (Break into steps, where the answer's tasks become subtasks of that task).

Voice has two ways in, and both stay available:

- **Quick capture**: hold + and let go (desktop: also the voice shortcut held, or Say a task). The
  words go to the quick-add parser as one task and are added at once, with Undo, as before the
  assistant. No model is involved, whether or not smart dictation is on.
- **Smart dictation**: hold + and slide up to the lock (desktop: slide up from a held +, or tap the
  voice shortcut to latch it instead of holding it). The microphone stays on (3.7) until Done. The
  first turn is a dictation request (4.1); each later turn is an edit (4.4) with the drafts so
  far, so cards appear and change while the person talks. The lock is offered only when smart
  dictation is on and ready. With the sheet's **Brain dump** switch on, nothing is sent until the
  person taps Organize, and the answer can add projects (4.8).

### 4.1 Request

- System: the `dictation` prompt of the fixture, exactly.
- One user message:

```text
<context>
{ ...context JSON... }
</context>
<transcript>
...the transcript...
</transcript>
```

- The context JSON has these keys, in this order, written without extra spaces (lists that are
  "ordered by lowercased" a name are then ordered by the name itself, compared by UTF-16 code
  units):

| Key | Value |
|---|---|
| `now` | the reference time: when the recording ended, `YYYY-MM-DDTHH:mm` |
| `weekday` | the reference day's English weekday name |
| `time_zone` | the IANA zone name |
| `week_starts` | `"monday"` |
| `list` | the name of the list the user is in (`"Today"`, a project's title, ...) |
| `default_project_id` | the project the list gives a new task, else the Inbox |
| `projects` | `[{"id", "title", "path"}]`: projects the user can write to, not archived, ordered by lowercased `path`; `path` is the titles from the top, joined with ` / ` |
| `labels` | label titles, ordered by lowercased title |
| `places` | saved place names, ordered the same way |

- In the transcript, any `</transcript>` is written `</ transcript>`.
- The transcript is at most 20,000 characters (UTF-16 code units); a longer one is cut at the last
  space at or before position 20,000 (without one, at 20,000), the space removed.

### 4.2 Answer

The `dictation.answerSchema` schema of the fixture:

```json
{
  "tasks": [{
    "ref": "d1",
    "title": "Call the plumber",
    "notes": "About the leaking kitchen tap",
    "when": { "said": "tomorrow", "date": "2026-10-07", "time": null },
    "project_id": 12,
    "labels": ["phone"],
    "priority": null,
    "repeat": null,
    "reminder": null,
    "place": null,
    "subtasks": [],
    "unsure": []
  }],
  "unclear": []
}
```

| Field | Meaning |
|---|---|
| `ref` | the draft's handle, `d1`, `d2`, ... (section 4.4) |
| `title`, `notes` | plain text; notes become the description by `description-format-v1` |
| `when` | `said`: the words that gave the date or time; `date` `YYYY-MM-DD` and `time` `HH:MM` (24-hour): the model's reading; all three `null` when nothing was said |
| `project_id` | a project from the context, or `null` |
| `labels` | label names, existing or new |
| `priority` | 1 low, 2 medium, 3 high, 4 urgent, or `null` |
| `repeat` | `{"every": N, "unit": "day" \| "week" \| "month" \| "year"}` or `null` |
| `reminder` | `{"before_due_minutes": N, "at": null}`, `{"before_due_minutes": null, "at": "YYYY-MM-DDTHH:mm"}`, or `null` |
| `place` | `{"name": "Home", "trigger": "arrive" \| "leave"}` or `null` |
| `subtasks` | subtask titles |
| `unsure` | the fields the model is not sure of: `title`, `notes`, `when`, `project`, `labels`, `priority`, `repeat`, `reminder`, `place`, `subtasks` |
| `unclear` | short notes on what the model heard but could not place, shown under the cards |

### 4.3 Checks

Apps check every draft in this order. A field the check rejects is left empty and reported in
`dropped` (`{"ref", "field", "value"}`, for the card to explain); a field Vicu filled in itself is
marked guessed, together with the fields the model put in `unsure`. Guessed fields show with a
dashed outline.

1. **Drafts**: at most 25; the rest are dropped (`field` `"task"`). When any `ref` is empty or
   used by an earlier draft, every draft is renumbered `d1`, `d2`, ... by position.
2. **Title**: line breaks replaced by spaces, trimmed. Empty: the draft is dropped (`field`
   `"title"`). Longer than 250 characters: cut at the last space at or before position 250
   (counting from 0; without one, at 250), the space removed; the rest becomes the first paragraph
   of the notes (followed by a blank line and the notes, if there were any).
3. **Notes**: trimmed, at most 10,000 characters.
4. **When**:
   - When `said` is not null, the quick-add parser reads it with the dictation's reference time,
     with only dates enabled (every other token type suppressed, no `!` shortcut), whatever the
     user's parser settings. If it finds a date, that date (and its time, if it read one) is the
     due date, stored by semantics 1.1, and the model's `date` and `time` are ignored.
   - Otherwise the model's reading is used and marked guessed: `date` must be a real calendar date
     from the reference day up to 10 years after it, and `time` a real `HH:MM`. A `time` without a
     `date` means the reference day if that time is still ahead, otherwise the next day (as
     semantics 5.1). A `date` without a `time` is date-only. Anything else is dropped
     (`value`: `said`, or the `date`). A `said` that gives no date either way is dropped too, so
     the card can say the date was not understood.
   - No date at all: the list's default due date, if it has one (quick add in Today gives
     today), not marked guessed.
5. **Project**: an id from the context's `projects`. `null`: `default_project_id`. Any other id:
   `default_project_id`, marked guessed.
6. **Labels**: each trimmed, one leading `#`, `@`, `*` or `+` removed; empty ones skipped. A name
   equal, ignoring case, to an existing label's title is that label; otherwise a new label with the
   name as given. Duplicates (ignoring case) are removed; at most 10.
7. **Priority**: a whole number 1 to 4, otherwise dropped.
8. **Repeat**: `every` a whole number 1 to 1,000, otherwise dropped. It maps to the API as
   semantics 5.2.
9. **Reminder**: exactly one of the two values. `before_due_minutes` a whole number 0 to 40,320
   and the draft has a due date; `at` a real local time after the reference time. Otherwise
   dropped.
10. **Place**: `name` matches a saved place by semantics 5.3 (ignoring case and curly
    apostrophes; same-name places by id), `trigger` `arrive` or `leave`. Otherwise dropped. A
    place keeps the default radius.
11. **Subtasks**: each trimmed, line breaks replaced by spaces, empty ones skipped, longer ones cut
    at 250 characters; at most 20.

A checked draft has `ref`, `title`, `notes`, `due` (`YYYY-MM-DDTHH:mm:ss` or `null`), `project_id`,
`labels` (`[{"id", "title"}]`, `id` `null` for a new label), `priority`, `repeat`, `reminder`
(`{"before_due_minutes"}` or `{"at"}`), `place` (`{"place_id", "trigger"}`), `subtasks`, and
`guessed` (field names in the order of `dictation.fields`). Vectors: `dictation.checks`.

### 4.4 Editing by voice

With the cards on screen, each turn of the open microphone (3.7) is an edit: an instruction ("make
the first one Friday", "drop the dry cleaning"), more tasks ("and call mum tomorrow"), or both:

- System: the `dictation` prompt, a blank line, then the `dictationEdit` prompt. User message: the
  context block, then `<drafts>` with the current drafts in the model's own answer shape (after
  the checks, with any edits the user made by hand, labels as names, the due date back as `when`
  with `said` `null`, `time` `null` for a date-only due date, `unsure` empty), written as
  `{"tasks": [...]}` with each task's keys in the schema's order, then `<transcript>` with the
  turn's words. Each block's tag is on a line of its own, and the blocks are joined with line
  breaks.
- The answer is the full list again. Drafts keep their `ref`; the model gives a new draft a new
  `ref`. The checks run again; fields whose value changed are highlighted on the card, a `ref` no
  longer present removes its card.

### 4.5 Adding

- Add creates the drafts in their order through the path quick add uses: stored first and queued,
  the default reminder applied when the draft has no reminder of its own, new labels created first,
  subtasks as task relations, a place as a location reminder (semantics 11.7).
- One message, "Added 3 tasks", with Undo, which deletes what was created.
- Draft cards can be changed by hand before Add with the quick-add chips.

### 4.6 Failures

- The transcript exists on the device whether or not the model answers.
- No provider set up, or smart dictation off: the lock is not offered, and voice is quick capture
  (section 4).
- A failed request (no connection, an error answer, a timeout, a second invalid answer): the
  transcript is kept on the card with **Retry** and **Add as one task** (through the quick-add
  parser). A kept transcript survives the app closing until it is added or discarded.
- No drafts left after the checks: "Nothing to add", with the transcript and the same two choices.

### 4.7 Vectors

`dictation.checks` gives a reference time, the list's `defaultDue` (a local date or `null`), the
model's answer, and the checked drafts with `dropped` and `unclear`. A vector without `context`
uses `dictation.context` (projects, the default project, labels with ids, places with ids). Slash
dates in `said` are read with the vector's `locale`.

### 4.8 Brain dump

A long ramble organised in one go, into new projects and subprojects as well as tasks, subtasks
and notes. It is smart dictation with the sheet's **Brain dump** switch on; the switch is offered
while nothing has been sent, and the app remembers it (a device setting). Under the switch a note
says what it does: on, that the person can talk as long as they like, nothing is sent until they
tap Organize, and then everything is sorted into projects, tasks, subtasks and notes; off, that
each pause turns what they said into task cards.

- **Dumping.** The microphone stays on (3.7), but a turn is not sent: its words are added to the
  end of the dump, which the person can also type into and correct. The dump is at most 20,000
  characters (4.1); at that length the microphone turns off and the sheet says so.
- **Organize** sends the whole dump in one request (4.8.1). Nothing goes to the model before.
- **The plan** shows the new projects and the tasks grouped by project (4.8.5). What the person
  says or types next waits until **Update**, which sends it as an edit (4.8.4).
- **Add** creates the projects, then the tasks (4.8.5).

#### 4.8.1 Request

- System: the `dictation` prompt, a blank line, then the `brainDump` prompt.
- One user message as in 4.1, with the same context: `list` and `default_project_id` come from the
  list the person is in.
- The answer may use up to `limits.brain_dump_max_tokens` tokens.

#### 4.8.2 Answer

The `brainDump.answerSchema` schema of the fixture: the dictation answer (4.2) with `projects`
first and `project_ref` after each task's `project_id`:

```json
{
  "projects": [
    { "ref": "p1", "title": "Garden", "parent_id": 12, "parent_ref": null },
    { "ref": "p2", "title": "Vegetable patch", "parent_id": null, "parent_ref": "p1" }
  ],
  "tasks": [{ "ref": "d1", "title": "Order seed potatoes", "...": "...", "project_id": null, "project_ref": "p2" }],
  "unclear": []
}
```

| Field | Meaning |
|---|---|
| `projects[].ref` | the new project's handle, `p1`, `p2`, ... |
| `projects[].title` | its name |
| `projects[].parent_id` | a project from the context to put it under, or `null` |
| `projects[].parent_ref` | a new project listed before it to put it under, or `null` |
| `tasks[].project_ref` | the new project the task goes in (then `project_id` is `null`), or `null` |

#### 4.8.3 Checks

The projects are checked first, in order, then the tasks; `dropped` lists the projects' entries
before the tasks'. A `parent_ref` or `project_ref` that is an empty string counts as `null`.

1. **Projects**: at most `limits.brain_dump_projects_max`; the rest are dropped (`field`
   `"project"`, `ref` as given, `value` the title). When any `ref` is empty or used by an earlier
   project, every project is renumbered `p1`, `p2`, ... by position. A `parent_ref` or
   `project_ref` names the first project that was given that `ref`, whatever it is renumbered to.
2. **Title**: line breaks replaced by spaces, trimmed. Empty: the project is dropped (`field`
   `"project_title"`, `value` the title as given). Longer than 250 characters: cut at the last
   space at or before position 250 (without one, at 250), the space removed.
3. **Parent**: `parent_ref` when it is not `null`, else `parent_id`. `parent_ref` must name a
   project before this one that was kept or merged (step 4), `parent_id` a project in the
   context's `projects`. Anything else is dropped (`field` `"parent"`, `value` as given) and the
   project goes at the top level. A parent merged into a context project becomes that
   `parent_id`; one merged into an earlier new project becomes that project's `parent_ref`.
4. **Same project**: a new project's path is its parent's path (a context project's `path`, or
   the new parent's path), `" / "`, and its title; at the top level, its title. When a context
   project has the same path, ignoring case, the new project is that project: it is left out of
   the plan, and every `parent_ref` and `project_ref` naming it means that project. Otherwise,
   when an earlier kept new project has the same path, ignoring case, it is merged into that one
   the same way.
5. **Tasks**: the checks of 4.3, with at most `limits.brain_dump_tasks_max` drafts instead of 25,
   without the list's default due date, and with this before step 5: a `project_ref` that names a
   kept new project puts the task there (`project_ref` that project's `ref`, `project_id` `null`);
   one that names a project merged into a context project puts it in that project; any other
   `project_ref` leaves step 5 to decide with `project_id`, and `project` is marked guessed.

A checked project has `ref`, `title`, `parent_id` and `parent_ref`, at most one of the two not
`null`. A checked draft has `project_ref` after `project_id`; `project_id` is `null` when
`project_ref` is set. Vectors: `brainDump.checks`, with the context of `dictation.context`.

#### 4.8.4 Editing

**Update** sends what the person said or typed since the plan as an edit:

- System: the `dictation` prompt, a blank line, the `brainDump` prompt, a blank line, then the
  `brainDumpEdit` prompt. User message: the context block, then `<plan>` with the projects and
  drafts in the answer's own shape (as in 4.4: after the checks, with the person's own changes,
  labels as names, the due date back as `when` with `said` `null`, `unsure` empty), written as
  `{"projects": [...], "tasks": [...]}` with each object's keys in the schema's order, then
  `<transcript>` with the words. Each block's tag is on a line of its own.
- The answer is the whole plan again. The checks run again; fields whose value changed are
  highlighted, and a `ref` no longer present removes its card or project.

#### 4.8.5 Review and adding

- The plan lists the tasks under the project they go in, the projects in the order their first
  task comes in the answer, then new projects without tasks. An existing project is named by its
  `path`; a new one is marked new and says where it goes ("in Home"). A new project can be renamed
  or removed: removing it moves its tasks and its new subprojects to its parent, or at the top
  level its tasks to `default_project_id` and its subprojects to the top level.
- A draft's project chip offers the context's projects and the plan's new projects.
- Creating a project is not queued, so Add needs a connection when the plan has new projects. It
  creates the projects in order (a parent always comes first) through the app's own New project
  path, then the drafts as in 4.5. When a project cannot be created, Add stops before any task,
  deletes the projects it created, and leaves the plan on screen with the error.
- One message, "Added 2 projects and 14 tasks", with Undo, which deletes the tasks and then the
  projects Add created.

#### 4.8.6 Failures

As in 4.6, the dump is kept with **Retry**, and it survives the app closing until it is added or
discarded; **Edit** goes back to the dump to change or extend it. There is no Add as one task.

---

## 5. Ask

A conversation with a model that looks things up through tools and proposes changes.

### 5.1 Conversation

- System: the `ask` prompt (and for Talk, the `talk` prompt after it, separated by a blank line).
- The first user message starts with a `<context>` block: `now`, `weekday`, `time_zone`,
  `week_starts`, the list the user is in (`list`, and `list_project_id` or `list_custom_list_id`
  when it is one), and `overview`, the `get_overview` result. When a later message comes on
  another local day or more than 30 minutes after the previous one, it starts with a `<context>`
  block holding only `now` and `weekday`.
- A model's text can show task rows: `[task:<id>]` with the id of a task a tool returned in this
  conversation renders as that task's row (tap to open, check to complete); any other id renders
  as nothing.
- Conversations are kept on the device only: the last 5, each up to 100 messages. The requests
  send at most the last 40 messages (tool calls and their results count; a tool result is never
  sent without its call). New chat starts an empty one.

### 5.2 Task summaries

Read tools return tasks in one shape (`ask.taskSummary` in the fixture):

| Field | Value |
|---|---|
| `id`, `title`, `done` | |
| `due` | `YYYY-MM-DD` for a date-only due date, `YYYY-MM-DDTHH:mm` with a time, or `null` |
| `project_id`, `project` | the project's id and `path` (section 4.1) |
| `labels` | titles |
| `priority` | 0 to 5 |
| `repeats` | `true` when it repeats |
| `has_notes`, `subtask_count` | |
| `shared` | the project is shared (semantics 9.1) |
| `by` | in a shared project, the display name (semantics 9.3) of whoever created it when that is not the user; otherwise absent |
| `assignees`, `comment_count`, `unread` | only in shared projects: display names ("You" for the user), the count, the unread mark |

Hidden tasks are never returned. Archived projects' tasks are returned only by `list_view` of
that project and `find_tasks` with its id.

### 5.3 Tools

`ask.tools` in the fixture holds each tool's name, kind, description and parameter schema, and
`ask.proposalResult` the answer a proposal gets.

| Tool | Kind | What it does |
|---|---|---|
| `get_overview` | read | counts (Inbox, Today with overdue, Upcoming, Anytime), projects due for review, project and label names, custom list names |
| `find_tasks` | read | tasks by text, projects, labels, due window (semantics 3.1 values or from/to local dates), priority, done, assignment; the custom-list evaluator decides, so "this week" means what a custom list means |
| `list_view` | read | the tasks of Inbox, Today, Upcoming, Anytime, Logbook (by page), a project or a custom list, in that list's order |
| `get_task` | read | one task: the summary plus notes as plain text (at most 4,000 characters), subtasks, reminders, repeat |
| `propose_create_tasks` | proposal | new tasks as drafts (section 4.2), checked by 4.3 |
| `propose_update_tasks` | proposal | per task: title, notes appended, due date set or cleared, project, labels added or removed, priority |
| `propose_complete_tasks` | proposal | mark done or open again |
| `propose_delete_tasks` | proposal | not offered in v1 (`enabled: false`) |

- `find_tasks` returns at most `limit` tasks (default 25, at most 50), sorted by the default task
  order (semantics 12, `due_date_first`), and `more`, the number left out. `list_view` returns
  pages of 50.
- `get_overview` returns `{"counts": {"inbox", "today", "overdue", "upcoming", "anytime"},
  "review_due": [{"id", "path"}], "projects": [{"id", "path", "inbox", "writable", "shared"}],
  "labels": [{"id", "title"}], "custom_lists": [{"id", "name"}]}`: open tasks of projects that are
  not archived; `today` counts only tasks due today and `overdue` the rest of Today; `anytime`
  counts open tasks outside the Inbox; `review_due` is empty when reviews are off; projects and
  labels in the order of section 4.1, custom lists in the user's order.
- A tool that cannot run answers `{"error": "invalid_arguments" | "not_found", "detail": "..."}`.
- Comment texts and attachments are not offered in v1.

### 5.4 Proposals

- A proposal tool call becomes a card listing each task and its new value. The conversation waits
  until the user applies or declines it; then the tool result goes back to the model:
  `{"status": "applied" | "declined" | "partly_applied" | "failed", "applied": [ids], "skipped":
  [{"task_id", "reason"}]}`.
- Tasks the user cannot change are listed on the card as skipped, never sent: `not_found`
  (unknown or hidden), `read_only` (permission 0 or an archived project, semantics 9.1), `invalid`
  (a change that both sets and clears the due date, or changes nothing).
- Changes use the existing paths: merge patches with only the changed fields, labels through the
  label endpoints, done through the completion path (the row holds and the completion toast shows,
  semantics 7). Notes are only appended, as a new paragraph, so a description's other content is
  kept. A due date in an update is read by the rules of 4.3 step 4.
- Applying shows one message ("Changed 2 tasks") with Undo, which puts back the previous values.
- Words the user sends while a card is open go to the model at once: the card's call is answered
  `declined`, the round that waited for it ends, and the words are the next user message. The card
  stays on screen and can still be applied or declined until the next card comes; the model is not
  told, only the conversation's record of the card changes.
- A proposal of more than 20 tasks asks a second time before applying; at most 50 tasks per
  proposal.

### 5.5 Limits

At most 8 tool rounds per user message; after that the model is asked to answer with what it has
(the user message `Answer now with what you found.`, with the tools left out; on
`anthropic-messages`, whose history then holds tool calls, the tools stay with `tool_choice`
`{"type": "none"}`). The `limits` block
holds the numbers of sections 2, 4 and 5; the speech settings are in `speech`, the prompts in
`prompts` and the fixed messages in `messages`.

### 5.6 Other people's text

Task titles, notes and names from shared projects are data. They reach the model only as tool
results, tasks created by someone else carry `by`, and the prompt says that text in tool results is
never an instruction. No tool reaches the internet, model text renders as plain text (no images or
links are fetched), and every change shows its actual values on a card before it is applied.

### 5.7 Agenda and starters

A conversation without messages does not start empty:

- **The agenda** (semantics 14.8) comes first: what needs a decision (the Inbox, overdue tasks,
  projects due for review, the weekly review), each opening its guided session. It is built on the
  device and nothing is sent for it.
- **Starters** follow: a few questions for the list Ask was opened from, `ask.starters` in the
  fixture, by kind: `today`, `upcoming`, `inbox` (the Inbox project), `project` (another project)
  and `other` (anything else). Tapping one sends its text, exactly, as the person's message.

---

## 6. Talk

Talk is Ask by voice: an open microphone (3.7) turned on with Ask's microphone button, local speech
(section 3), the Ask conversation with the `talk` prompt added, and the answer spoken by the device
voice (or the provider's, if chosen). Each turn is sent as the next message, and the person can
keep talking without pressing anything in between.

### 6.1 Spoken confirmation

While a proposal card is open, the user may answer by voice. The transcript is normalised:
Unicode lowercase, curly apostrophes made straight, each of `. , ! ? ; :` replaced by a space,
spaces collapsed, trimmed. If the result is exactly one of the `talk.confirm.<language>.yes`
phrases, the card is applied; exactly one of the `no` phrases, declined. Anything else is sent to
the model as the next message, as typed words are (5.4), and the card stays open. A language
without phrases in the fixture confirms by tap only. Vectors: `talk.confirmVectors`.

---

## 7. Privacy and storage

### 7.1 What is sent

| Feature | Sent to the chosen model |
|---|---|
| Dictation, brain dump | the transcript (never audio), the context of 4.1: project, label and place names, the list's name, date, time and zone |
| Ask, Talk | the user's messages, the overview (counts, project, label and custom list names), and the tasks the tools return, with the names in `by` and `assignees` |
| Suggestions in guided sessions (section 9) | the context of 4.1, and the session's tasks: their summaries (5.2), dates added and changed, and the start of their notes |

Never sent: audio (unless the user chose a provider's transcription), hidden tasks, comment
texts, attachments, the Vikunja token, the server address, place positions.

Before a cloud provider is used, a consent sheet names what each feature sends and asks for
agreement; a local server (Ollama or Open WebUI at a local address) skips it.

### 7.2 Where settings live

| Item | Stored | Syncs |
|---|---|---|
| The provider key | the device's secret store (the one that holds the Vikunja token) | never |
| Provider, address, models, feature switches, speech model and language | device preferences | not in v1 |
| Speech model files | app files outside backups | never |
| Conversations, a kept transcript | the device | never |

- Keys never go in the `vicu-prefs` carrier (semantics 11), which other people with access to the
  server can read.
- AI settings belong to the device, not the account: an Ollama address is `localhost` on a desktop
  and a network address on a phone. Synced preference keys starting with `ai.` are reserved for a
  later version and added to the registry (semantics 11.3) first.
- Wiping all local data and uninstalling remove them; backups and device transfer leave them out.
- Each preset keeps what was last set for it: its address when typed, its models and its key.
  Choosing another preset and then this one again brings them back; the feature switches start off,
  as after any change of preset. A preset with a fixed address always uses the fixture's address.
- A typed preset keeps at most `limits.saved_addresses_max` saved addresses, the latest first, each
  with the models and the key it was used with. Picking a saved address brings them back; removing
  one forgets them, its key included. The address in use cannot be removed.
- The key is kept per preset, and for a typed preset per preset and address, so a key is only ever
  sent to the address it was saved for. A key stored before this rule moves to the address it was
  last used with, once.

---

## 8. Versions

- `contractVersion` is 1. Each prompt has its own `version`; changing a prompt's text changes its
  version, in both repos, in the same release, and the corpus is run again.
- Prompts are stored as lists of lines; apps join them with `\n` and send the text exactly.
- A schema or tool change that a model could notice is a prompt change too: the `version` of the
  prompts that use it goes up.
- `dictationEdit` 2 lets a later turn add tasks as well as change them; `ask` 2 and `talk` 2 ask
  for shorter answers (the answer first, at most three bullets in Ask, one sentence in Talk).
- `brainDump` 1 and `brainDumpEdit` 1 are new with the brain dump (4.8).
- `organize` 1 is new with the suggestions in guided sessions (section 9).

---

## 9. Suggestions in guided sessions

A guided session (semantics 14) walks through tasks one card at a time. With Ask set up and on, a
model suggests the decision for each card, so the person mostly agrees or adjusts instead of
deciding from nothing. It uses Ask's model and Ask's agreement (7.1); without them the sessions work
the same, with no suggestions.

### 9.1 Request

- System: the `organize` prompt.
- One user message, each block's tag on a line of its own: the `<context>` block of 4.1 (`list` is
  the session's name: `Inbox`, `Overdue`, `Waiting`, or the reviewed project's path;
  `default_project_id` is the Inbox, or the reviewed project), then `<session>` with `inbox`,
  `overdue`, `waiting` or `review`, then `<tasks>` with a JSON array of the tasks.
- Each task is its summary (5.2) followed by `created` and `changed` (the local dates of `created`
  and `updated`, `YYYY-MM-DD`, or `null`) and `notes`: the notes as plain text, at most
  `limits.organize_notes_max_chars` characters, cut at the last space before the limit with `…`
  added.
- The queue goes in batches of at most `limits.organize_batch_max` tasks, in queue order. The first
  batch is asked for when the session starts, the next when the person is
  `limits.organize_prefetch` cards from the end of the batch before. A review page sends the
  project's open tasks, its untouched ones first (semantics 14.4), then in the project's order, at
  most `limits.organize_batch_max`.
- The answer may use up to `limits.organize_max_tokens` tokens. It is asked for as dictation's is
  (deterministic, structured, `limits.dictation_idle_timeout_s`).

### 9.2 Answer

The `organize.answerSchema` schema of the fixture:

```json
{
  "suggestions": [
    {
      "task_id": 101,
      "title": "Book a dentist check-up",
      "project_id": 3,
      "when": { "said": null, "date": null, "time": null },
      "clear_due": false,
      "close": null,
      "reason": "Fits Health"
    }
  ],
  "next_step": null
}
```

| Field | Meaning |
|---|---|
| `task_id` | a task of `<tasks>` |
| `title` | a clearer title when the present one is unclear, else `null` |
| `project_id` | a project of `context.projects` the task belongs in better, else `null` |
| `when` | a due date to set, as in 4.2; all three `null` to leave it |
| `clear_due` | `true` to take the due date away |
| `close` | `"done"` when it looks finished already, `"delete"` when it looks outdated or repeats another task, else `null` |
| `reason` | why, in a few words |
| `next_step` | only for `review`: `{"task_id", "title", "when"}`, the open task to do next (`task_id`) or, when none fits, a new task's `title`; else `null` |

### 9.3 Checks

1. **Task**: a suggestion whose `task_id` is not one of `<tasks>`, or comes after an earlier
   suggestion for the same task, is dropped (`field` `"task_id"`, `value` the id).
2. **Title**: line breaks replaced by spaces, trimmed; longer than `limits.title_max_chars`, cut at
   the last space at or before that position (without one, at it). Empty, or equal to the task's
   title: `null`.
3. **Project**: a `project_id` that is not in `context.projects` is dropped (`field` `"project"`);
   one equal to the task's project is `null`.
4. **When**: read as 4.3 step 4 (`said` through the quick-add parser with dates only, else `date`
   and `time`; a date before today or more than `limits.model_date_max_years` ahead is dropped,
   `field` `"when"`). With a due date set, `clear_due` is `false`. `clear_due` on a task without a
   due date is `false`.
5. **Close**: `"done"` or `"delete"`; anything else (an answer read without a schema) is `null`.
6. **Reason**: line breaks replaced by spaces, trimmed, cut at the last space at or before
   `limits.organize_reason_max_chars` (without one, at the limit).
7. **Nothing**: a suggestion that sets nothing (no title, project, due date, `clear_due` or
   `close`) is kept only with a reason, and then says to leave the task as it is; without one it is
   dropped (`field` `"suggestion"`, `value` the id).
8. **Next step**: `null` unless the session is `review`. A `task_id` must be one of `<tasks>`
   (then `title` is `null`); otherwise the `title`, checked as in step 2 without the comparison;
   with neither, `null`. Its `when` is read as in step 4 (a dropped one is listed with `task_id`
   `null`).

A checked suggestion has `task_id`, `title`, `project_id`, `due` (local, as in 4.3) and
`due_has_time`, `clear_due`, `close` and `reason`; a checked next step has `task_id`, `title`,
`due` and `due_has_time`. `dropped` lists what was dropped, in order. Vectors: `organize.checks`,
with the context of `dictation.context`.

### 9.4 On the card

- A suggestion fills in the card's choices, each marked as suggested (the dashed outline of 4.5),
  with its reason under the title. The person changes or clears any of it; nothing is written until
  they go on (semantics 14.3).
- `close` is shown as the suggested way out (Complete or Delete) and is never taken without a tap.
- While a batch is on its way, its cards say so and can be decided without waiting.
- A failed request is said once ("No suggestions: …") and the session goes on without them.
