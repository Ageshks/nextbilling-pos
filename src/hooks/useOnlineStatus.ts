import { useCallback, useEffect, useRef, useState } from 'react'

export type ConnectionStatus = 'online' | 'offline' | 'unknown'

/**
 * Tracks navigator online/offline state. When the browser reports offline we
 * reflect it immediately; when it reports online we double-check with a
 * lightweight network fetch so we never falsely claim synced data.
 */
export function useOnlineStatus(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(() =>
    typeof navigator !== 'undefined' && navigator.onLine ? 'online' : 'offline',
  )
  const [verified, setVerified] = useState(true)

  useEffect(() => {
    const goOnline = () => {
      // Probe connectivity before declaring online.
      setVerified(false)
      fetch('https://firestore.googleapis.com/.well-known', { mode: 'no-cors', cache: 'no-store' })
        .then(() => {
          setStatus('online')
          setVerified(true)
        })
        .catch(() => {
          setStatus('offline')
          setVerified(true)
        })
    }
    const goOffline = () => setStatus('offline')

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (!verified && status === 'online') return 'unknown'
  return status
}

export function useDebounce<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay)
    return () => window.clearTimeout(id)
  }, [value, delay])
  return debounced
}

export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined)
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref.current
}

export function useInterval(callback: () => void, delay: number | null): void {
  const savedCallback = useRef(callback)
  useEffect(() => {
    savedCallback.current = callback
  }, [callback])
  useEffect(() => {
    if (delay === null) return
    const id = window.setInterval(() => savedCallback.current(), delay)
    return () => window.clearInterval(id)
  }, [delay])
}

export function useKeydown(handler: (event: KeyboardEvent) => void, active = true): void {
  const saved = useRef(handler)
  useEffect(() => {
    saved.current = handler
  }, [handler])
  useEffect(() => {
    if (!active) return
    const listener = (e: KeyboardEvent) => saved.current(e)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [active])
}

export function usePlayScanSound(enabled: boolean): () => void {
  const audioCtx = useRef<AudioContext | null>(null)
  const play = useCallback(() => {
    if (!enabled) return
    try {
      audioCtx.current ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      const ctx = audioCtx.current
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.value = 0.08
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      window.setTimeout(() => {
        osc.stop()
        osc.disconnect()
      }, 90)
    } catch {
      // audio unsupported — never break the scan flow
    }
  }, [enabled])
  return play
}