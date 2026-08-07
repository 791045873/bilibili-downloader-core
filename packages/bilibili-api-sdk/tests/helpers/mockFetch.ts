export interface MockResponseInit {
  status?: number
  json?: unknown
  text?: string
  buffer?: Uint8Array
  setCookies?: string[]
}

export function mockResponse(init: MockResponseInit): Response {
  let body: string | undefined = init.text
  if (body === undefined && init.buffer === undefined) {
    body = JSON.stringify(init.json ?? {})
  }
  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const cookie of init.setCookies ?? []) {
    headers.append('Set-Cookie', cookie)
  }
  return {
    status: init.status ?? 200,
    headers,
    ok: (init.status ?? 200) < 400,
    async text() {
      return body ?? ''
    },
    async arrayBuffer() {
      return (init.buffer ?? new TextEncoder().encode(body ?? '')).buffer as ArrayBuffer
    },
    json: async () => JSON.parse(body ?? ''),
  } as unknown as Response
}

export type Route = {
  match: (url: string) => boolean
  respond: (url: string, init?: { method?: string; body?: unknown }) => Response
}

export function installFetch(routes: Route[]) {
  const calls: { url: string; method: string; body?: string }[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const body =
      typeof init?.body === 'string'
        ? init.body
        : init?.body instanceof URLSearchParams
          ? init.body.toString()
          : undefined
    calls.push({ url, method, body })
    const route = routes.find((r) => r.match(url))
    if (!route) throw new Error(`no mock route for ${url}`)
    return route.respond(url, { method, body })
  }) as typeof fetch
  return {
    calls,
    byUrl: (frag: string) => calls.filter((c) => c.url.includes(frag)),
    restore: () => {
      globalThis.fetch = original
    },
  }
}
