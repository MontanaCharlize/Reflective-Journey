import { useEffect, useRef, useState } from 'react'

export function usePagedList<T extends { id: string }>(key: string, loader: (cursor: string) => Promise<{ items: T[]; nextCursor: string | null }>, enabled = true) {
  const [items, setItems] = useState<T[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const cursorRef = useRef(cursor)
  const version = useRef(0)
  const busy = useRef(false)
  const currentLoader = useRef(loader)
  currentLoader.current = loader
  const load = async (more = false) => {
    if (!enabled || (more && (busy.current || !cursorRef.current))) return
    const generation = ++version.current
    busy.current = true; setLoading(true); setError('')
    if (!more) { setItems([]); setCursor(null) }
    try {
      const page = await currentLoader.current(more ? cursorRef.current || '' : '')
      if (generation !== version.current) return
      setItems((previous) => more ? [...previous, ...page.items.filter((item) => !previous.some((old) => old.id === item.id))] : page.items)
      cursorRef.current = page.nextCursor; setCursor(page.nextCursor)
    } catch (failure) { if (generation === version.current) setError(failure instanceof Error ? failure.message : '暂时无法读取，请稍后重试。') }
    finally { if (generation === version.current) { busy.current = false; setLoading(false) } }
  }
  useEffect(() => {
    cursorRef.current = null; setItems([]); setCursor(null); setError('')
    if (enabled) void load()
    else setLoading(false)
    return () => { version.current++; busy.current = false }
  }, [key, enabled])
  return { items, setItems, loading, error, cursor, refresh: () => load(), more: () => load(true) }
}
