import { describe, expect, it } from 'vitest'
import { PickedFiles } from '../picked-files'

function rig(sizes: Record<string, number>) {
  let now = 1_000
  let n = 0
  const files = new PickedFiles({
    stat: async (filePath) => {
      if (!(filePath in sizes)) throw new Error('ENOENT')
      return { size: sizes[filePath] }
    },
    now: () => now,
    newToken: () => `t${++n}`,
  })
  return { files, advance: (ms: number) => { now += ms } }
}

describe('PickedFiles', () => {
  it('names each picked file by a token with its name and size, in the order picked', async () => {
    const { files } = rig({ '/docs/plan.pdf': 2_400_000, '/docs/a.txt': 5 })
    expect(await files.remember(['/docs/plan.pdf', '/docs/a.txt'])).toEqual([
      { token: 't1', name: 'plan.pdf', size: 2_400_000 },
      { token: 't2', name: 'a.txt', size: 5 },
    ])
  })

  it('gives the path behind a token once', async () => {
    const { files } = rig({ '/docs/a.txt': 5 })
    const [picked] = await files.remember(['/docs/a.txt'])
    expect(files.take(picked.token)).toBe('/docs/a.txt')
    expect(files.take(picked.token)).toBeNull()
  })

  it('never takes a path or anything it did not hand out', async () => {
    const { files } = rig({ '/docs/a.txt': 5 })
    await files.remember(['/docs/a.txt'])
    expect(files.take('/docs/a.txt')).toBeNull()
    expect(files.take(42)).toBeNull()
    expect(files.take(undefined)).toBeNull()
  })

  it('forgets a token after ten minutes', async () => {
    const { files, advance } = rig({ '/docs/a.txt': 5 })
    const [picked] = await files.remember(['/docs/a.txt'])
    advance(10 * 60_000 + 1)
    expect(files.take(picked.token)).toBeNull()
  })

  it('a file it cannot read still gets a token, with size 0, so its upload can say why', async () => {
    const { files } = rig({})
    expect(await files.remember(['/gone.txt'])).toEqual([{ token: 't1', name: 'gone.txt', size: 0 }])
  })
})
