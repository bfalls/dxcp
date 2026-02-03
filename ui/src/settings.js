const SETTINGS_STORAGE_PREFIX = 'dxcp.user_settings.v1'

function getStableUserId(user, decodedToken) {
  return (
    user?.sub ||
    decodedToken?.sub ||
    user?.email ||
    decodedToken?.email ||
    decodedToken?.['https://dxcp.example/claims/email'] ||
    ''
  )
}

export function getUserSettingsKey(user, decodedToken) {
  const id = getStableUserId(user, decodedToken)
  if (!id) return ''
  return `${SETTINGS_STORAGE_PREFIX}.${id}`
}

export function loadUserSettings(key) {
  if (!key || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    const refresh = Number(data.refresh_interval_seconds)
    if (!Number.isFinite(refresh) || refresh <= 0) return null
    return { refresh_interval_seconds: Math.floor(refresh) }
  } catch (err) {
    return null
  }
}

export function saveUserSettings(key, settings) {
  if (!key || typeof localStorage === 'undefined') return
  const payload = {
    refresh_interval_seconds: settings.refresh_interval_seconds
  }
  localStorage.setItem(key, JSON.stringify(payload))
}

export function clampRefreshIntervalSeconds(value, minValue, maxValue) {
  let clampedValue = value
  let reason = ''
  if (clampedValue < minValue) {
    clampedValue = minValue
    reason = 'minimum'
  }
  if (clampedValue > maxValue) {
    clampedValue = maxValue
    reason = 'maximum'
  }
  return { value: clampedValue, reason }
}
