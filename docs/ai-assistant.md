# The assistant (desktop)

Vicu can use a language model you choose to turn what you say or paste into tasks, and to answer
questions about your tasks. It is off until you set it up, and nothing is sent anywhere before you
agree to it. Vicu mobile has the same assistant and reads everything the same way; the rules both
apps follow are in `docs/ai-assistant-v1.md`.

## Setting it up

Settings, Assistant has two halves, with the features between them:

- **Thinking** is the language model: it turns your words into tasks and answers your questions,
  and it runs at your provider.
- **Hearing** is speech recognition: it turns your voice into text on this computer (see Speech on
  this computer below). Only the text goes to the model.

Under Thinking:

1. **Provider**: OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama, Open WebUI, or any other
   server that speaks the OpenAI chat format. For Ollama, Open WebUI and "Other" you can change
   the address (Ollama's default is `http://localhost:11434/v1`).
2. **Key**: paste the provider's API key and press Save key. The key is kept encrypted on this
   computer, like your Vikunja sign-in; it is never synced to your other devices and never
   written to a log. Ollama needs no key.
3. **Model**: one model for everything; Vicu fills in the provider's quicker suggestion, and Load
   models lists what the provider offers. Turn on **Use a different model for Ask** to give Ask
   and Talk a model of their own (turning it off gives them the main model again). A model is
   **tested by itself** once it is chosen and the key is saved (or none is needed): the test
   checks that the model can give a structured answer (needed for dictation) and call a tool
   (needed for Ask). **Test connection** runs it again.

Then, under **Features**, turn on **Smart dictation**, **Ask** and **Talk**. Each says where to
find it and has **Try it**. **Brain dump** is listed there too, with Try it; it has no switch of
its own there, because it is a switch in the smart dictation sheet (see Brain dump below). Turning one on whose model has not been tested yet tests it first and
turns it on when it passes. When the model cannot run it, the switch stays off and says why (the
test's own problem, or that the feature needs a structured answer or a tool call: choose another
model); turning it on again tests again, for example once a local server is running.

The first time something would be sent to a provider that is not on your own network, Vicu shows
what will be sent and asks you to agree. A server on your own computer or local network (Ollama,
Open WebUI) does not ask. An `http://` address that points outside your network gets a warning,
because the key and your text would travel unencrypted.

## Quick capture and smart dictation

Voice has two ways in (`docs/voice-input.md`):

- **Quick capture**: hold + (or hold the voice shortcut) and let go, or "Say a task" in the command
  palette. The words become one task through quick add and are added at once, with Undo. The
  model is never used, whether or not smart dictation is on.
- **Smart dictation**: tap the voice shortcut instead of holding it, or hold + and slide up to the
  sparkle, or "Dictate tasks" in the command palette. The microphone stays on until you press Done.
  Words you said before the lock are kept.

## Smart dictation

Smart dictation can hold several tasks at once: "Buy milk, call the plumber on Friday about the
leak, and book the dentist for next month". When you pause for about a second, what you said is
sent and becomes **draft cards**, one per task, with the title, notes, date and time, project,
labels, priority, repeat, reminder and steps the model read. Keep talking: each later pause sends
what you said since as a change to the cards ("make the first one Friday", "drop the dry
cleaning") or as more tasks ("and call mum tomorrow"). If you start talking again before the
cards have come, that request is stopped and your words go out together after the next pause.
Nothing is added until you press Add.

- The panel shows the words being heard. Done turns the microphone off (what you were saying
  still goes out); the microphone button turns it on again. It also turns off after a minute
  without speech.
- Fix a card by hand or remove one with its close button. Fields that changed are highlighted.
- Dates are checked by Vicu's own quick-add rules, so "Friday" means what it means when you type
  it. A value the model guessed, or one Vicu had to drop, is marked on the card.
- A new task goes to the project of the list you are in, else your Inbox, as a typed task would.
- **Make tasks from text** (command palette) does the same with text you paste, such as notes or
  an email.
- **Break into steps** (right-click a task) asks the model for the steps of that task and adds
  them as subtasks after you check them.
- If a request fails (no connection, the model did not answer), the transcript is kept, also
  across a restart, so you can try again or add it as one plain task.

## Brain dump

For a long ramble, turn on **Brain dump** in the smart dictation sheet (it is offered until
something has been sent, and the sheet remembers it on this computer; the note under the switch
says what it does). You can also choose "Brain dump" in the command palette. Then talk, or type,
for as long as you like: what you say is added to the end of the dump, which you can edit, and
nothing is sent. The microphone stays on for five minutes without speech, and stops when the dump
reaches 20,000 characters. Press **Organize** to send the whole dump at once.

The answer is a plan: the tasks grouped under the project they go in, with notes, steps,
priority, dates and labels, and any **new projects and subprojects** the model suggests where none
of yours fit (marked New, with where they go, such as "in Home"). A suggested project that you
already have is used instead of made again. Rename a new project in place, or remove it: its tasks
and subprojects move to where it would have gone. Fix the cards as in smart dictation; a card's
project list also offers the new projects. Anything you say or type after the plan waits in a
field until you press **Update**, which sends it as a change to the plan ("put the shed tasks in
Home", "add: book the dentist"); what changed is highlighted.

**Add** creates the new projects first and then the tasks. New projects need a connection; if one
cannot be created, nothing is added, the projects already made are removed again, and the plan
stays on screen. One message says what was added ("Added 2 projects and 14 tasks") with Undo,
which removes the tasks and then the projects. If organizing fails, the dump is kept, also across
a restart: **Retry** sends it again, **Edit** goes back to it.

## Ask and Talk

Press the **Ask** button (the sparkle) next to Search at the top of the sidebar, Mod+J (Cmd+J on a
Mac, Ctrl+J elsewhere), or choose "Ask Vicu" in the command palette. Ask answers questions about
your tasks ("what is overdue in Work?", "what did I finish last week?") briefly, the answer first,
by looking them up through a few read-only tools; tasks it mentions show as rows you can open or
check off. The list you are in is its starting point. When the last conversation has been idle
for more than 30 minutes, Ask opens on a new one; the older ones stay in its conversation list.

Ask never changes anything by itself. When you ask it to add, change or complete tasks, it shows a
card with each task and its new values; you apply or decline it. Applying shows one message with
Undo. Notes are only ever added to, never replaced. A change to more than 20 tasks asks twice.

**Talk** is Ask by voice: turn on the microphone in the Ask pane and just talk. Each pause sends
what you said as your next message, and the answer, usually one sentence, is read aloud with the
system voice. The microphone pauses while the voice speaks and listens again when it ends; press
the microphone button to stop the voice and talk at once. Start talking while an answer is still
coming and it is dropped: your earlier and new words go out together. While a card is open you can
answer "yes" or "no" out loud; anything else is sent as your next message. The microphone turns
off when you press it again, close Ask, or after a minute without speech.

Text from shared projects (titles, notes, other people's names) is treated as data, never as an
instruction to the model, and the model cannot reach the internet or fetch images or links.

An empty conversation starts with what needs a decision (the Inbox, overdue tasks, projects due for
review, the weekly review), each opening its guided session, and a few questions for the list you
are in; pressing one sends it as written.

## Suggestions in guided sessions

The guided sessions (sorting the Inbox, overdue tasks, tasks waiting a long time, and the project
review; see `docs/guided-organizing.md`) work without the assistant. With Ask set up, Ask's model
suggests a decision for each card: the choices are filled in with a dashed outline and the reason
is under the title. Nothing is saved until you press Next, and Complete or Delete are only marked
"Suggested", never done for you.

## Suggestions in Plan my day

Plan my day (see `docs/planner.md`) works without the assistant too. With Ask set up, a switch in the
session adds Ask's model: what to do with each leftover, how long tasks take, tasks worth adding, what
can wait, and an order with start times. Each is dashed with a short reason, and nothing is saved
until you tap. It asks once when the session opens and again when you change the day or press Ask
again.

## Speech on this computer

Voice input normally uses the system's recogniser. Under Hearing you can download
a speech model (from about 60 MB to about 870 MB; larger ones are more accurate) so that speech is
recognised on this computer, offline, with the names of your projects and labels as hints. Audio
never leaves the computer: only the recognised text goes to the provider. Downloads can be paused
and resumed, and a model can be deleted again.

## What stays where

- Sent to the provider: for dictation and brain dump, the words (never audio) with the names of
  your projects, labels and places and today's date and time; for Ask, your messages and what its
  tools look up; for suggestions in a guided session, the same names and date with the session's
  tasks (their summaries, when they were added and changed, and the start of their notes); for
  Plan my day, the same names and date with the candidate tasks' summaries and the start of their
  notes, your free time and your routines' times, without their names.
- On this computer only: the last five conversations and any transcript kept after a failed
  request. They are deleted when you sign out, or with Delete conversations in Settings,
  Assistant, Privacy.
- The assistant's settings and key belong to this computer, not to your Vikunja account: they are
  not synced and stay when you sign out.
