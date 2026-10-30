import { useState } from 'react'
import { X, Share, Plus } from 'lucide-react'
import { usePWAInstall } from '../hooks/usePWAInstall'

export default function InstallBanner() {
  const { installPrompt, isInstalled, isIOS, triggerInstall } = usePWAInstall()
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('pwa-dismissed') === '1')

  if (isInstalled || dismissed) return null
  if (!installPrompt && !isIOS) return null

  const dismiss = () => {
    sessionStorage.setItem('pwa-dismissed', '1')
    setDismissed(true)
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-sm sm:rounded-2xl shadow-xl"
      style={{ backgroundColor: '#1B4D3E' }}>
      <div className="flex items-start gap-3 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-4">
        <div className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-lg font-serif font-medium"
          style={{ backgroundColor: '#F7F5F0', color: '#1B4D3E' }}>
          C
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white leading-tight">Add MaeMate to your home screen</p>
          {isIOS ? (
            <p className="text-xs mt-1" style={{ color: 'rgba(247,245,240,0.7)' }}>
              Tap <Share className="inline w-3 h-3" /> then <strong className="text-white">"Add to Home Screen"</strong> <Plus className="inline w-3 h-3" />
            </p>
          ) : (
            <p className="text-xs mt-1" style={{ color: 'rgba(247,245,240,0.7)' }}>
              Get the full app experience — works offline too.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isIOS && (
            <button
              onClick={triggerInstall}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ backgroundColor: '#F7F5F0', color: '#1B4D3E' }}>
              Install
            </button>
          )}
          <button onClick={dismiss} aria-label="Dismiss install banner" className="p-1 rounded-lg" style={{ color: 'rgba(247,245,240,0.6)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
