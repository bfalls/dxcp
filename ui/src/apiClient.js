export function createApiClient({ baseUrl, getToken }) {
  async function buildHeaders() {
    const token = await getToken()
    if (!token) {
      const err = new Error('LOGIN_REQUIRED')
      err.code = 'LOGIN_REQUIRED'
      throw err
    }
    return { Authorization: `Bearer ${token}` }
  }

  async function get(path) {
    const headers = await buildHeaders()
    const res = await fetch(`${baseUrl}${path}`, { headers })
    return res.json()
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
