"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Download, Upload, Clock, CheckCircle, XCircle, Loader2, RefreshCw, Magnet, HardDrive } from "lucide-react"

interface Torrent {
  id: string
  name: string
  status: string
  progress: number
  size: number
  provider: string
  addedAt: string
  downloadSpeed: number
  uploadSpeed: number
  seeds: number
  peers: number
}

function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

function formatSpeed(bytesPerSec: number) {
  if (!bytesPerSec || bytesPerSec === 0) return "0 B/s"
  return formatBytes(bytesPerSec) + "/s"
}

function formatRelativeTime(dateString: string): string {
  if (!dateString) return "Unknown"
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  
  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  return `${diffDays}d ago`
}

function getStatus(torrent: Torrent): "downloading" | "seeding" | "completed" | "queued" | "failed" {
  const status = torrent.status.toLowerCase()
  if (torrent.progress >= 100) {
    if (torrent.uploadSpeed > 0) return "seeding"
    return "completed"
  }
  if (status.includes("download") || status.includes("active")) return "downloading"
  if (status.includes("seed")) return "seeding"
  if (status.includes("error") || status.includes("failed") || status.includes("dead")) return "failed"
  if (status.includes("queue") || status.includes("wait") || status.includes("pending")) return "queued"
  if (torrent.downloadSpeed > 0) return "downloading"
  return "queued"
}

const statusIcons: Record<string, React.ReactNode> = {
  downloading: <Download className="h-4 w-4 text-blue-500 animate-pulse" />,
  seeding: <Upload className="h-4 w-4 text-green-500" />,
  completed: <CheckCircle className="h-4 w-4 text-green-500" />,
  queued: <Clock className="h-4 w-4 text-yellow-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
}

export default function TorrentsPage() {
  const [torrents, setTorrents] = useState<Torrent[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function fetchTorrents() {
    try {
      const res = await fetch("/api/torrents")
      const data = await res.json()
      if (data.ok !== false) {
        setTorrents(data.torrents || [])
      }
    } catch (error) {
      console.error("Failed to fetch torrents:", error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchTorrents()
    const interval = setInterval(fetchTorrents, 10000)
    return () => clearInterval(interval)
  }, [])

  function handleRefresh() {
    setRefreshing(true)
    fetchTorrents()
  }

  const activeCount = torrents.filter((t) => getStatus(t) === "downloading").length
  const seedingCount = torrents.filter((t) => getStatus(t) === "seeding").length
  const completedCount = torrents.filter((t) => getStatus(t) === "completed" || getStatus(t) === "seeding").length
  const totalDownSpeed = torrents.reduce((acc, t) => acc + (t.downloadSpeed || 0), 0)
  const totalUpSpeed = torrents.reduce((acc, t) => acc + (t.uploadSpeed || 0), 0)

  // Count by provider
  const torboxCount = torrents.filter((t) => t.provider === "torbox").length
  const rdCount = torrents.filter((t) => t.provider === "realdebrid").length

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Torrents</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-12 w-full" /></CardContent></Card>
          ))}
        </div>
        <Card><CardContent className="pt-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Torrents</h1>
          <p className="text-muted-foreground">
            Real-Debrid & TorBox torrent activity
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Downloading</p>
                <p className="text-2xl font-bold">{activeCount}</p>
              </div>
              <Download className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Completed</p>
                <p className="text-2xl font-bold">{completedCount}</p>
              </div>
              <CheckCircle className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Download Speed</p>
                <p className="text-2xl font-bold">{formatSpeed(totalDownSpeed)}</p>
              </div>
              <Download className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Torrents</p>
                <p className="text-2xl font-bold">{torrents.length}</p>
              </div>
              <Magnet className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="flex-1">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>All Torrents</CardTitle>
            <div className="flex gap-2">
              {torboxCount > 0 && (
                <Badge variant="outline">TorBox: {torboxCount}</Badge>
              )}
              {rdCount > 0 && (
                <Badge variant="outline">Real-Debrid: {rdCount}</Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            {torrents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Magnet className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-4 text-lg font-medium">No torrents</p>
                <p className="text-sm text-muted-foreground">
                  Torrents from Real-Debrid and TorBox will appear here
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {torrents.map((torrent) => {
                  const status = getStatus(torrent)
                  return (
                    <div key={`${torrent.provider}-${torrent.id}`} className="rounded-lg border p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          {statusIcons[status]}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium leading-none break-words">{torrent.name}</p>
                            <div className="flex flex-wrap gap-2 mt-2">
                              <Badge variant="outline" className="capitalize">{torrent.provider}</Badge>
                              <span className="text-xs text-muted-foreground">{formatBytes(torrent.size)}</span>
                              {torrent.seeds > 0 && (
                                <span className="text-xs text-green-500">Seeds: {torrent.seeds}</span>
                              )}
                              {torrent.peers > 0 && (
                                <span className="text-xs text-blue-500">Peers: {torrent.peers}</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                          {formatRelativeTime(torrent.addedAt)}
                        </span>
                      </div>
                      {(status === "downloading" || status === "failed" || (torrent.progress > 0 && torrent.progress < 100)) && (
                        <div className="space-y-1">
                          <Progress value={torrent.progress} />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{Math.round(torrent.progress)}%</span>
                            <div className="flex gap-3">
                              {torrent.downloadSpeed > 0 && (
                                <span className="text-blue-500">↓ {formatSpeed(torrent.downloadSpeed)}</span>
                              )}
                              {torrent.uploadSpeed > 0 && (
                                <span className="text-green-500">↑ {formatSpeed(torrent.uploadSpeed)}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      {(status === "completed" || status === "seeding") && (
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span className="text-green-500">✓ Completed</span>
                          {torrent.uploadSpeed > 0 && (
                            <span className="text-green-500">Seeding: ↑ {formatSpeed(torrent.uploadSpeed)}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
