export function createApiClient({ baseUrl, getToken }) {
  const inFlight = new Map()
  const cache = new Map()
  const defaultCacheTtlMs = 2000

  async function buildHeaders() {
    const token = await getToken()
    if (!token) {
      const err = new Error('LOGIN_REQUIRED')
      err.code = 'LOGIN_REQUIRED'
      throw err
    }
    return { Authorization: `Bearer ${token}` }
  }

  async function get(path, options = {}) {
    const { bypassCache = false, cacheTtlMs = defaultCacheTtlMs } = options || {}
    const headers = await buildHeaders()
    const url = `${baseUrl}${path}`
    if (!bypassCache) {
      const cached = cache.get(url)
      if (cached && Date.now() - cached.ts <= cacheTtlMs) {
        return cached.data
      }
      const pending = inFlight.get(url)
      if (pending) {
        return pending
      }
    }
    const fetchPromise = (async () => {
      try {
        const res = await fetch(url, { headers })
        const data = await res.json()
        if (!bypassCache && res.ok) {
          cache.set(url, { ts: Date.now(), data })
        }
        return data
      } finally {
        inFlight.delete(url)
      }
    })()
    if (!bypassCache) {
      inFlight.set(url, fetchPromise)
    }
    return fetchPromise
  }

  async function post(path, body, idempotencyKey) {
    const headers = await buildHeaders()
    headers['Content-Type'] = 'application/json'
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey
    }
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })
    return res.json()
  }

  async function put(path, body) {
    const headers = await buildHeaders()
    headers['Content-Type'] = 'application/json'
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body)
    })
    return res.json()
  }

  return { get, post, put }
}
