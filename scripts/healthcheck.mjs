const port = Number(process.env.PORT || 4173)
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(4000) })
  const status = await response.json()
  if (!response.ok || !status.ok || status.database !== 'ready') process.exitCode = 1
} catch { process.exitCode = 1 }
