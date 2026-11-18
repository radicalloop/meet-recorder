import { extractOutputText, OpenAIAuthError, postResponses } from './responses'

export interface SummarizeOptions {
  apiKey: string
  model: string
  title: string
  /** ISO timestamp. */
  startedAt: string
  durationMs: number
  transcriptMarkdown: string
  baseUrl?: string
}

const TIMEOUT_MS = 180_000
/** Above this the transcript is summarised in chunks first, then merged. */
const MAX_SINGLE_SHOT_CHARS = 600_000
const CHUNK_CHARS = 500_000

const SECTIONS_SPEC = `Respond with Markdown containing exactly these four sections, in this order, and nothing else
(no title line, no preamble, no closing remarks):

## Summary
2-4 short paragraphs covering what was discussed and the outcome.

## Decisions
Bullet list (-) of concrete decisions made, including the approach chosen and, when the transcript
makes it clear, who raised or is affected by each point.

## Action Items
One line per item, formatted exactly as:
- [ ] **Owner** — task (due: <date>)
Include "(due: …)" only when a deadline was explicitly stated. Use owner "Unassigned" when no owner
is clear. Never use a literal placeholder like "[OWNER]".

## Open Questions
Bullet list (-) of unresolved questions, concerns, and anything explicitly deferred or waiting on
someone.`

const RULES = `Rules:
- Transcript lines look like \`**[00:01:23]** text\`; the timestamp is time since the recording
  started. Lines are not labelled with who is speaking, and the recording may be a meeting, a video
  or any other audio. Attribute something to a person only when the words themselves make it clear
  (e.g. self-introductions, "Thanks, Priya"); otherwise do not guess who said it.
- Never invent facts, names, dates or numbers. If something is unclear in the transcript, say so.
- Be specific: quote exact deadlines, numbers and amounts when mentioned. Keep the names of people
  and organizations.
- Be comprehensive: prefer including a decision, deferral, or named context over omitting it.
  Conciseness means no filler, not fewer facts. One line per bullet.
- Include conditional items (e.g. "only if X happens") rather than flattening them into plain facts.
- Ignore non-meeting audio (ambient noise, pre/post-call chatter) if it appears in the transcript.
- Write the notes in the meeting's primary language but keep the section headings exactly as given.
- Write "None" under any section with nothing to report.`

const NOTES_SYSTEM_PROMPT = `You are an expert executive assistant producing structured meeting notes from a transcript. The notes
must be complete enough that someone who did not attend the meeting could act on them.

${SECTIONS_SPEC}

${RULES}`

const CHUNK_SYSTEM_PROMPT = `You are an expert executive assistant. You are given one part of a long meeting transcript. Produce
detailed interim notes for this part only: everything discussed, every decision, every action item
with its owner, every open question, with exact names, numbers and deadlines. Use Markdown bullets.
These notes will later be merged with notes from the other parts, so do not add a title or preamble.

${RULES}`

const MERGE_SYSTEM_PROMPT = `You are an expert executive assistant. You are given interim notes from consecutive parts of one
meeting, in order. Merge them into a single set of meeting notes, deduplicating and keeping every
decision, action item, owner, deadline, number and open question.

${SECTIONS_SPEC}

${RULES}`

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000)
  if (totalMin < 1) return `${Math.max(1, Math.round(ms / 1000))} s`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}

/** Split at line boundaries into pieces of at most CHUNK_CHARS. */
function splitTranscript(transcript: string): string[] {
  const chunks: string[] = []
  let current = ''
  for (const line of transcript.split('\n')) {
    if (current.length + line.length + 1 > CHUNK_CHARS && current) {
      chunks.push(current)
      current = ''
    }
    current += (current ? '\n' : '') + line
  }
  if (current) chunks.push(current)
  return chunks
}

/** Returns the notes markdown: summary, decisions, action items (with owners), open questions. */
export async function summarize(opts: SummarizeOptions): Promise<string> {
  const date = formatDate(opts.startedAt)
  const duration = formatDuration(opts.durationMs)
  const context = `Meeting title: ${opts.title}\nDate: ${date}\nDuration: ${duration}`

  async function ask(system: string, user: string): Promise<string> {
    const resp = await postResponses({
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      body: {
        model: opts.model,
        store: false,
        input: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      },
      timeoutMs: TIMEOUT_MS
    })
    const text = extractOutputText(resp).trim()
    if (!text) throw new Error('the model returned an empty response')
    return text
  }

  try {
    let body: string
    if (opts.transcriptMarkdown.length <= MAX_SINGLE_SHOT_CHARS) {
      body = await ask(NOTES_SYSTEM_PROMPT, `${context}\n\nTranscript:\n${opts.transcriptMarkdown}`)
    } else {
      const chunks = splitTranscript(opts.transcriptMarkdown)
      const interim: string[] = []
      for (let i = 0; i < chunks.length; i++) {
        interim.push(
          await ask(
            CHUNK_SYSTEM_PROMPT,
            `${context}\nPart ${i + 1} of ${chunks.length}.\n\nTranscript part:\n${chunks[i]}`
          )
        )
      }
      body = await ask(
        MERGE_SYSTEM_PROMPT,
        `${context}\n\n${interim.map((n, i) => `Notes for part ${i + 1}:\n${n}`).join('\n\n')}`
      )
    }

    // drop any preamble the model added despite instructions
    const start = body.indexOf('## Summary')
    if (start > 0) body = body.slice(start)

    return `# ${opts.title}\n*${date} · ${duration}*\n\n${body.trim()}\n`
  } catch (err) {
    if (err instanceof OpenAIAuthError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to generate meeting notes with ${opts.model}: ${msg}`, { cause: err })
  }
}
