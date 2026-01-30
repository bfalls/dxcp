import React, { useEffect, useMemo, useState } from 'react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:8000/v1'
const API_TOKEN = import.meta.env.VITE_API_TOKEN || 'demo-token'
const SERVICE_URL_BASE = import.meta.env.VITE_SERVICE_URL_BASE || ''

const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$/

function useApi() {
  const headers = {
    Authorization: `Bearer ${API_TOKEN}`
  }

  const jsonHeaders = {
    ...headers,
    'Content-Type': 'application/json'
  }

  async function get(path) {
    const res = await fetch(`${API_BASE}${path}`, { headers })
    return res.json()
  }

  async function post(path, body, idempotencyKey) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        ...jsonHeaders,
        'Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify(body)
    })
    return res.json()
  }

  return { get, post }
}

function formatTime(value) {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString()
  } catch (err) {
    return value
  }
}

function statusClass(state) {
  return `status ${state || ''}`
}

function deriveTimeline(state) {
  const steps = [
    { key: 'intent', title: 'Intent accepted', detail: 'Deployment intent validated and accepted.' },
    { key: 'engine', title: 'Execution running', detail: 'Spinnaker pipeline executing.' },
    { key: 'result', title: 'Execution result', detail: 'Deployment completed.' }
  ]
  if (state === 'ACTIVE' || state === 'IN_PROGRESS') {
    steps[0].active = true
    steps[1].active = true
  } else if (state === 'SUCCEEDED') {
    steps.forEach((s) => (s.active = true))
  } else if (state === 'FAILED') {
    steps[0].active = true
    steps[1].active = true
    steps[2].active = true
    steps[2].detail = 'Deployment failed.'
  } else if (state === 'CANCELED') {
    steps[0].active = true
    steps[1].active = true
    steps[2].active = true
    steps[2].detail = 'Deployment canceled.'
  } else if (state === 'ROLLED_BACK') {
    steps.forEach((s) => (s.active = true))
    steps[2].detail = 'Rollback completed.'
  }
  return steps
}

