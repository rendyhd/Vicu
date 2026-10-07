import { describe, expect, it, vi } from 'vitest'
import {
  buildObsidianDeepLink,
  describeActiveNote,
  resolveLinkForSave,
  type ActiveNote,
  type ObsidianLinkDeps,
} from '../obsidian-link'

const VAULT = 'My Vault'

interface FakeDeps extends ObsidianLinkDeps {
  injectUid: ReturnType<typeof vi.fn<(uid: string) => Promise<boolean>>>
  getActiveNote: ReturnType<typeof vi.fn<() => Promise<ActiveNote | null>>>
}

function fakeDeps(opts: { active?: ActiveNote | null; injected?: boolean } = {}): FakeDeps {
  const active = opts.active === undefined ? { path: 'Projects/Plan.md', frontmatter: {} } : opts.active
  return {
    getActiveNote: vi.fn(async () => active),
    injectUid: vi.fn(async () => opts.injected ?? true),
    newUid: () => 'new-uid-1',
  }
}

describe('buildObsidianDeepLink', () => {
  it('uses Advanced URI with the uid when there is one', () => {
    expect(buildObsidianDeepLink(VAULT, 'Projects/Plan.md', 'abc 123')).toBe(
      'obsidian://advanced-uri?vault=My%20Vault&uid=abc%20123',
    )
  })

  it('falls back to the plain open link by path, without the .md extension', () => {
    expect(buildObsidianDeepLink(VAULT, 'Projects/Plan.md', '')).toBe(
      'obsidian://open?vault=My%20Vault&file=Projects%2FPlan',
    )
  })
})

describe('describeActiveNote (what Quick Entry shows)', () => {
  it('needs no write: a note without a uid gets a path link', () => {
    const ctx = describeActiveNote({ path: 'Projects/Plan.md', frontmatter: {} }, VAULT)
    expect(ctx).toEqual({
      deepLink: 'obsidian://open?vault=My%20Vault&file=Projects%2FPlan',
      noteName: 'Plan',
      vaultName: VAULT,
      notePath: 'Projects/Plan.md',
      isUidBased: false,
    })
  })

  it('uses the uid the note already has', () => {
    const ctx = describeActiveNote({ path: 'Plan.md', frontmatter: { uid: 'u-1' } }, VAULT)
    expect(ctx.isUidBased).toBe(true)
    expect(ctx.deepLink).toBe('obsidian://advanced-uri?vault=My%20Vault&uid=u-1')
  })

  it('accepts a numeric uid and ignores unusable ones', () => {
    expect(describeActiveNote({ path: 'a.md', frontmatter: { uid: 42 } }, VAULT).deepLink).toContain('uid=42')
    expect(describeActiveNote({ path: 'a.md', frontmatter: { uid: ['x'] } }, VAULT).isUidBased).toBe(false)
    expect(describeActiveNote({ path: 'a.md', frontmatter: { uid: '  ' } }, VAULT).isUidBased).toBe(false)
  })

  it('names an untitled or pathless note', () => {
    expect(describeActiveNote({ path: '', frontmatter: {} }, VAULT).noteName).toBe('Untitled')
  })
})

describe('resolveLinkForSave (the only place a uid is written)', () => {
  const shown = () => describeActiveNote({ path: 'Projects/Plan.md', frontmatter: {} }, VAULT)

  it('writes a uid into the note that is still in front, and links by uid', async () => {
    const deps = fakeDeps()
    const result = await resolveLinkForSave(shown(), deps)
    expect(deps.injectUid).toHaveBeenCalledTimes(1)
    expect(deps.injectUid).toHaveBeenCalledWith('new-uid-1')
    expect(result.isUidBased).toBe(true)
    expect(result.deepLink).toBe('obsidian://advanced-uri?vault=My%20Vault&uid=new-uid-1')
  })

  it('does not touch a note that already has a uid', async () => {
    const deps = fakeDeps()
    const ctx = describeActiveNote({ path: 'Plan.md', frontmatter: { uid: 'u-9' } }, VAULT)
    const result = await resolveLinkForSave(ctx, deps)
    expect(deps.getActiveNote).not.toHaveBeenCalled()
    expect(deps.injectUid).not.toHaveBeenCalled()
    expect(result).toBe(ctx)
  })

  it('reuses a uid the note gained in the meantime instead of overwriting it', async () => {
    const deps = fakeDeps({ active: { path: 'Projects/Plan.md', frontmatter: { uid: 'added-later' } } })
    const result = await resolveLinkForSave(shown(), deps)
    expect(deps.injectUid).not.toHaveBeenCalled()
    expect(result.deepLink).toContain('uid=added-later')
  })

  it('never writes into a different note than the one that was shown', async () => {
    const deps = fakeDeps({ active: { path: 'Other.md', frontmatter: {} } })
    const ctx = shown()
    const result = await resolveLinkForSave(ctx, deps)
    expect(deps.injectUid).not.toHaveBeenCalled()
    expect(result).toBe(ctx)
    expect(result.isUidBased).toBe(false)
  })

  it('keeps the path link when Obsidian is gone or the write fails', async () => {
    const gone = fakeDeps({ active: null })
    const ctx = shown()
    expect(await resolveLinkForSave(ctx, gone)).toBe(ctx)
    expect(gone.injectUid).not.toHaveBeenCalled()

    const failing = fakeDeps({ injected: false })
    expect(await resolveLinkForSave(ctx, failing)).toBe(ctx)
  })

  it('leaves a note with an unusable uid alone', async () => {
    const deps = fakeDeps({ active: { path: 'Projects/Plan.md', frontmatter: { uid: ['x'] } } })
    const ctx = shown()
    expect(await resolveLinkForSave(ctx, deps)).toBe(ctx)
    expect(deps.injectUid).not.toHaveBeenCalled()
  })
})
