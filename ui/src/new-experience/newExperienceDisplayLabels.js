function uppercaseKey(value) {
  return String(value || '').trim().toUpperCase()
}

function lowercaseKey(value) {
  return String(value || '').trim().toLowerCase()
}

function fromMap(value, labels, normalize, fallback) {
  const key = normalize(value)
  if (!key) return fallback
  return labels[key] || fallback
}

const ENGINE_TYPE_LABELS = {
  SPINNAKER: 'Spinnaker',
  ARGO_CD: 'Argo CD',
  FLUX: 'Flux',
  OCTOPUS: 'Octopus',
  HARNESS: 'Harness'
}

const CONNECTION_MODE_LABELS = {
  http: 'HTTP',
  mtls: 'mTLS',
  stub: 'Stub (local only)'
}

const LIFECYCLE_STATUS_LABELS = {
  active: 'Active',
  disabled: 'Disabled',
  retired: 'Retired',
  deprecated: 'Deprecated'
}

const ENVIRONMENT_TYPE_LABELS = {
  non_prod: 'Non-production',
  prod: 'Production'
}

const VALIDATION_STATUS_LABELS = {
  VALID: 'Valid',
  WARNING: 'Warning',
  INVALID: 'Invalid'
}

const CONFIG_SOURCE_LABELS = {
  runtime: 'Runtime',
  ssm: 'AWS SSM'
}

export function displayEngineType(value) {
  return fromMap(value, ENGINE_TYPE_LABELS, uppercaseKey, String(value || 'Not configured'))
}

export function displayConnectionMode(value) {
  return fromMap(value, CONNECTION_MODE_LABELS, lowercaseKey, String(value || 'Not configured'))
}

export function displayLifecycleStatus(value) {
  return fromMap(value, LIFECYCLE_STATUS_LABELS, lowercaseKey, 'Active')
}

export function displayEnvironmentType(value) {
  return fromMap(value, ENVIRONMENT_TYPE_LABELS, lowercaseKey, 'Non-production')
}

export function displayValidationStatus(value) {
  return fromMap(value, VALIDATION_STATUS_LABELS, uppercaseKey, String(value || 'Not checked'))
}

export function displayConfigSource(value) {
  return fromMap(value, CONFIG_SOURCE_LABELS, lowercaseKey, String(value || 'Runtime'))
}
