# Translating Vicu

Vicu is written in English. This page explains how to add a language or improve one, for the desktop app and for the mobile app (Android and iOS). You do not need to be a programmer: a translation is one text file per app (two small ones on mobile), and a pull request.

This page is the same in both repositories:

- Desktop: [rendyhd/Vicu](https://github.com/rendyhd/Vicu)
- Mobile: [rendyhd/Vicu-Mobile](https://github.com/rendyhd/Vicu-Mobile)

The two apps have their own files, because each uses the format its platform's tools expect. Much of the text is the same in both, so it is quickest to translate them together.

## Where things stand

Nearly all the text both apps show is in the catalogs now. A few small pieces are still English in every language (see "What is not translated" below), and new versions add new texts, so a catalog grows over time. A translation never has to be complete: whatever is missing shows in English.

## The short version

| | Desktop | Mobile |
|---|---|---|
| English source | `locales/en.json` | `shared/src/commonMain/composeResources/values/strings.xml` |
| Your language | `locales/<tag>.json` | `shared/src/commonMain/composeResources/values-<tag>/strings.xml` |
| Example for Dutch | `locales/nl.json` | `values-nl/strings.xml` |
| Example for Brazilian Portuguese | `locales/pt-BR.json` | `values-pt-rBR/strings.xml` |
| Placeholders | `{{name}}` | `%1$s`, `%1$d` |
| Check | `npm run i18n:check` | `./gradlew :shared:testAndroidHostTest --tests "*TranslationsTest"` |

1. Copy the English file to a file for your language (or open the one that exists).
2. Translate the text. Leave names, placeholders and tags as they are.
3. Run the check if you can; the pull request runs it too.
4. Open a pull request. Say which language it is and whether you are a native speaker.

Nothing else has to change on the desktop: a new file in `locales/` is a new language in Settings. On mobile one command lists the new language for Android and iOS (see below); a maintainer can run it for you.

## Language tags

A language is named by its tag: two or three letters for the language (`de`, `nl`, `ja`), and a region only when the language is written differently there (`pt-BR` and `pt-PT`, `zh-CN` and `zh-TW`). Use the plain language when one translation serves everyone who reads it.

On mobile the folder name writes the region with an `r`: `values-pt-rBR`.

A reader gets the closest language Vicu has. Someone whose system is set to `nl-BE` gets `nl`; someone with `pt-PT` gets `pt-BR` when that is the only Portuguese.

## Desktop

The file is JSON: groups of names with text.

```json
{
  "nav": {
    "inbox": "Inbox",
    "today": "Today"
  },
  "language": {
    "system": "System default ({{language}})",
    "note": "Text that is not translated yet shows in English. <guide>Help translate Vicu</guide>"
  },
  "completion": {
    "toast_one": "Completed",
    "toast_other": "{{count}} completed"
  }
}
```

Translate only the text on the right of each colon. Keep the names on the left exactly as they are.

**Placeholders.** `{{language}}` and `{{count}}` are filled in by the app. Keep them, spelled the same, and put them where they belong in your sentence. Do not translate the word inside the braces.

**Tags.** `<guide>...</guide>` marks the words that become a link or get an emphasis. Keep the tag and translate the words inside it.

**Plurals.** A name that ends in `_one` and `_other` is one sentence in its plural forms. English has two forms. Your language may have more or fewer, and each form is its own line:

| Ending | Used by |
|---|---|
| `_zero` | Arabic, Welsh, Latvian |
| `_one` | most languages |
| `_two` | Arabic, Welsh, Slovenian |
| `_few` | Polish, Czech, Russian, Arabic and others |
| `_many` | Polish, Russian, French, Spanish, Arabic and others |
| `_other` | every language |

Give every form your language has, and no other. Polish needs `toast_one`, `toast_few`, `toast_many` and `toast_other`; Japanese only `toast_other`. If you are not sure which forms your language has, run the check: it names the ones that are missing.

**Check your work.** With Node.js installed:

```bash
npm install
npm run i18n:check
npm run i18n:status
```

`i18n:check` lists every problem with the file and the name it is in. `i18n:status` shows how much of the source each language has.

**See it in the app.** `npm run dev` starts Vicu. Choose your language under Settings, General, Language. The change shows at once, without a restart.

## Mobile

The file is the Android string format, which the iPhone app reads too.

A second, smaller file holds the text that only Android shows outside the app: the names of the widgets, the quick-add tile and the shortcuts, the notification channels and the buttons on notifications. Its English source is `app/src/main/res/values/strings.xml`; translate it as `app/src/main/res/values-<tag>/strings.xml`, in the same format and with the same rules, with one difference: in this file an apostrophe is written `\'` (see below). `app_name` stays `Vicu`.

```xml
<resources>
    <string name="language_name">English</string>
    <string name="nav_today">Today</string>

    <!-- The message after tasks were completed. %1$d is how many. -->
    <plurals name="completion_toast">
        <item quantity="one">Completed</item>
        <item quantity="other">%1$d completed</item>
    </plurals>
</resources>
```

Translate the text between the tags. Keep every `name` as it is. A comment above a string in the English file tells you where the text is shown; you do not need to copy the comments.

**`language_name`.** Write the name of your language in your language: `Nederlands`, `Deutsch`, `Français`. Settings shows it as the language in use.

**Placeholders.** `%1$s` is replaced by text and `%1$d` by a number; the digit is the position, so a sentence with two keeps both and may swap their order. Keep them exactly.

**Plurals.** Give an `<item>` for every quantity your language has (`zero`, `one`, `two`, `few`, `many`, `other`), and no other. The table above applies here too.

**Special characters.** Write apostrophes and quotes as they are (`'`, `"`, or the typographic `’`), without a backslash: a backslash would show on screen. Write `&` as `&amp;` and `<` as `&lt;`. Only in the Android file `app/src/main/res/values-<tag>/strings.xml` is an apostrophe written `\'`.

**List the language.** After adding a new `values-<tag>` folder, run:

```bash
./gradlew syncLanguages
```

It writes the language into the two lists Android and iOS read (`app/src/main/res/xml/locales_config.xml` and `iosApp/Vicu/Info.plist`). Commit what it changes. If you cannot run Gradle, leave this step to a maintainer and say so in the pull request.

**Check your work.**

```bash
./gradlew :shared:testAndroidHostTest --tests "*TranslationsTest"
```

**See it in the app.** The mobile app follows the language the system keeps for it. On Android 13 and later: Settings, Apps, Vicu, Language. On iPhone and iPad: Settings, Vicu, Language (the row appears when the device has more than one preferred language). Vicu's own Settings has a Language row that takes you there. On Android 12 and older the app follows the language of the device.

## Writing a good translation

- **Say what the English says, the way your language says it.** Translate the meaning, not the words. Vicu's English is plain and short: no jargon, no exclamation marks.
- **Keep it short.** Buttons, menu items and list names have little room. If the natural translation is much longer than the English, look for a shorter one.
- **Be consistent.** Use one word for one thing everywhere: if "task" is `taak` in one place, it is `taak` in all of them. When the desktop and the mobile app say the same thing, translate it the same.
- **Follow your platform.** For Cut, Copy, Paste, Undo, Settings and the like, use the words your operating system uses.
- **Choose one form of address** (formal or informal) and keep to it. When in doubt, use the one other apps in your language use.
- **Do not translate names.** Vicu, Vikunja, Obsidian and other product names stay as they are. Feature names such as Quick Entry and Quick View may be translated when your language has a natural name for them; otherwise keep them.
- **Capitals.** English writes "Select All"; most languages write only the first word with a capital. Follow your language.
- **Leave out what you are not sure about.** A missing text shows in English, which is better than a guess.

## Text Vicu writes for other people

Most of Vicu's text is read by the person using it. Some of it is written for someone else: with Vicu Pro, the agenda and the recap of a meeting, a short message that checks on an action, and a weekly note are copied and pasted into a mail or a chat. That text has its own part of each catalog: the `proText` group on the desktop, and the strings whose names start with `pro_text_` on mobile. Both hold the same sentences.

- **Its language is chosen apart from the app's.** A person can read Vicu in Dutch and send a recap in English, or the other way round: the language is set per group, with a default in Settings, Pro. So translate these sentences even when the rest of your translation is not complete, and keep them correct on their own.
- **Write it the way a colleague would.** These lines land in someone's inbox with no Vicu around them. Keep them short and neutral: no greeting beyond the one that is there, nothing that sounds like software.
- **A line is one whole sentence.** `{{owner}}: {{title}}, by {{date}}` becomes one line of a list. Keep every placeholder; move them to where your language puts them. Names, task titles and what people typed are filled in as they are and are never translated.
- **Days are written for you.** `{{date}}`, `{{from}}` and `{{to}}` are a day in the text's language ("Thu 12 Nov", "do 12 nov"). Do not add a weekday or a month yourself.
- **Counts have plural forms** like any other text (`_one`, `_other`, and the forms your language needs).
- **Do not change the meaning of a line.** "Late" and "dropped" say what happened to an action; a softer word would say something else to the reader.

A sentence that is missing from your language is written in English, so a recap is never half in one language by accident: check the whole `proText` group when you translate it.

## What is not translated

- **What you type.** Quick add reads dates and shortcuts in English ("tomorrow 3pm", "every week"), in every language, for now.
- **Your own data.** Task titles, project names, labels and notes are yours and are never changed.
- **Dates.** Month and weekday names come from your system's region, not from the catalogs.
- **Text from other places.** Messages from your Vikunja server, and the answers of an assistant model.
- **Small iOS pieces** that have their own files and are not part of this framework yet: the iOS widgets and the permission questions the system asks.
- **The website and the user guide.**

## Sending your translation

Open a pull request against the `pro` branch of the repository the file belongs to (one for the desktop, one for mobile); the catalogs reach `main` with the next release, and from then on `main` is the branch to use. The checks run on every pull request. If one fails, its message names the file and the text and says what is wrong.

You can also open an issue to say you would like to translate a language, to ask what a text means, or to report a mistake in a translation.

By sending a translation you agree that it is published under the same license as the app (MIT).

## For maintainers

- **Formats.** The desktop catalog is i18next JSON (version 4: nested keys, plural forms as `_one` and `_other` endings). The mobile catalog is Android string resources as Compose Multiplatform reads them. Hosted translation services such as Weblate and Crowdin read and write both, so the repositories can be connected to one later without changing the files: one component per app, English as the source.
- **Adding text** is a developer's job and is described in each repository's `CLAUDE.md` under "Translations": new text goes into the English catalog, never into the code, and the tests refuse text that is written into the code.
- **Changing English text.** When the meaning changes, give the string a new name, so that old translations are not shown for a new meaning; the check then reports the old name in each translation. A fix of a typo keeps its name.
- **Removing text.** Remove the name from the English file and from every translation; the check reports names that no longer exist.
- **A new language** on mobile needs `./gradlew syncLanguages`. Before a language with right-to-left script (Arabic, Hebrew, Persian) ships, the layouts need a pass of their own: the framework sets the direction, but the screens have not been checked in it.
