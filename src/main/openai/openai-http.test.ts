import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { summarize } from './summary'
import { listModels } from './models'
import { OpenAIAuthError } from './responses'

interface Captured {
  method: string
  path: string
  auth: string | undefined
  body: unknown
}

interface MockHttp {
  baseUrl: string
  requests: Captured[]
  respond: (req: Captured) => { status: number; body: unknown }
  close(): Promise<void>
}

async function startHttp(respond: MockHttp['respond']): Promise<MockHttp> {
  const requests: Captured[] = []
  const mock: Partial<MockHttp> = { requests, respond }
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString()
      const captured: Captured = {
        method: req.method ?? '',
        path: req.url ?? '',
        auth: req.headers.authorization,
        body: raw ? JSON.parse(raw) : null
      }
      requests.push(captured)
      const { status, body } = mock.respond!(captured)
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  mock.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  mock.close = () => new Promise((resolve) => server.close(() => resolve()))
  return mock as MockHttp
}

function responsesPayload(text: string): unknown {
  return {
    id: 'resp_1',
    object: 'response',
    status: 'completed',
    output: [
      {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }]
      }
    ]
  }
}

let mock: MockHttp

afterEach(async () => {
  await mock?.close()
})

describe('summarize', () => {
  const transcript = [
    '**[00:00:01]** Shall we start?',
    '**[00:00:05]** Yes, Alice, the budget is approved.',
    '**[00:01:10]** Sounds good.'
  ].join('\n')

  const notesBody = [
    '## Summary',
    'Budget discussion.',
    '',
    '## Decisions',
    '- Budget approved (Alice).',
    '',
    '## Action Items',
    '- [ ] **Unassigned** — circulate the budget',
    '',
    '## Open Questions',
    'None'
  ].join('\n')

  it('sends the transcript and wraps the sections in the required header', async () => {
    mock = await startHttp(() => ({ status: 200, body: responsesPayload(notesBody) }))
    const md = await summarize({
      apiKey: 'sk-test',
      model: 'gpt-6-astra',
      title: 'Budget sync',
      startedAt: '2026-10-30T10:00:00.000Z',
      durationMs: 65 * 60_000,
      transcriptMarkdown: transcript,
      baseUrl: mock.baseUrl
    })

    const body = mock.requests[0].body as {
      model: string
      store: boolean
      input: { role: string; content: string }[]
    }
    expect(body.model).toBe('gpt-6-astra')
    expect(body.store).toBe(false)
    expect(body.input[0].role).toBe('system')
    expect(body.input[0].content).toContain('## Action Items')
    expect(body.input[1].content).toContain(transcript)

    const lines = md.split('\n')
    expect(lines[0]).toBe('# Budget sync')
    expect(lines[1]).toMatch(/^\*\d{4}-\d{2}-\d{2} \d{2}:\d{2} · 1 h 5 min\*$/)
    expect(lines[2]).toBe('')
    expect(lines[3]).toBe('## Summary')
    expect(md).toContain('- [ ] **Unassigned** — circulate the budget')
  })

  it('strips a preamble before ## Summary', async () => {
    mock = await startHttp(() => ({
      status: 200,
      body: responsesPayload(`Here are your notes:\n\n${notesBody}`)
    }))
    const md = await summarize({
      apiKey: 'sk-test',
      model: 'gpt-6-astra',
      title: 'T',
      startedAt: '2026-10-30T10:00:00.000Z',
      durationMs: 60_000,
      transcriptMarkdown: transcript,
      baseUrl: mock.baseUrl
    })
    expect(md).not.toContain('Here are your notes')
    expect(md.split('\n')[3]).toBe('## Summary')
  })

  it('summarises very long transcripts in chunks and merges them', async () => {
    mock = await startHttp((req) => {
      const body = req.body as { input: { content: string }[] }
      const isMerge = body.input[0].content.includes('interim notes from consecutive parts')
      return {
        status: 200,
        body: responsesPayload(isMerge ? notesBody : '- part notes')
      }
    })
    const longTranscript = `**[00:00:01]** ${'word '.repeat(10)}\n`.repeat(11_000)
    expect(longTranscript.length).toBeGreaterThan(600_000)
    const md = await summarize({
      apiKey: 'sk-test',
      model: 'gpt-6-astra',
      title: 'Long one',
      startedAt: '2026-10-30T10:00:00.000Z',
      durationMs: 3 * 3_600_000,
      transcriptMarkdown: longTranscript,
      baseUrl: mock.baseUrl
    })
    expect(mock.requests.length).toBeGreaterThanOrEqual(3) // 2+ chunks then a merge
    expect(md).toContain('## Summary')
    expect(md).not.toContain('Participants')
  })

  it('throws a descriptive error on failure', async () => {
    mock = await startHttp(() => ({ status: 500, body: { error: { message: 'overloaded' } } }))
    await expect(
      summarize({
        apiKey: 'sk-test',
        model: 'gpt-6-astra',
        title: 'T',
        startedAt: '2026-10-30T10:00:00.000Z',
        durationMs: 1000,
        transcriptMarkdown: transcript,
        baseUrl: mock.baseUrl
      })
    ).rejects.toThrow(/gpt-6-astra.*overloaded/)
  })
})

describe('listModels', () => {
  const data = [
    { id: 'gpt-transcribe', created: 300, shutdown_date: '2099-03-01' },
    { id: 'gpt-live-transcribe', created: 310 },
    { id: 'whisper-1', created: 100 },
    { id: 'gpt-6-astra', created: 400, shutdown_date: null },
    { id: 'gpt-6-luna', created: 500 },
    { id: 'gpt-6-luna-2026-05-01', created: 450 },
    { id: 'gpt-5', created: 200, shutdown_date: '2020-01-01' },
    { id: 'o9-mini', created: 350 },
    { id: 'gpt-6-tts', created: 420 },
    { id: 'gpt-image-2', created: 430 },
    { id: 'text-embedding-4', created: 440 },
    { id: 'dall-e-3', created: 50 }
  ]

  it('groups usable models per role, newest first, without snapshots or retired ones', async () => {
    mock = await startHttp(() => ({ status: 200, body: { object: 'list', data } }))
    const models = await listModels('sk-test', mock.baseUrl)
    expect(mock.requests[0].path).toBe('/v1/models')
    expect(mock.requests[0].auth).toBe('Bearer sk-test')
    expect(models.transcription).toEqual([
      { id: 'gpt-transcribe', shutdownDate: '2099-03-01' },
      { id: 'whisper-1', shutdownDate: null }
    ])
    expect(models.summary.map((m) => m.id)).toEqual(['gpt-6-luna', 'gpt-6-astra', 'o9-mini'])
  })

  it('throws an auth error on 401 and a request error otherwise', async () => {
    mock = await startHttp(() => ({ status: 401, body: { error: { message: 'bad key' } } }))
    await expect(listModels('sk-bad', mock.baseUrl)).rejects.toBeInstanceOf(OpenAIAuthError)
    await mock.close()
    mock = await startHttp(() => ({ status: 503, body: {} }))
    await expect(listModels('sk-test', mock.baseUrl)).rejects.toMatchObject({ status: 503 })
  })
})
