import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ClipRecorder } from './clips'

describe('ClipRecorder', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'meetrec-clips-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('tracks byte ranges per source and reads them back after close', async () => {
    const rec = new ClipRecorder(dir)
    rec.push('mic', Buffer.alloc(100, 1))
    rec.push('mic', Buffer.alloc(50, 2))
    const a = rec.commit('mic', 0, 1000)
    rec.push('system', Buffer.alloc(30, 3))
    const b = rec.commit('system', 500, 900)
    rec.push('mic', Buffer.alloc(20, 4))
    const c = rec.commit('mic', 2000, 2500)

    expect(a).toMatchObject({ id: 0, source: 'mic', offset: 0, bytes: 150 })
    expect(b).toMatchObject({ id: 1, source: 'system', offset: 0, bytes: 30 })
    expect(c).toMatchObject({ id: 2, source: 'mic', offset: 150, bytes: 20 })
    expect(rec.counts()).toEqual({ mic: 2, system: 1 })

    await rec.close()
    const reader = await rec.openReader()
    expect(await reader.read(c!)).toEqual(Buffer.alloc(20, 4))
    expect((await reader.read(a!)).subarray(100)).toEqual(Buffer.alloc(50, 2))
    await reader.close()

    const index = (await readFile(join(dir, 'audio', 'clips.jsonl'), 'utf8')).trim().split('\n')
    expect(index.map((l) => JSON.parse(l).id)).toEqual([0, 1, 2])
  })

  it('ignores commits without new audio', () => {
    const rec = new ClipRecorder(dir)
    expect(rec.commit('mic', 0, 10)).toBeNull()
    rec.push('mic', Buffer.alloc(10))
    expect(rec.commit('mic', 0, 10)).not.toBeNull()
    expect(rec.commit('mic', 10, 20)).toBeNull()
  })

  it('removes the audio folder', async () => {
    const rec = new ClipRecorder(dir)
    rec.push('mic', Buffer.alloc(10))
    rec.commit('mic', 0, 10)
    await rec.close()
    await rec.remove()
    expect(existsSync(join(dir, 'audio'))).toBe(false)
  })

  it('reports write failures on close instead of crashing', async () => {
    const rec = new ClipRecorder(dir)
    await rm(join(dir, 'audio'), { recursive: true }) // folder vanishes before the file opens
    rec.push('mic', Buffer.alloc(10))
    rec.commit('mic', 0, 10)
    await expect(rec.close()).rejects.toThrow('Could not save speech audio')
  })
})
