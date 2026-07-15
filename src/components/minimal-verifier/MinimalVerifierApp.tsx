import { useEffect } from 'react'
import VerifySection from '../home/VerifySection'

const PAGE_TITLE = 'Doc Verifier · Dev Build'

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="#1E293B"/><path d="M12 5.5L19 18H5L12 5.5Z" fill="#F59E0B"/><rect x="11" y="10" width="2" height="5" fill="#1E293B"/><rect x="11" y="16" width="2" height="2" fill="#1E293B"/></svg>`

const setMinimalFavicon = () => {
  const href = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`
  let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']")
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.type = 'image/svg+xml'
  link.href = href
}

const MinimalVerifierApp = () => {
  useEffect(() => {
    document.title = PAGE_TITLE
    setMinimalFavicon()
  }, [])

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <div
        role="alert"
        className="w-full bg-amber-500 px-4 py-2 text-center text-sm font-bold text-slate-900"
      >
        ⚠ Development Build — internal testing only. Not affiliated with
        trustvc.io.
      </div>
      <header className="flex items-center justify-center border-b border-slate-700 py-6">
        <span className="text-xl font-bold tracking-wide text-amber-400">
          Doc Verifier{' '}
          <span className="font-normal text-slate-400">· Dev Build</span>
        </span>
      </header>
      <main className="flex flex-col items-center p-10">
        <VerifySection isDarkMode={false} showDemoCta={false} />
      </main>
    </div>
  )
}

export default MinimalVerifierApp
