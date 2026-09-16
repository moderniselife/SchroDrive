"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Check, RefreshCw, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type ReviewEntry = {
  id: string
  sourcePath: string
  sourceBasename: string
  parsed: {
    status: "matched" | "ambiguous" | "unmatched"
    kind?: string
    title?: string
    year?: number
    season?: number
    episode?: number
    confidence: number
    reason: string
  }
  decision: string
}

export default function ReviewPage() {
  const [entries, setEntries] = useState<ReviewEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({})
  const [yearOverrides, setYearOverrides] = useState<Record<string, string>>({})
  const [seasonOverrides, setSeasonOverrides] = useState<Record<string, string>>({})
  const [episodeOverrides, setEpisodeOverrides] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/organizer/review", { cache: "no-store" })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || "Unable to load review queue")
      setEntries(data.entries || [])
      setError("")
    } catch (value: any) {
      setError(value.message || "Unable to load review queue")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function decide(id: string, decision: "accepted" | "dismissed") {
    const title = titleOverrides[id]?.trim()
    const year = Number(yearOverrides[id]) || undefined
    const season = Number(seasonOverrides[id]) || undefined
    const episode = Number(episodeOverrides[id]) || undefined
    const response = await fetch(`/api/organizer/review/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, ...((title || year || season || episode) ? { override: { title, year, season, episode } } : {}) }),
    })
    if (response.ok) await load()
    else setError((await response.json()).error || "Unable to save review decision")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Organizer Review</h1>
          <p className="text-muted-foreground">Resolve ambiguous or unmatched media identities.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {error && <div className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">{error}</div>}
      {!loading && entries.length === 0 && (
        <Card><CardContent className="pt-6 text-muted-foreground">No pending review entries.</CardContent></Card>
      )}
      <div className="grid gap-4">
        {entries.map((entry) => (
          <Card key={entry.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-yellow-500" />{entry.sourceBasename}</CardTitle>
                <Badge variant="outline">{entry.parsed.status} · {Math.round(entry.parsed.confidence * 100)}%</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="break-all text-xs text-muted-foreground">{entry.sourcePath}</p>
              <p className="text-sm">Detected: <span className="font-medium">{entry.parsed.title || "No title"}</span> · {entry.parsed.reason}</p>
              <div className="flex flex-wrap gap-2">
                <Input className="max-w-sm" placeholder="Optional title override" value={titleOverrides[entry.id] || ""} onChange={(event) => setTitleOverrides((current) => ({ ...current, [entry.id]: event.target.value }))} />
                <Input className="w-24" placeholder="Year" inputMode="numeric" value={yearOverrides[entry.id] || ""} onChange={(event) => setYearOverrides((current) => ({ ...current, [entry.id]: event.target.value }))} />
                <Input className="w-24" placeholder="Season" inputMode="numeric" value={seasonOverrides[entry.id] || ""} onChange={(event) => setSeasonOverrides((current) => ({ ...current, [entry.id]: event.target.value }))} />
                <Input className="w-24" placeholder="Episode" inputMode="numeric" value={episodeOverrides[entry.id] || ""} onChange={(event) => setEpisodeOverrides((current) => ({ ...current, [entry.id]: event.target.value }))} />
                <Button size="sm" onClick={() => void decide(entry.id, "accepted")}><Check className="mr-2 h-4 w-4" /> Accept</Button>
                <Button size="sm" variant="outline" onClick={() => void decide(entry.id, "dismissed")}><X className="mr-2 h-4 w-4" /> Dismiss</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
