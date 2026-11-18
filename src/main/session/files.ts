// Session folder scanning and path guards (node-only, electron-free).
import { readdir, readFile, stat } from 'fs/promises'
import type { Dirent } from 'fs'
import { join, resolve, sep } from 'path'
import type { SessionListItem } from '../../shared/types'

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function listSessions(outputDir: string): Promise<SessionListItem[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(outputDir, { withFileTypes: true })
  } catch {
    return []
  }
  const items: SessionListItem[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(outputDir, entry.name)
    try {
      const raw = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8')) as Record<
        string,
        unknown
      >
      const [hasVideo, hasNotes] = await Promise.all([
        exists(join(dir, 'recording.webm')),
        exists(join(dir, 'notes.md'))
      ])
      items.push({
        id: typeof raw.id === 'string' ? raw.id : entry.name,
        title: typeof raw.title === 'string' ? raw.title : entry.name,
        dir,
        startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '',
        hasVideo,
        hasNotes
      })
    } catch {
      // not a session folder
    }
  }
  return items.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

/** True when `child` is strictly inside `parent`. */
export function isInside(parent: string, child: string): boolean {
  const p = resolve(parent)
  const c = resolve(child)
  return c !== p && c.startsWith(p.endsWith(sep) ? p : p + sep)
}
