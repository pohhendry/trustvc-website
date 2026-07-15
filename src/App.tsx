import { useState, useEffect } from 'react'
import { matchPath, useLocation } from 'react-router-dom'
import Navbar from './components/common/Navbar'
import AppRouter from './routes'
import { GoogleTagManager } from './components/common/GoogleTagManager'
import { IS_MINIMAL_VERIFIER } from './configs/env-config'
import MinimalVerifierApp from './components/minimal-verifier'

const GTM_CONTAINER_ID = import.meta.env.VITE_GTM_CONTAINER_ID as
  | string
  | undefined
const GA4_TAG_ID = import.meta.env.VITE_GA4_TAG_ID as string | undefined

type BackgroundRouteRule = {
  paths: string[]
  lightClass: string
  darkClass: string
}

const BACKGROUND_ROUTE_RULES: BackgroundRouteRule[] = [
  {
    paths: ['/news-updates', '/news-updates/:slug'],
    lightClass: 'app-shell--news-light',
    darkClass: 'app-shell--news-dark',
  },
  {
    paths: ['/settings'],
    lightClass: 'app-shell--settings-light',
    darkClass: 'app-shell--settings-dark',
  },
  {
    paths: ['/partners'],
    lightClass: 'app-shell--partners-light',
    darkClass: 'app-shell--partners-dark',
  },
  {
    paths: ['/about'],
    lightClass: 'app-shell--about-light',
    darkClass: 'app-shell--about-dark',
  },
]

function App() {
  const location = useLocation()
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('darkMode')
      return saved ? JSON.parse(saved) === true : false
    } catch {
      return false
    }
  })

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(isDarkMode))
  }, [isDarkMode])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark-mode')
    } else {
      document.body.classList.remove('dark-mode')
    }
  }, [isDarkMode])

  if (IS_MINIMAL_VERIFIER) {
    return <MinimalVerifierApp />
  }

  const matchedBackgroundRule = BACKGROUND_ROUTE_RULES.find(rule =>
    rule.paths.some(path => Boolean(matchPath(path, location.pathname)))
  )

  const backgroundClassName = matchedBackgroundRule
    ? isDarkMode
      ? matchedBackgroundRule.darkClass
      : matchedBackgroundRule.lightClass
    : isDarkMode
      ? 'app-shell--bg-dark'
      : 'app-shell--bg-light'

  const appShellClassName = `app-shell ${backgroundClassName}`

  return (
    <>
      <GoogleTagManager
        gtmContainerId={GTM_CONTAINER_ID}
        ga4TagId={GA4_TAG_ID}
      />
      <div className={appShellClassName}>
        <Navbar isDarkMode={isDarkMode} setIsDarkMode={setIsDarkMode} />
        <AppRouter isDarkMode={isDarkMode} />
      </div>
    </>
  )
}

export default App
