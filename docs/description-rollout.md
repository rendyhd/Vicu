# Rich description rollout

This rollout covers the Electron desktop client and the Android client. The
wire format is defined in `description-format-v1.md`; neither client should
introduce client-specific IDs or active HTML into task descriptions.

## Release order

1. Release desktop with sanitization and the Quick View rich-content guard.
2. Release Android with the Cascade editor, safe HTML profile, and conflict UI.
3. During the overlap, older clients may retain unknown markup but must not be
   used to edit rich descriptions in a plain-text field.

No server migration is required. Existing descriptions are normalized only
when the rich editor publishes a user change. Title-only and other unrelated
updates continue to preserve the existing description.

## Compatibility checks

- Create and edit bold, italic, underline, strike, inline code, links, bullet
  lists, numbered lists, headings, blockquotes, and nested checklists in each
  client; verify the other client can edit them without structural loss.
- Verify `javascript:`, `data:`, event attributes, scripts, styles, iframes,
  forms, active SVG, and nested unsafe markup are not rendered or re-emitted.
- Verify image tokens and note/page-link envelopes survive edits unchanged.
- Verify a Quick View title edit cannot flatten a rich description.
- Verify a concurrent desktop/Android description edit presents the Android
  “Keep mine / Use server” decision before save.
- Verify an over-limit description remains read-only and byte-for-byte intact.

The shared cases live in `test-fixtures/description-format-v1.json`.

## Monitoring

Android logs Cascade import/export warnings under `CascadeDescription`.
Investigate repeated input-limit warnings, unexpected dropped-content warnings,
or reports of conflict prompts recurring after a choice. Desktop rendering and
editing pass through the shared sanitizer; sanitizer-policy regressions should
be added to the description helper tests and the shared fixture corpus.

## Rollback

- Desktop can roll back the toolbar additions independently, but retain the
  sanitizer and Quick View guard.
- Android can restore the description field to read-only/plain editing, but
  retain the format contract, metadata envelope handling, and conflict gate.
- Never roll back by converting stored HTML to plain text. That would make the
  rollback destructive for descriptions already edited by either rich client.

## Known platform boundary

Android unit tests and compilation are green on Windows. Kotlin/iOS dependency
resolution is aligned, but the repository's existing `commonMain` contains
Android/JVM-only APIs unrelated to this feature, so full iOS metadata compilation
is not currently a valid release gate. Fixing that source-set separation is a
separate KMP migration.
