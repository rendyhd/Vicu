---
title: The assistant
nav: The assistant
description: Set up Vicu's optional AI assistant with your own model, then use smart dictation, brain dump, Ask and Talk, and read what is sent and what stays on your device.
lead: The assistant turns what you say or paste into tasks and answers questions about your tasks. It uses a model you choose, it is off until you set it up, and it never changes anything without your tap.
---

## In short

- **It is optional and off.** Nothing is sent anywhere until you pick a provider, save a key and agree.
- **You bring the model.** Vicu has no AI service of its own. You choose a provider (OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama, Open WebUI or any compatible server) and use your own key.
- **It advises, you decide.** Tasks appear as draft cards you add or decline. Changes Ask proposes wait for your approval, and each has Undo.
- **Your key stays on the device**, encrypted, and is never synced.
- **Voice has two paths.** Quick capture turns a spoken sentence into one task and never uses the model. Smart dictation uses the model for several tasks at a time.
- **The phone and the desktop work the same way.** Where the entry points differ, this page says so.

## What it does and does not do

The assistant can:

- Turn speech or pasted text into one or many tasks ([smart dictation](guide:assistant#smart-dictation), [Make tasks from text](guide:assistant#make-tasks-from-text)).
- Turn a long ramble into a plan with projects ([brain dump](guide:assistant#brain-dump)).
- Answer questions about your tasks and propose changes ([Ask](guide:assistant#ask)), also by voice ([Talk](guide:assistant#talk)).
- Suggest steps for a task ([Break into steps](guide:assistant#break-a-task-into-steps)).
- Suggest a decision on each card in a [guided session](guide:review) and a day in [Plan my day](guide:plan).

It does not:

- Change, complete or delete anything by itself.
- Reach the internet, open links or look at images.
- Send audio anywhere. Only the recognized words are sent.
- Treat text from shared projects (titles, notes, other people's names) as instructions. That text is only data.
- Dictate inside the Quick Entry window. {desktop}

## Set it up {all}

:::steps
1. Open **Settings, Assistant**.
2. Under **Thinking**, choose a **Provider**.
3. Paste your **Key** and choose **Save key**. Ollama needs no key.
4. Pick a **Model**. **Load models** lists what your provider offers.
5. Under **Features**, turn on **Smart dictation**, **Ask** and **Talk**. Each has a **Try it** button.
:::

### Providers

OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama, Open WebUI, or **Other** for any server that speaks the OpenAI chat format. For Ollama, Open WebUI and Other you can change the address. Ollama's default is `http://localhost:11434/v1`. If the address needs a version part such as `/v1` and lacks it, Vicu hints at that. Each provider remembers its own address, models and key. Ollama, Open WebUI and Other keep up to five saved addresses, each with its own models and key (**Add address**).

### Models

Use one model for everything, or turn on **Use a different model for Ask** to give Ask and Talk their own. A model tests itself once chosen and the key is saved. The test checks that it can give a structured answer (needed for dictation) and call a tool (needed for Ask). **Test connection** runs it again.

If a model cannot run a feature, that feature's switch stays off and says why. Choose another model, or start your local server and turn it on again.

### Consent

The first time something would be sent to a provider that is not on your own network, Vicu shows what each feature sends and asks you to choose **Agree**. A server on your own computer or local network does not ask. An `http://` address that points outside your network gets a warning, because your key and text would travel unencrypted.

## Smart dictation

Smart dictation holds several tasks at once. Say "Buy milk, call the plumber on Friday about the leak, and book the dentist for next month". When you pause for about a second, your words go to the model and come back as **draft cards**, one per task, with title, notes, date and time, project, labels, priority, repeat, reminder and steps.

Keep talking. Each later pause is sent as a change to the cards ("make the first one Friday", "drop the dry cleaning") or as more tasks ("and call mom tomorrow"). If you start talking before the cards come back, that request stops and your words go out together after the next pause. Nothing is added until you choose **Add**, and then there is one Undo for the lot.

- Fix a card by hand or remove it. A dashed outline marks a value the model guessed.
- Dates are checked by Vicu's own [quick-add](guide:quick-add) rules, so "Friday" means what it means when you type it.
- A new task goes to the project of the list you are in, else your Inbox.
- If a request fails, the transcript is kept, also across a restart, so you can retry or add it as one plain task.
- The microphone turns off after a minute of silence. This is the open microphone: it keeps listening between pauses, so you can talk naturally.

### Start smart dictation

> [!DESKTOP]
> - Tap the voice shortcut (the one you set in **Settings, Keyboard Shortcuts, Voice input**). Tapping, not holding, starts smart dictation when it is ready.
> - Hold the **+** of a list and slide up to the sparkle. A chip says "Slide up to lock: smart dictation". The words so far carry over.
> - Choose **Dictate tasks** in the command palette (<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>, <kbd>Cmd</kbd> on a Mac).
> - The panel shows the words being heard. **Done** turns the microphone off. The microphone button turns it on again.

> [!PHONE]
> - Hold **+** and slide up to the sparkle.
> - Hold the app icon and choose **Dictate**. It opens listening in the smart dictation sheet for your Inbox when the assistant is ready.
> - On an iPhone you can also ask Siri to add a task, or use Shortcuts. See [Quick capture](guide:capture).

## Quick capture and smart dictation {all}

| | Quick capture | Smart dictation |
|---|---|---|
| Start | Hold **+**, or hold the voice shortcut, or **Say a task** in the palette | Slide up from a held **+**, tap the voice shortcut, **Dictate tasks** |
| Result | One task, read like quick add | Draft cards for you to review |
| Uses the model | Never | Yes |
| Needs the assistant | No | Yes |

Quick capture adds the task at once with Undo, to the list on screen. See [Capture](guide:capture) for how to hold the **+** and the voice settings.

## Brain dump

For a long ramble, turn on **Brain dump** in the smart dictation sheet, or choose **Brain dump** in the command palette. It is offered until something has been sent, and the sheet remembers it on this device. Then talk or type as long as you like. What you say is added to the end of the dump, which you can edit. Nothing is sent until you choose **Organize**.

The microphone stays on for five minutes without speech, and stops when the dump reaches 20,000 characters.

The answer is a plan:

- Tasks are grouped under the project they go in, with notes, steps, priority, dates and labels.
- Where none of your projects fit, it suggests **new projects and subprojects**, marked New. Rename a new project in place, or remove it. Its tasks move to where it would have gone. A suggestion matching a project you already have uses yours.
- Anything you say or type afterwards waits in a field until you choose **Update**, which sends it as a change ("put the shed tasks in Home", "add: book the dentist").

**Add** (**Add all** on the phone) creates the new projects first, then the tasks. New projects need a connection. If one cannot be created, nothing is added, and the projects already made are removed again. One message says what was added, such as "Added 2 projects and 14 tasks", with Undo. If organizing fails, the dump is kept, also across a restart: **Retry** sends it again, **Edit** goes back to it.

## Make tasks from text

Turn pasted notes or an email into task cards.

- **Desktop:** choose **Make tasks from text** in the command palette. Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to make the tasks.
- **Phone:** share the text to Vicu and choose **Make tasks**.

## Break a task into steps

The assistant proposes subtasks for a task, and you check them before they are added.

- **Desktop:** right-click the task and choose **Break into steps**.
- **Phone:** use the task's menu.

## Ask

Ask answers questions about your tasks, briefly, the answer first: "What is overdue in Work?" or "What did I finish last week?" It looks things up with a few read-only tools. Tasks it mentions show as rows you can open or tick. The list you are in is its starting point.

> [!DESKTOP]
> Press the **Ask** button (the sparkle) next to Search at the top of the sidebar, press <kbd>Ctrl</kbd>+<kbd>J</kbd> (<kbd>Cmd</kbd>+<kbd>J</kbd> on a Mac), or choose **Ask Vicu** in the command palette. Press <kbd>Enter</kbd> to send.

> [!PHONE]
> Tap the sparkle next to Search on any list. While Ask works there is a Stop button, and after a failure a Retry.

### Changes come as cards

When you ask Ask to add, change or complete tasks, it shows a card with each task and its new values. You apply or decline it. After applying, one message offers Undo.

- Notes are only ever added to, never replaced.
- A change to more than 20 tasks asks twice.
- You can change a due date on a proposal before applying it.

### Conversations

When the last conversation has been idle for more than 30 minutes, Ask opens a new one. The older ones stay in the conversation list; the last five are kept on this device. An empty conversation starts with what needs a decision (the Inbox, overdue tasks, projects due for review, the weekly review), each opening its session, and a few questions for the list you are in. Tapping a question sends it as written.

## Talk

Talk is Ask by voice. Turn on the microphone in Ask and talk. Each pause sends what you said, and the answer, usually one sentence, is read aloud with the system voice.

- The microphone waits while the voice speaks and listens again afterwards. Press the microphone button to stop the voice and talk at once.
- Start talking while an answer is coming and it is dropped. Your earlier and new words go out together.
- While a card waits, answer "yes" or "no" out loud. Anything else is sent as your next message.
- The microphone turns off if you press it again, close Ask, or stay silent for a minute.
- On the phone, with headphones, it keeps listening while it speaks.

## Speech on this device {all}

Voice normally uses the system's speech recognizer. Under **Settings, Assistant, Hearing** you can download a speech model so speech is recognized on the device, offline, with your project and label names as hints. Audio never leaves the device. Only the recognized text goes to the model.

- **Desktop:** models range from about 60 MB to about 870 MB. Larger ones are more accurate. The one marked **Suggested** is the recommended one. Choose **Download**, **Pause**, **Resume** or **Delete**, and use the radio button to pick which is **In use**. There is also a **Language** choice.
- **Phone:** a Parakeet model is recommended for phones, since the larger Whisper models are slow. Downloads happen on Wi-Fi unless you allow mobile data. On Android a 64-bit processor is needed.
- Without a downloaded model, the system recognizer is used. On macOS that is Apple's, on Windows the built-in offline recognizer, on Linux there is none.

## Privacy: what is sent and what stays {all}

Sent to your provider:

- **Dictation and brain dump:** the words (never audio), the names of your projects, labels and places, and the date and time.
- **Ask:** your messages and what its tools look up.
- **Guided sessions:** the same names and date, plus the session's tasks (title, project, dates, labels, priority, when they were added and changed, and the first 500 characters of notes).
- **Plan my day:** the same names and date, the candidate tasks, your free time and your routines' times without their names.
- **Calendar events:** never. Only free time ranges.
- **Pro's data:** only when **Assistant help in Pro** is on. See [Vicu Pro](guide:pro).

Kept on this device only:

- The last five conversations and any transcript kept after a failed request. They are deleted when you sign out, or when you choose **Delete conversations** under **Settings, Assistant, Privacy**.
- The assistant's settings and your key. They belong to the device, not to your Vikunja account. They are not synced and stay when you sign out.

The key is stored encrypted on the device and never written to a log.

## Assistant help in Pro {all}

[Pro](guide:pro) has its own switch, **Assistant help in Pro**, off by default. With it on, Ask can look up promises, people and the portfolio, an import can convert plain notes, and a meeting can draft promises from what was said. With it off, the assistant sees your tasks as before and none of Pro's records.

## Desktop and phone {desktop} {phone}

| | Desktop | Phone |
|---|---|---|
| Settings | **Settings, Assistant** | **Settings, Assistant** |
| Smart dictation | Tap the voice shortcut, slide up from **+**, **Dictate tasks** | Slide up from **+**, app icon **Dictate** |
| Ask | Button next to Search, <kbd>Ctrl</kbd>+<kbd>J</kbd>, **Ask Vicu** | Sparkle next to Search on any list |
| Make tasks from text | Command palette | Share text to Vicu |
| Break into steps | Right-click a task | Task menu |
| Speech models | Whisper Turbo suggested | Parakeet suggested |

## Related

- [Capture](guide:capture)
- [Quick add](guide:quick-add)
- [Review and guided organizing](guide:review)
- [Plan your day](guide:plan)
- [Vicu Pro](guide:pro)
