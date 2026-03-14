import { matchPath } from 'react-router-dom'

export const EXPERIENCE_CHOICE_STORAGE_KEY = 'dxcp.experience_choice.v1'

function getStorage() {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  if (typeof globalThis !== 'undefined' && globalThis.localStorage) return globalThis.localStorage
  return null
}

export function loadExperienceChoice() {
  const storage = getStorage()
  if (!storage) return ''
  try {
    const rawValue = storage.getItem(EXPERIENCE_CHOICE_STORAGE_KEY)
    return rawValue === 'new' || rawValue === 'legacy' ? rawValue : ''
  } catch {
    return ''
  }
}

export function saveExperienceChoice(choice) {
  const storage = getStorage()
  if (!storage) return
  if (choice !== 'new' && choice !== 'legacy') return
  storage.setItem(EXPERIENCE_CHOICE_STORAGE_KEY, choice)
}

export function getDefaultEntryPath(choice) {
  return choice === 'new' ? '/new/applications' : '/services'
}

export function resolveExperienceFromPath(pathname) {
  if (!pathname) return ''
  if (pathname.startsWith('/new')) return 'new'
  if (
    pathname.startsWith('/services') ||
    pathname.startsWith('/deploy') ||
    pathname.startsWith('/deployments') ||
    pathname.startsWith('/insights') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/admin')
  ) {
    return 'legacy'
  }
  return ''
}

export function syncExperienceChoiceForPath(pathname) {
  const choice = resolveExperienceFromPath(pathname)
  if (choice) {
    saveExperienceChoice(choice)
  }
  return choice
}

function appendSearch(pathname, search = '') {
  return search ? `${pathname}${search}` : pathname
}

export function getNewExperiencePath(pathname, search = '') {
  if (!pathname) return '/new/applications'
  if (pathname.startsWith('/new')) return appendSearch(pathname, search)

  const applicationMatch = matchPath('/services/:applicationName', pathname)
  if (applicationMatch?.params?.applicationName) {
    return `/new/applications/${encodeURIComponent(applicationMatch.params.applicationName)}`
  }

  const deploymentMatch = matchPath('/deployments/:deploymentId', pathname)
  if (deploymentMatch?.params?.deploymentId) {
    return `/new/deployments/${encodeURIComponent(deploymentMatch.params.deploymentId)}`
  }

  if (pathname === '/deploy') {
    const params = new URLSearchParams(search || '')
    const applicationName = (params.get('service') || '').trim()
    if (applicationName) {
      return `/new/applications/${encodeURIComponent(applicationName)}/deploy`
    }
    return '/new/applications'
  }

  if (pathname === '/deployments') {
    return appendSearch('/new/deployments', search)
  }

  if (pathname === '/insights') {
    return appendSearch('/new/insights', search)
  }

  if (pathname === '/admin') {
    return '/new/admin'
  }

  return '/new/applications'
}

export function getLegacyExperiencePath(pathname, search = '') {
  if (!pathname) return '/services'
  if (!pathname.startsWith('/new')) return appendSearch(pathname, search)

  const deployMatch = matchPath('/new/applications/:applicationName/deploy/:scenario', pathname) ||
    matchPath('/new/applications/:applicationName/deploy', pathname)
  if (deployMatch?.params?.applicationName) {
    const applicationName = encodeURIComponent(deployMatch.params.applicationName)
    return `/deploy?service=${applicationName}`
  }

  const applicationMatch = matchPath('/new/applications/:applicationName', pathname)
  if (applicationMatch?.params?.applicationName) {
    return `/services/${encodeURIComponent(applicationMatch.params.applicationName)}`
  }

  const deploymentMatch = matchPath('/new/deployments/:deploymentId', pathname)
  if (deploymentMatch?.params?.deploymentId) {
    return `/deployments/${encodeURIComponent(deploymentMatch.params.deploymentId)}`
  }

  if (pathname === '/new/deployments') {
    return appendSearch('/deployments', search)
  }

  if (pathname === '/new/insights') {
    return appendSearch('/insights', search)
  }

  if (pathname === '/new/admin') {
    return '/admin'
  }

  if (pathname === '/new/deploy') {
    return '/deploy'
  }

  return '/services'
}
