# Vicu Description Format v1

Vicu task descriptions are shared between the desktop TipTap editor, the
Android/iOS Compose editor, Vikunja, widgets, quick views, and older clients.
This document defines the subset that Vicu may edit and persist without data
loss. Editor implementations may differ, but their serialized documents must
conform to this contract.

## Envelope

A stored description consists of an editable HTML body followed by optional
Vicu metadata. Editors must split the envelope before importing HTML and merge
it only when saving.

1. Canonical HTML body.
2. `[[image:ID]]` or `[[image-pending:UUID]]` tokens, one per line.
3. Preserved `notelink` and `pagelink` comment/anchor pairs.

Opening a description must not publish canonicalization. The first genuine
edit may publish canonical output. The canonical empty body is the empty
string, not `<p></p>`.

## Editable elements

The v1 editable set is:

- blocks: `p`, `blockquote`, `pre`, `h1` through `h6`, `hr`;
- inline: `br`, `strong`, `em`, `u`, `s`, `code`, `a`;
- lists: `ul`, `ol`, `li`;
- TipTap task lists using `data-type="taskList"`,
  `data-type="taskItem"`, and `data-checked`.

Canonical aliases are `strong` for `b`, `em` for `i`, and `s` for `del`,
`strike`, or `s`. Inline links may use only `https`, `http`, or `mailto`.
Relative links, `javascript`, `data`, `file`, and application-specific schemes
are not part of the editable body. Obsidian and browser task links remain in
the metadata envelope.

## Task lists

Task lists use TipTap-compatible HTML:

```html
<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label contenteditable="false"><input type="checkbox"><span></span></label><div><p>Task text</p></div></li></ul>
```

`data-task-id` is not canonical because desktop TipTap does not preserve it.
Nested task items are represented by nested task-list `ul` elements. A client
may use internal block identifiers, but must not require them to survive a
round trip through another client.

## Allowed attributes

- `a`: `href`, and optionally `title`;
- task-list `ul` and `li`: `data-type`, `data-checked` as applicable;
- task-list `label`: `contenteditable="false"`;
- task-list `input`: `type="checkbox"`, `checked`, `disabled`;
- ordered lists: `start` when supported by both clients.

`target` and `rel` are render-time attributes. Renderers should add
`target="_blank"` and `rel="noopener noreferrer"` rather than treating them as
meaningful stored content. Event handlers, inline styles, arbitrary classes,
form attributes, and unrecognized `data-*` attributes are forbidden.

## Unsupported HTML

Safe but unsupported block HTML may be retained as an opaque block only after
it has been recursively sanitized. It must never be re-emitted from an
unvalidated raw slice. Unsafe elements and attributes are removed regardless
of nesting, including `script`, `style`, `iframe`, `object`, `embed`, forms,
event handlers, unsafe URLs, and active SVG content.

If input exceeds the editor limit, the exact original description remains
read-only. A client must not replace it with a truncated or empty document.

## Markdown input

Markdown is a way of writing notes, never a storage format: text that uses it
becomes the editable HTML above, and stored descriptions are never read as
Markdown. Both editors do the same two things.