export default function App() {
  const api = useApi()
  const [view, setView] = useState('deploy')
  const [services, setServices] = useState([])
  const [service, setService] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [versionMode, setVersionMode] = useState('custom')
  const [versionSelection, setVersionSelection] = useState('auto')
  const [changeSummary, setChangeSummary] = useState('Initial demo deploy')
  const [deployResult, setDeployResult] = useState(null)
  const [deployments, setDeployments] = useState([])
  const [selected, setSelected] = useState(null)
  const [failures, setFailures] = useState([])
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [rollbackResult, setRollbackResult] = useState(null)
  const [spinnakerApps, setSpinnakerApps] = useState([])
  const [spinnakerPipelines, setSpinnakerPipelines] = useState([])
  const [spinnakerApp, setSpinnakerApp] = useState('')
  const [spinnakerPipeline, setSpinnakerPipeline] = useState('')
  const [spinnakerTagName, setSpinnakerTagName] = useState('dxcp')
  const [spinnakerTagValue, setSpinnakerTagValue] = useState('deployable')
  const [spinnakerLoading, setSpinnakerLoading] = useState(false)
  const [spinnakerPipelinesLoading, setSpinnakerPipelinesLoading] = useState(false)
  const [versions, setVersions] = useState([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionsRefreshing, setVersionsRefreshing] = useState(false)
  const [versionsError, setVersionsError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const validVersion = useMemo(() => VERSION_RE.test(version), [version])

  async function refreshDeployments() {
    setErrorMessage('')
    try {
      const data = await api.get('/deployments')
      setDeployments(Array.isArray(data) ? data : [])
    } catch (err) {
      setErrorMessage('Failed to load deployments')
    }
  }

  async function loadServices() {
    setErrorMessage('')
    try {
      const data = await api.get('/services')
      if (Array.isArray(data)) {
        setServices(data)
        if (!service && data.length > 0) {
          setService(data[0].service_name)
        }
      }
    } catch (err) {
      setErrorMessage('Failed to load services')
    }
  }

  async function loadSpinnakerApplications() {
    setErrorMessage('')
    setSpinnakerLoading(true)
    try {
      const query = new URLSearchParams()
      if (spinnakerTagName) query.set('tagName', spinnakerTagName)
      if (spinnakerTagValue) query.set('tagValue', spinnakerTagValue)
      const suffix = query.toString() ? `?${query.toString()}` : ''
      const data = await api.get(`/spinnaker/applications${suffix}`)
      const apps = Array.isArray(data?.applications) ? data.applications : []
      setSpinnakerApps(apps)
      if (apps.length > 0 && !spinnakerApp) {
        setSpinnakerApp(apps[0].name)
      }
    } catch (err) {
      setErrorMessage('Failed to load Spinnaker applications')
    } finally {
      setSpinnakerLoading(false)
    }
  }

  async function loadSpinnakerPipelines(appName) {
    if (!appName) return
    setErrorMessage('')
    setSpinnakerPipelinesLoading(true)
    try {
      const data = await api.get(`/spinnaker/applications/${appName}/pipelines`)
      const pipelines = Array.isArray(data?.pipelines) ? data.pipelines : []
      setSpinnakerPipelines(pipelines)
      if (pipelines.length > 0 && !spinnakerPipeline) {
        setSpinnakerPipeline(pipelines[0].name)
      }
    } catch (err) {
      setErrorMessage('Failed to load Spinnaker pipelines')
    } finally {
      setSpinnakerPipelinesLoading(false)
    }
  }

  async function loadVersions(refresh = false) {
    if (!service) return
    if (refresh) {
      setVersionsRefreshing(true)
    } else {
      setVersionsLoading(true)
    }
    setVersionsError('')
    try {
      const suffix = refresh ? '?refresh=1' : ''
      const data = await api.get(`/services/${encodeURIComponent(service)}/versions${suffix}`)
      const list = Array.isArray(data?.versions) ? data.versions : []
      setVersions(list)
    } catch (err) {
      setVersionsError('Failed to load versions')
    } finally {
      if (refresh) {
        setVersionsRefreshing(false)
      } else {
        setVersionsLoading(false)
      }
    }
  }

  async function refreshData() {
    setRefreshing(true)
    const tasks = [loadSpinnakerApplications(), loadVersions(true)]
    if (spinnakerApp) {
      tasks.push(loadSpinnakerPipelines(spinnakerApp))
    }
    await Promise.allSettled(tasks)
    setRefreshing(false)
  }

  async function handleDeploy() {
    setErrorMessage('')
    setStatusMessage('')
    setDeployResult(null)
    if (!validVersion) {
      setErrorMessage('Version format is invalid')
      return
    }
    if (!spinnakerApp || !spinnakerPipeline) {
      setErrorMessage('Spinnaker application and pipeline are required')
      return
    }
    const key = `deploy-${Date.now()}`
    const payload = {
      service,
      environment: 'sandbox',
      version,
      changeSummary,
      spinnakerApplication: spinnakerApp,
      spinnakerPipeline: spinnakerPipeline
    }
    const result = await api.post('/deployments', payload, key)
    if (result && result.code) {
      setErrorMessage(`${result.code}: ${result.message}`)
      return
    }
    setDeployResult(result)
    setStatusMessage(`Deployment created with id ${result.id}`)
    await refreshDeployments()
  }

  async function openDeployment(deployment) {
    setSelected(null)
    setFailures([])
    setRollbackResult(null)
    setErrorMessage('')
    setStatusMessage('')
    try {
      const detail = await api.get(`/deployments/${deployment.id}`)
      if (detail && detail.code) {
        setErrorMessage(`${detail.code}: ${detail.message}`)
        return
      }
      setSelected(detail)
      const failureData = await api.get(`/deployments/${deployment.id}/failures`)
      setFailures(Array.isArray(failureData) ? failureData : [])
      setView('detail')
    } catch (err) {
      setErrorMessage('Failed to load deployment detail')
    }
  }

  async function handleRollback() {
    if (!selected) return
    setErrorMessage('')
    setStatusMessage('')
    const ok = window.confirm('Confirm rollback?')
    if (!ok) return
    const key = `rollback-${Date.now()}`
    const result = await api.post(`/deployments/${selected.id}/rollback`, {}, key)
    if (result && result.code) {
      setErrorMessage(`${result.code}: ${result.message}`)
      return
    }
    setRollbackResult(result)
    setSelected(result)
    setFailures([])
    setStatusMessage(`Rollback started with id ${result.id}`)
    await refreshDeployments()
  }

  useEffect(() => {
    loadServices()
    loadSpinnakerApplications()
  }, [])

  useEffect(() => {
    setVersions([])
    if (service) {
      setVersionSelection('auto')
      loadVersions()
    }
  }, [service])

  useEffect(() => {
    if (versions.length > 0 && versionMode === 'auto') {
      if (versionSelection === 'auto') {
        setVersion(versions[0].version)
      }
    }
  }, [versions, versionMode, versionSelection])

  useEffect(() => {
    setSpinnakerApps([])
    setSpinnakerApp('')
    setSpinnakerPipelines([])
    setSpinnakerPipeline('')
    loadSpinnakerApplications()
  }, [spinnakerTagName, spinnakerTagValue])

  useEffect(() => {
    if (!spinnakerApp) return
    setSpinnakerPipelines([])
    setSpinnakerPipeline('')
    loadSpinnakerPipelines(spinnakerApp)
  }, [spinnakerApp])

  useEffect(() => {
    if (view !== 'deploy' || !service) return undefined
    let cancelled = false
    const interval = setInterval(() => {
      if (!cancelled) loadVersions()
    }, 60000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [view, service])

  useEffect(() => {
    if (view !== 'detail' || !selected?.id) return undefined
    let cancelled = false
    const interval = setInterval(async () => {
      try {
        const detail = await api.get(`/deployments/${selected.id}`)
        if (!cancelled && detail && !detail.code) {
          setSelected(detail)
          const failureData = await api.get(`/deployments/${selected.id}/failures`)
          setFailures(Array.isArray(failureData) ? failureData : [])
        }
      } catch (err) {
        if (!cancelled) setErrorMessage('Failed to refresh deployment status')
      }
    }, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [view, selected?.id])

  const timeline = deriveTimeline(selected?.state)
  const selectedService = services.find((s) => s.service_name === selected?.service)
  let serviceUrl = ''
  if (selectedService?.stable_service_url_template) {
    serviceUrl = selectedService.stable_service_url_template
      .replace('{service}', selected?.service || '')
      .replace('{version}', selected?.version || '')
  } else if (SERVICE_URL_BASE && selected) {
    serviceUrl = `${SERVICE_URL_BASE}/${selected.service}`
  }

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <h1>DXCP Control Plane</h1>
          <span>Deploy intent, see normalized status, and recover fast.</span>
        </div>
        <nav className="nav">
          <button className={view === 'deploy' ? 'active' : ''} onClick={() => setView('deploy')}>
            Deploy
          </button>
          <button
            className={view === 'deployments' ? 'active' : ''}
            onClick={() => {
              setView('deployments')
              refreshDeployments()
            }}
          >
            Deployments
          </button>
          <button
            className={view === 'detail' ? 'active' : ''}
            onClick={() => {
              setView('detail')
              if (services.length === 0) loadServices()
            }}
          >
            Detail
          </button>
        </nav>
      </header>

      {errorMessage && (
        <div className="shell">
          <div className="card">{errorMessage}</div>
        </div>
      )}

      {view === 'deploy' && (
        <div className="shell">
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Deploy intent</h2>
              <button className="button secondary" onClick={refreshData} disabled={refreshing}>
                {refreshing ? 'Refreshing…' : 'Refresh data'}
              </button>
            </div>
            <div className="field">
              <label>Service</label>
              <select
                value={service}
                onFocus={() => {
                  if (services.length === 0) loadServices()
                }}
                onChange={(e) => setService(e.target.value)}
              >
                {services.length === 0 && <option value="">No services registered</option>}
                {services.map((svc) => (
                  <option key={svc.service_name} value={svc.service_name}>
                    {svc.service_name}
                  </option>
                ))}
              </select>
              <div className="helper">Allowlisted services only.</div>
            </div>
            <div className="row">
              <div className="field">
                <label>Spinnaker tag name</label>
                <input value={spinnakerTagName} onChange={(e) => setSpinnakerTagName(e.target.value)} />
              </div>
              <div className="field">
                <label>Spinnaker tag value</label>
                <input value={spinnakerTagValue} onChange={(e) => setSpinnakerTagValue(e.target.value)} />
              </div>
            </div>
            <div className="helper">
              Only Spinnaker applications with this tag are shown. Suggested tag: dxcp=deployable.
            </div>
            <div className="row">
              <div className="field">
                <label>Spinnaker application</label>
                <select value={spinnakerApp} onChange={(e) => setSpinnakerApp(e.target.value)} disabled={spinnakerLoading}>
                  {spinnakerLoading && <option value="">Loading applications…</option>}
                  {!spinnakerLoading && spinnakerApps.length === 0 && <option value="">No applications found</option>}
                  {spinnakerApps.map((app) => (
                    <option key={app.name} value={app.name}>
                      {app.name}
                    </option>
                  ))}
                </select>
                <div className="helper">Discovered via Gate.</div>
              </div>
              <div className="field">
                <label>Spinnaker pipeline</label>
                <select value={spinnakerPipeline} onChange={(e) => setSpinnakerPipeline(e.target.value)} disabled={spinnakerPipelinesLoading}>
                  {spinnakerPipelinesLoading && <option value="">Loading pipelines…</option>}
                  {!spinnakerPipelinesLoading && spinnakerPipelines.length === 0 && <option value="">No pipelines found</option>}
                  {spinnakerPipelines.map((pipeline) => (
                    <option key={pipeline.name} value={pipeline.name}>
                      {pipeline.name}
                    </option>
                  ))}
                </select>
                <div className="helper">Pipeline configs for selected app.</div>
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>Environment</label>
                <input value="sandbox" disabled />
                <div className="helper">Single environment for demo safety.</div>
              </div>
            <div className="field">
              <label>Version</label>
              <select
                value={versionMode === 'auto' ? version : '__custom__'}
                onChange={(e) => {
                  if (e.target.value === '__custom__') {
                    setVersionMode('custom')
                    setVersionSelection('user')
                  } else {
                    setVersionMode('auto')
                    setVersion(e.target.value)
                    setVersionSelection('user')
                  }
                }}
                disabled={versions.length === 0}
              >
                {versions.length === 0 && <option value="__custom__">Custom…</option>}
                {versions.map((item) => (
                  <option key={item.version} value={item.version}>
                    {item.version}
                  </option>
                ))}
                <option value="__custom__">Custom…</option>
              </select>
              {versionMode === 'custom' && (
                <input
                  style={{ marginTop: '8px' }}
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="Enter a version"
                />
              )}
              <div className="helper">
                  Format: 1.2.3 or 1.2.3-suffix. {validVersion ? 'Valid' : 'Invalid'}
              </div>
              {versionsLoading && <div className="helper">Loading versions…</div>}
              {versionsRefreshing && <div className="helper">Refreshing versions…</div>}
              {versionsError && <div className="helper">{versionsError}</div>}
              {!versionsLoading && !versionsRefreshing && !versionsError && versions.length > 0 && (
                <div className="helper">Latest discovered: {versions[0].version}</div>
              )}
              <div className="helper">
                If no build is registered, DXCP auto-registers s3://&lt;runtime-bucket&gt;/{service}/{service}-{version}.zip.
              </div>
            </div>
            </div>
            <div className="field">
              <label>Change summary</label>
              <input value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} />
            </div>
            <button className="button" onClick={handleDeploy}>Deploy now</button>
            {statusMessage && <div className="helper" style={{ marginTop: '12px' }}>{statusMessage}</div>}
          </div>
          <div className="card">
            <h2>Latest deployment</h2>
            {deployResult ? (
              <div>
                <div className={statusClass(deployResult.state)}>{deployResult.state}</div>
                <p>Service: {deployResult.service}</p>
                <p>Version: {deployResult.version}</p>
                <p>Deployment id: {deployResult.id}</p>
                {deployResult.spinnakerExecutionId && <p>Spinnaker execution: {deployResult.spinnakerExecutionId}</p>}
                <button className="button secondary" onClick={() => openDeployment(deployResult)}>
                  View detail
                </button>
              </div>
            ) : (
              <div className="helper">No deployment created yet.</div>
            )}
          </div>
        </div>
      )}

      {view === 'deployments' && (
        <div className="shell">
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Recent deployments</h2>
              <button className="button secondary" onClick={refreshDeployments}>Refresh</button>
            </div>
            <div className="list">
              {deployments.length === 0 && <div className="helper">No deployments yet.</div>}
              {deployments.map((d) => (
                <div className="list-item" key={d.id}>
                  <div className={statusClass(d.state)}>{d.state}</div>
                  <div>{d.service}</div>
                  <div>{d.version}</div>
                  <div>{formatTime(d.createdAt)}</div>
                  <button className="button secondary" onClick={() => openDeployment(d)}>
                    Details
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {view === 'detail' && (
        <div className="shell">
          <div className="card">
            <h2>Deployment detail</h2>
            {!selected && <div className="helper">Select a deployment from the list.</div>}
            {selected && (
              <div>
                <div className={statusClass(selected.state)}>{selected.state}</div>
                {statusMessage && <div className="helper" style={{ marginTop: '8px' }}>{statusMessage}</div>}
                <p>Service: {selected.service}</p>
                <p>Version: {selected.version}</p>
                <p>Created: {formatTime(selected.createdAt)}</p>
                <p>Updated: {formatTime(selected.updatedAt)}</p>
                {selected.spinnakerExecutionId && <p>Spinnaker execution: {selected.spinnakerExecutionId}</p>}
                <div className="links">
                  {selected.spinnakerExecutionUrl && (
                    <a className="link" href={selected.spinnakerExecutionUrl} target="_blank" rel="noreferrer">
                      Spinnaker execution
                    </a>
                  )}
                  {serviceUrl && (
                    <a className="link" href={serviceUrl} target="_blank" rel="noreferrer">
                      Service URL
                    </a>
                  )}
                </div>
                <button className="button danger" onClick={handleRollback} style={{ marginTop: '12px' }}>
                  Rollback
                </button>
                {selected.rollbackOf && (
                  <button className="button secondary" onClick={() => openDeployment({ id: selected.rollbackOf })} style={{ marginTop: '8px' }}>
                    View original deployment
                  </button>
                )}
                {rollbackResult && (
                  <div className="helper" style={{ marginTop: '8px' }}>
                    Rollback created: {rollbackResult.id}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="card">
            <h2>Timeline</h2>
            <div className="timeline">
              {timeline.map((step) => (
                <div key={step.key} className={`timeline-step ${step.active ? 'active' : ''}`}>
                  <strong>{step.title}</strong>
                  <div className="helper">{step.detail}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <h2>Failures</h2>
            {failures.length === 0 && <div className="helper">No failures reported.</div>}
            {failures.map((f, idx) => (
              <div key={idx} className="failure">
                <div><strong>{f.category}</strong> - {f.summary}</div>
                {f.actionHint && <div className="helper">Next action: {f.actionHint}</div>}
                {f.detail && <div className="helper">Evidence: {f.detail}</div>}
                {f.observedAt && <div className="helper">Observed: {formatTime(f.observedAt)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <footer className="footer">
        DXCP demo UI. Guardrails enforced by the API: allowlist, sandbox only, global lock, rate limits, idempotency.
      </footer>
    </div>
  )
}
