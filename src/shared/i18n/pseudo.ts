// The development pseudo-language (`PSEUDO_LANGUAGE`): English with accented letters, about a
// third more length and brackets around every string. It shows at a glance which text is still
// hardcoded (no brackets), which layouts break when a translation runs longer, and which strings
// are glued together from parts (brackets in the middle of a sentence).

export type CatalogTree = { [key: string]: string | CatalogTree }

const ACCENTED: Record<string, string> = {
  a: 'á', b: 'ƀ', c: 'ç', d: 'đ', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'í', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'ɱ',
  n: 'ñ', o: 'ö', p: 'þ', q: 'ɋ', r: 'ŕ', s: 'š', t: 'ţ', u: 'ü', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Á', B: 'Ɓ', C: 'Ç', D: 'Đ', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Í', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'Ṁ',
  N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ɋ', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Ü', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
}

// What a translation must carry over untouched: {{placeholders}}, $t(nested.keys) and <tags>.
const KEPT = /(\{\{[^}]*\}\}|\$t\([^)]*\)|<\/?[A-Za-z0-9]+\s*\/?>)/

/** One string in the pseudo-language. Placeholders, nested keys and tags stay as they are. */
export function pseudoText(text: string): string {
  let letters = 0
  const body = text
    .split(KEPT)
    .map((part, index) => {
      if (index % 2 === 1) return part
      return [...part].map((ch) => {
        const accented = ACCENTED[ch]
        if (accented) letters++
        return accented ?? ch
      }).join('')
    })
    .join('')
  // Translations run longer than English, the shorter the text the more so: pad by about a third.
  const padding = '~'.repeat(Math.ceil(letters / 3))
  return `[${body}${padding ? ' ' + padding : ''}]`
}

/** A whole catalog in the pseudo-language, same keys. */
export function pseudoCatalog(source: CatalogTree): CatalogTree {
  const out: CatalogTree = {}
  for (const [key, value] of Object.entries(source)) {
    out[key] = typeof value === 'string' ? pseudoText(value) : pseudoCatalog(value)
  }
  return out
}
