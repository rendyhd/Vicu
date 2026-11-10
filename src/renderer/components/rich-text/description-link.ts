import { Link } from '@tiptap/extension-link'
import { isAllowedDescriptionUrl } from '@/lib/description-html'

/**
 * The notes editor's link mark.
 *
 * `target` and `rel` are render-time attributes (description format v1,
 * "Allowed attributes") and the storage sanitizer strips them. Link adds both
 * by default, so the editor's HTML would never equal the stored value and
 * every keystroke would reset the document, dropping a trailing space after a
 * link (rendyhd/Vicu#67). They are turned off here; `RichTextView` adds them
 * when it renders.
 *
 * Link is inclusive while autolink is on, so words typed at a link's end
 * joined the link. Here they never do: a link grows only through the link
 * dialog, autolink still marks a URL once a space follows it.
 */
export const DescriptionLink = Link.extend({ inclusive: () => false }).configure({
  openOnClick: false,
  autolink: true,
  protocols: ['mailto'],
  isAllowedUri: (url) => isAllowedDescriptionUrl(url),
  HTMLAttributes: { target: null, rel: null, class: null },
})
