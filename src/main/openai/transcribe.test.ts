import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { transcribeAudio } from './transcribe'
import { OpenAIAuthError, OpenAIRequestError } from './responses'

interface Received {
  path: string
  auth: string | undefined
  form: FormData
}

let server: Server | null = null

async function startMock(
  replies: Array<{ status: number; body: unknown }>
): Promise<{ baseUrl: string; received: Received[] }> {
  const received: Received[] = []
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      const form = await new Response(Buffer.concat(chunks), {
        headers: { 'content-type': req.headers['content-type'] ?? '' }
      }).formData()
      received.push({ path: req.url ?? '', auth: req.headers.authorization, form })
      const reply = replies[Math.min(received.length - 1, replies.length - 1)]
      res.writeHead(reply.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(reply.body))
    })
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received }
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = null
})

const wav = Buffer.from('RIFF....WAVEfmt fake')

describe('transcribeAudio', () => {
  it('uploads the WAV with model, prompt and languages and returns trimmed text', async () => {
    const mock = await startMock([
      { status: 200, body: { text: '  Hello there. ', languages: [] } }
    ])
    const text = await transcribeAudio({
      apiKey: 'sk-test',
      model: 'gpt-transcribe',
      wav,
      prompt: 'Weekly sync.',
      languages: ['en', 'hi'],
      baseUrl: mock.baseUrl
    })
    expect(text).toBe('Hello there.')
    const [req] = mock.received
    expect(req.path).toBe('/v1/audio/transcriptions')
    expect(req.auth).toBe('Bearer sk-test')
    expect(req.form.get('model')).toBe('gpt-transcribe')
    expect(req.form.get('prompt')).toBe('Weekly sync.')
    expect(req.form.getAll('languages[]')).toEqual(['en', 'hi'])
    const file = req.form.get('file') as File
    expect(file.name).toBe('turn.wav')
    expect(Buffer.from(await file.arrayBuffer())).toEqual(wav)
  })

  it('omits prompt and languages when not set', async () => {
    const mock = await startMock([{ status: 200, body: { text: 'Hi' } }])
    await transcribeAudio({ apiKey: 'k', model: 'm', wav, languages: [], baseUrl: mock.baseUrl })
    expect(mock.received[0].form.has('prompt')).toBe(false)
    expect(mock.received[0].form.has('languages[]')).toBe(false)
  })

  it('retries 429/5xx and then succeeds', async () => {
    const mock = await startMock([
      { status: 503, body: { error: { message: 'busy' } } },
      { status: 200, body: { text: 'Second time lucky' } }
    ])
    const text = await transcribeAudio({
      apiKey: 'k',
      model: 'm',
      wav,
      languages: [],
      baseUrl: mock.baseUrl
    })
    expect(text).toBe('Second time lucky')
    expect(mock.received).toHaveLength(2)
  })

  it('throws OpenAIAuthError on 401 without retrying', async () => {
    const mock = await startMock([{ status: 401, body: { error: { message: 'Incorrect key' } } }])
    await expect(
      transcribeAudio({ apiKey: 'bad', model: 'm', wav, languages: [], baseUrl: mock.baseUrl })
    ).rejects.toBeInstanceOf(OpenAIAuthError)
    expect(mock.received).toHaveLength(1)
  })

  it('does not retry other 4xx errors', async () => {
    const mock = await startMock([{ status: 400, body: { error: { message: 'Bad audio' } } }])
    const err = await transcribeAudio({
      apiKey: 'k',
      model: 'm',
      wav,
      languages: [],
      baseUrl: mock.baseUrl
    }).catch((e) => e)
    expect(err).toBeInstanceOf(OpenAIRequestError)
    expect(err.message).toBe('Bad audio')
    expect(mock.received).toHaveLength(1)
  })
})

describe('describeError', () => {
  it('includes the HTTP status, network cause or timeout', async () => {
    const { describeError } = await import('./responses')
    expect(describeError(new OpenAIRequestError(429, 'You exceeded your current quota.'))).toBe(
      'OpenAI returned 429: You exceeded your current quota'
    )
    const network = new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } })
    expect(describeError(network)).toBe('fetch failed (ENOTFOUND)')
    expect(describeError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(
      'the request to OpenAI timed out'
    )
  })
})
