"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Folder, Film, Tv, FileVideo, Search, Grid, List, RefreshCw, Loader2, HardDrive } from "lucide-react"

interface Torrent {
  id: string
  name: string
  status: string
  progress: number
  size: number
  provider: string
  addedAt: string
}

function formatBytes(bytes: number) {
  if (!bytes || bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

function getFileIcon(name: string) {
  const lowerName = name.toLowerCase()
  if (lowerName.includes("movie") || lowerName.includes("film") || lowerName.includes("bluray") || lowerName.includes("brrip") || lowerName.includes("dvdrip")) {
    return <Film className="h-5 w-5 text-purple-500" />
  }
  if (lowerName.match(/s\d{2}e\d{2}|season|episode|\.s\d{2}\./i)) {
    return <Tv className="h-5 w-5 text-green-500" />
  }
  return <FileVideo className="h-5 w-5 text-blue-500" />
}

function formatDate(dateString: string): string {
  if (!dateString) return "Unknown"
  const date = new Date(dateString)
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export default function FilesPage() {
  const [torrents, setTorrents] = useState<Torrent[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [view, setView] = useState<"grid" | "list">("list")
  const [search, setSearch] = useState("")
  const [providerFilter, setProviderFilter] = useState<string>("all")

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
  }, [])

  function handleRefresh() {
    setRefreshing(true)
    fetchTorrents()
  }

  // Filter torrents
  const filteredTorrents = torrents.filter((t) => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false
    if (providerFilter !== "all" && t.provider !== providerFilter) return false
    return true
  })

  // Get unique providers
  const providers = [...new Set(torrents.map((t) => t.provider))]

  // Stats
  const totalSize = torrents.reduce((acc, t) => acc + (t.size || 0), 0)
  const torboxCount = torrents.filter((t) => t.provider === "torbox").length
  const rdCount = torrents.filter((t) => t.provider === "realdebrid").length

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Browse Files</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
        <Card><CardContent className="pt-6"><Skeleton className="h-96 w-full" /></CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Browse Files</h1>
          <p className="text-muted-foreground">
            {torrents.length} items • {formatBytes(totalSize)} total
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <Card className="flex-1 flex flex-col">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Button 
                variant={providerFilter === "all" ? "secondary" : "ghost"} 
                size="sm"
                onClick={() => setProviderFilter("all")}
              >
                All ({torrents.length})
              </Button>
              {providers.includes("torbox") && (
                <Button 
                  variant={providerFilter === "torbox" ? "secondary" : "ghost"} 
                  size="sm"
                  onClick={() => setProviderFilter("torbox")}
                >
                  TorBox ({torboxCount})
                </Button>
              )}
              {providers.includes("realdebrid") && (
                <Button 
                  variant={providerFilter === "realdebrid" ? "secondary" : "ghost"} 
                  size="sm"
                  onClick={() => setProviderFilter("realdebrid")}
                >
                  Real-Debrid ({rdCount})
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant={view === "list" ? "secondary" : "ghost"} size="icon" onClick={() => setView("list")}>
                <List className="h-4 w-4" />
              </Button>
              <Button variant={view === "grid" ? "secondary" : "ghost"} size="icon" onClick={() => setView("grid")}>
                <Grid className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="relative pt-2">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input 
              placeholder="Search files..." 
              className="pl-9" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          <ScrollArea className="h-[500px]">
            {filteredTorrents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <HardDrive className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-4 text-lg font-medium">
                  {search ? "No matching files" : "No files found"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {search ? "Try a different search term" : "Add content to see your files here"}
                </p>
              </div>
            ) : view === "list" ? (
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-sm text-muted-foreground">
                    <th className="p-4 font-medium">Name</th>
                    <th className="p-4 font-medium">Size</th>
                    <th className="p-4 font-medium">Provider</th>
                    <th className="p-4 font-medium">Added</th>
                    <th className="p-4 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTorrents.map((torrent) => (
                    <tr key={torrent.id} className="border-b hover:bg-muted/50">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          {getFileIcon(torrent.name)}
                          <span className="font-medium truncate max-w-[400px]">{torrent.name}</span>
                        </div>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">
                        {formatBytes(torrent.size)}
                      </td>
                      <td className="p-4">
                        <Badge variant="outline" className="capitalize">{torrent.provider}</Badge>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground">
                        {formatDate(torrent.addedAt)}
                      </td>
                      <td className="p-4">
                        <Badge variant={torrent.progress >= 100 ? "default" : "secondary"}>
                          {torrent.progress >= 100 ? "Ready" : `${Math.round(torrent.progress)}%`}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
                {filteredTorrents.map((torrent) => (
                  <div key={torrent.id} className="rounded-lg border p-4 hover:bg-muted/50 space-y-2">
                    <div className="flex items-center gap-2">
                      {getFileIcon(torrent.name)}
                      <Badge variant="outline" className="capitalize text-xs">{torrent.provider}</Badge>
                    </div>
                    <p className="font-medium text-sm line-clamp-2">{torrent.name}</p>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{formatBytes(torrent.size)}</span>
                      <Badge variant={torrent.progress >= 100 ? "default" : "secondary"} className="text-xs">
                        {torrent.progress >= 100 ? "Ready" : `${Math.round(torrent.progress)}%`}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
