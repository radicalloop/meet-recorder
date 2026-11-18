// Pure helpers for session folder naming (electron-free, unit-tested).

export function sanitizeTitle(title: string): string {
  const cleaned = title
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .replace(/[. ]+$/, '')
  return cleaned || 'Meeting'
}

/** Local-time folder name: "YYYY-MM-DD HHmm <title>". */
export function sessionFolderName(date: Date, title: string): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(
    date.getHours()
  )}${p(date.getMinutes())}`
  return `${stamp} ${sanitizeTitle(title)}`
}

export function dedupeName(name: string, exists: (candidate: string) => boolean): string {
  if (!exists(name)) return name
  for (let i = 2; ; i++) {
    const candidate = `${name} (${i})`
    if (!exists(candidate)) return candidate
  }
}
