import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { isInside, listSessions } from './files'

describe('listSessions', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'meetrec-list-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function makeSession(
    name: string,
    meta: Record<string, unknown>,
    files: string[] = []
  ): Promise<void> {
    const d = join(dir, name)
    await mkdir(d)
    await writeFile(join(d, 'session.json'), JSON.stringify(meta))
    for (const f of files) await writeFile(join(d, f), 'x')
  }

  it('lists session folders newest first with file flags', async () => {
    await makeSession('old', { id: '1', title: 'Old', startedAt: '2026-10-01T10:00:00.000Z' }, [
      'recording.webm'
    ])
    await makeSession('new', { id: '2', title: 'New', startedAt: '2026-10-29T10:00:00.000Z' }, [
      'notes.md'
    ])
    await mkdir(join(dir, 'not-a-session'))
    await writeFile(join(dir, 'stray.txt'), 'x')

    const items = await listSessions(dir)
    expect(items.map((i) => i.id)).toEqual(['2', '1'])
    expect(items[0]).toMatchObject({ title: 'New', hasVideo: false, hasNotes: true })
    expect(items[1]).toMatchObject({ title: 'Old', hasVideo: true, hasNotes: false })
  })

  it('returns [] for a missing output dir', async () => {
    expect(await listSessions(join(dir, 'nope'))).toEqual([])
  })
})

describe('isInside', () => {
  it('only accepts strict children', () => {
    expect(isInside('/a/b', '/a/b/c')).toBe(true)
    expect(isInside('/a/b', '/a/b')).toBe(false)
    expect(isInside('/a/b', '/a/bc')).toBe(false)
    expect(isInside('/a/b', '/a/b/../x')).toBe(false)
  })
})