**Paste.** Text pasted without an HTML version on the clipboard is converted
with the rules below when the conversion reports `isMarkdown`; otherwise it is
pasted as plain text, as before. (Desktop also leaves Shift+paste, "paste as
plain text", alone.) A result of one paragraph is inserted into the current
line; anything else is inserted as blocks at the cursor.

**Typing.** In a paragraph, typing a space right after a marker at the start
of the line turns the line into: `#` to `######` a heading, `>` a quote, `-`
`*` `+` a bullet list, a number and `.` or `)` a numbered list, `[ ]` or `[x]`
a checklist item (also at the start of a bullet item, so `- [ ] ` typed in one
go works), three backticks or three tildes a code block, and `***` or `___` a
divider; typing the third `-` of a line that is only `---` also makes a
divider. Typing the closing marker of `**bold**`, `__bold__`, `*italic*`,
`_italic_` or `~~strike~~` formats the text between and removes the markers
when the opening marker starts the line or follows whitespace; `` `code` ``
only needs the opening backtick not to follow another backtick. Typing the `)`
of `[text](url)`, at the start of the line or after whitespace, makes a link
when the URL qualifies (below). The next character typed is not formatted.
Undo right after puts the typed characters back. These are the desktop
editor's (TipTap) input rules; the patterns are in Android's
`MarkdownShortcuts.kt`.

The vectors are the `markdown` array of `description-format-v1.json`: for each
`markdown` input, `html` is the exact output and `isMarkdown` the flag. Both
implementations must produce them byte for byte.

### Blocks

Line endings are normalized to `\n`. A tab in leading whitespace counts as four
columns. Lines are read in order; the first rule that applies wins.

1. Inside an open code fence, a line of the fence's character at least as long
   as the opening fence (up to three spaces before it, spaces after) closes it;
   any other line is code, with up to the opening fence's indentation removed.
   End of input closes the fence.
2. A blank line ends a quote. It ends an open list unless the next non-blank
   line is a list item or is indented more than the top-level items.
3. A list item: optional indentation, a marker (`-`, `*`, `+`, or 1 to 9 digits
   followed by `.` or `)`), at least one space or tab, then the content. A
   bullet whose content starts with `[ ]`, `[x]` or `[X]` (followed by
   whitespace or the end) is a checklist item; the rest after the whitespace is
   its text. Lists are nested by indentation: an item indented more than the
   current list starts a list inside that list's last item; less indented
   closes lists until one is not deeper than it. At the same depth, an item of
   the same kind (bullet, numbered, checklist) joins the list, another kind
   starts a new list (a new top-level list, or a second list in the same
   parent item). A line that is a thematic break (6) is never an item.
4. A line indented more than the top-level items, while a list is open, is
   another paragraph of the deepest item it is indented under (lists deeper
   than or level with it are closed first). Inside an item only paragraphs and
   nested lists exist: other block syntax there is text.
5. A fence: up to three spaces, then three or more backticks or tildes, then
   an info string that is ignored (a backtick fence's info string may not
   contain a backtick). It starts a code block.
6. A thematic break: up to three spaces, then three or more of the same `*`,
   `-` or `_`, with only spaces or tabs between and after. It is a divider.
7. A heading: up to three spaces, one to six `#`, whitespace, then text;
   trailing whitespace and a closing run of `#` preceded by whitespace are
   removed. Without text it is not a heading.
8. A quote line: up to three spaces, `>`, an optional space or tab, then
   text. Consecutive quote lines form one quote; each non-blank one is a
   paragraph in it. Other block syntax inside a quote is text.
9. Anything else is a paragraph of its own: every line is one paragraph, with
   its leading and trailing whitespace removed.

Any open list, quote or fence is closed when a different block starts (a fence
by end of input). Output: a paragraph is `<p>`, a heading `<hN>`, a quote
`<blockquote><p>…</p>…</blockquote>` (left out when it has no paragraph), a
divider `<hr>`, code `<pre><code>…</code></pre>` with the lines joined by
`\n`, escaped and not otherwise read, lists `<ul>` / `<ol>` with
`<li><p>…</p>…nested lists…</li>`, and checklists the task-list HTML of this
contract, with `<input type="checkbox" checked="checked">` for a checked item
and the item's paragraphs and nested lists inside its `<div>`. A numbered list
always starts at 1. Top-level blocks are joined by one `\n`; blank input gives
the empty string.

### Inline

Text is read left to right; at each position the first rule that applies wins.
Text that no rule takes is escaped (`&`, `<`, `>`, `"`).

1. A backslash before ASCII punctuation gives that character as text.
2. A run of backticks opens a code span closed by the next run of exactly the
   same length; one space is removed from each end when both ends have one and
   the content is not only spaces. The content is escaped and not otherwise
   read. Without a closing run, the run is text.
3. `![…](…)` that would be a link (4) stays as its text: images are not part of
   this format.
4. A link `[text](destination)` or `[text](destination "title")` (or with
   `'title'`): the brackets balance, skipping escaped characters and code
   spans; the destination is `<…>` or runs without whitespace to the `)` that
   balances its parentheses; spaces or tabs are allowed around it, and the
   title needs a space or tab before it. The destination qualifies when,
   trimmed, it is `http://` or `https://` followed by at least one character,
   or `mailto:` followed by at least one character, case-insensitive, with no
   whitespace or control character. It gives `<a href="…">` (with `title="…"` when there is a
   title), its text read by these rules except links and URLs. A destination
   that does not qualify leaves the bracket as text.
5. `<destination>` whose destination qualifies and has no whitespace gives a
   link with the destination as its text.
6. A bare `http://` or `https://` URL (case-insensitive) at the start or after
   whitespace or `(` runs to whitespace or `<`; then trailing `.,:;!?'"*_~` and
   a `)` that has no `(` to match are removed, repeatedly. It gives a link with
   the URL as its text when something follows `//`. This alone does not make
   the text Markdown.
7. Strikethrough: two `~` not followed by a third or by whitespace, closed by
   the next run of exactly two `~` (skipping escapes and code spans) that does not follow
   whitespace and is not right after the opener. `<s>`.
8. Emphasis with `*` or `_`: a run of `n` such characters opens when the
   character after it is not whitespace and, for `_`, the character before it
   is not a letter or digit. With `k` = min(`n`, 3), try `need` = `k`, then
   each smaller value down to 1: look from after the run (skipping escapes and
   code spans) for a run of the same character that does not follow
   whitespace, is not right after the opener, for `_` is not followed by a
   letter or digit, and is exactly `need` long or longer (a `need` of 1 does
   not take a run of two). The closer is the last `need` characters of that
   run. The first `n` − `need` characters of the opener are text. `need` 3
   gives `<em><strong>…</strong></em>`, 2 `<strong>`, 1 `<em>`. Without a closer
   for any `need`, the whole run is text.

Content between delimiters is read by the same rules. `isMarkdown` is true when
any block other than a paragraph was made, or any inline rule except 3 and 6
applied.

## Task links

A `notelink` or `pagelink` pair is kept through every edit, whatever address it
holds (compatibility invariant 6). Whether an app offers to open the address is
a separate rule, because anyone who may edit the task can write the pair, and
an `obsidian:` address can do more than open a note (run a command, write a
file).

- A `pagelink` address is offered when it starts with `http://` or `https://`.
- A `notelink` address is offered only in one of the two shapes Vicu writes,
  compared as text after the HTML entities of the comment are decoded:
  - `obsidian://open?` with the parameters `vault` and `file`;
  - `obsidian://advanced-uri?` with the parameters `vault` and `uid`.

  Exactly those two parameters, each once, in either order, as `name=value`
  joined by `&`. The scheme, the action and the names are lower case and never
  percent-encoded. `file` and `uid` are not empty; `vault` may be. The address
  holds no `#`, `"`, `<`, `>`, space or control character and is at most 2048
  characters long.

Any other Obsidian address (another action, a third parameter such as
`commandid`, `data`, `mode`, `eval`, `path` or `filepath`, the
`obsidian://vault/...` short form) is not offered: no link icon is shown and
nothing is opened. The pair stays in the description. The same test runs again
where the address is handed to the system, not only where the icon is drawn.

The `noteLinks` vectors of `description-format-v1.json` pin the rule.

## Synchronization

An editor session tracks a server revision, a baseline document, a draft, and
dirty state. A clean editor accepts a newer server document. A dirty editor
must not silently replace or overwrite a different newer server document.
Local acknowledgements are correlated to one pending emission or revision;
they are not inferred from an unbounded history of HTML values.

Vikunja updates always send the latest complete task object. The editor body is
merged into the latest task state so remote labels, dates, reminders, project,
priority, and relations are not overwritten by stale values.

## Compatibility invariants

For every supported fixture:

1. Desktop decode/encode equals canonical HTML.
2. Compose decode/encode equals canonical HTML.
3. Desktop output round-trips through Compose without semantic loss.
4. Compose output round-trips through desktop without semantic loss.
5. Sanitized output contains no executable content or unsafe URL.
6. Metadata survives body-only edits byte-for-byte except for documented
   envelope newline normalization.

