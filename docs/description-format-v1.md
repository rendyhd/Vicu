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

