"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Folder, Film, Tv, FileVideo, Search, Grid, List, RefreshCw, Loader2, HardDrive, ChevronRight, Home, ArrowLeft } from "lucide-react"

interface FileItem {
  name: string
  path: string
  type: "file" | "directory"
  size?: number
  modified?: string
}

function formatBytes(bytes: number | undefined) {
  if (!bytes || bytes === 0) return "—"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

function getFileIcon(name: string, isDir: boolean) {
  if (isDir) {
    return <Folder className="h-5 w-5 text-yellow-500" />
  }
  const lowerName = name.toLowerCase()
  if (lowerName.match(/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$/i)) {
    return <FileVideo className="h-5 w-5 text-blue-500" />
  }
  if (lowerName.includes("movie") || lowerName.includes("film") || lowerName.includes("bluray")) {
    return <Film className="h-5 w-5 text-purple-500" />
  }
  if (lowerName.match(/s\d{2}e\d{2}|season|episode|\.s\d{2}\./i)) {
    return <Tv className="h-5 w-5 text-green-500" />
  }
  return <FileVideo className="h-5 w-5 text-blue-500" />
}

function formatDate(dateString: string | undefined): string {
  if (!dateString) return "—"
  const date = new Date(dateString)
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export default function FilesPage() {
  const [items, setItems] = useState<FileItem[]>([])
  const [currentPath, setCurrentPath] = useState("/")
  const [mountBase, setMountBase] = useState("")
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<"grid" | "list">("list")
  const [search, setSearch] = useState("")

  async function fetchFiles(path: string) {
    setError(null)
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`)
      const data = await res.json()
      if (data.ok === false) {
        setError(data.error || "Failed to load files")
        setItems([])
      } else {
        setItems(data.items || [])
        setMountBase(data.mountBase || "")
        setCurrentPath(data.path || "/")
      }
    } catch (err: any) {
      console.error("Failed to fetch files:", err)
      setError(err.message || "Failed to load files")
      setItems([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchFiles("/")
  }, [])

  function handleRefresh() {
    setRefreshing(true)
    fetchFiles(currentPath)
  }

  function navigateTo(path: string) {
    setLoading(true)
    setSearch("")
    fetchFiles(path)
  }

  function goUp() {
    const parts = currentPath.split("/").filter(Boolean)
    parts.pop()
    navigateTo("/" + parts.join("/"))
  }

  function goHome() {
    navigateTo("/")
  }

  // Filter items
  const filteredItems = items.filter((item) => {
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // Stats
  const dirCount = items.filter((i) => i.type === "directory").length
  const fileCount = items.filter((i) => i.type === "file").length

  // Breadcrumb parts
  const pathParts = currentPath.split("/").filter(Boolean)

  if (loading && items.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Browse Files</h1>
          <p className="text-muted-foreground">Loading filesystem...</p>
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
            {mountBase && <span className="text-xs font-mono">{mountBase}</span>}
            {" • "}{dirCount} folders, {fileCount} files
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <Card className="flex-1 flex flex-col">
        <CardHeader className="pb-4">
          {/* Breadcrumb navigation */}
          <div className="flex items-center gap-2 text-sm mb-3">
            <Button variant="ghost" size="sm" onClick={goHome} className="h-8 px-2">
              <Home className="h-4 w-4" />
            </Button>
            {currentPath !== "/" && (
              <Button variant="ghost" size="sm" onClick={goUp} className="h-8 px-2">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div className="flex items-center gap-1 flex-wrap">
              <Button variant="ghost" size="sm" onClick={goHome} className="h-6 px-1 text-muted-foreground">
                /
              </Button>
              {pathParts.map((part, idx) => (
                <div key={idx} className="flex items-center">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="h-6 px-1"
                    onClick={() => navigateTo("/" + pathParts.slice(0, idx + 1).join("/"))}
                  >
                    {part}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input 
                placeholder="Filter files..." 
                className="pl-9" 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
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
        </CardHeader>
        <CardContent className="flex-1 p-0">
          <ScrollArea className="h-[500px]">
            {error ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <HardDrive className="h-12 w-12 text-red-500/50" />
                <p className="mt-4 text-lg font-medium text-red-500">Error</p>
                <p className="text-sm text-muted-foreground">{error}</p>
                <Button variant="outline" size="sm" className="mt-4" onClick={() => navigateTo("/")}>
                  Go Home
                </Button>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <HardDrive className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-4 text-lg font-medium">
                  {search ? "No matching files" : "Empty directory"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {search ? "Try a different search term" : "This folder is empty"}
                </p>
              </div>
            ) : view === "list" ? (
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-sm text-muted-foreground">
                    <th className="p-4 font-medium">Name</th>
                    <th className="p-4 font-medium">Size</th>
                    <th className="p-4 font-medium">Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr 
                      key={item.path} 
                      className={`border-b hover:bg-muted/50 ${item.type === "directory" ? "cursor-pointer" : ""}`}
                      onClick={() => item.type === "directory" && navigateTo(item.path)}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          {getFileIcon(item.name, item.type === "directory")}
                          <span className="font-medium break-words">{item.name}</span>
                        </div>
                      </td>
                      <td className="p-4 text-sm text-muted-foreground whitespace-nowrap">
                        {item.type === "directory" ? "—" : formatBytes(item.size)}
                      </td>
                      <td className="p-4 text-sm text-muted-foreground whitespace-nowrap">
                        {formatDate(item.modified)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 p-4">
                {filteredItems.map((item) => (
                  <div 
                    key={item.path} 
                    className={`rounded-lg border p-4 hover:bg-muted/50 space-y-2 ${item.type === "directory" ? "cursor-pointer" : ""}`}
                    onClick={() => item.type === "directory" && navigateTo(item.path)}
                  >
                    <div className="flex items-center gap-2">
                      {getFileIcon(item.name, item.type === "directory")}
                      {item.type === "directory" && (
                        <Badge variant="outline" className="text-xs">Folder</Badge>
                      )}
                    </div>
                    <p className="font-medium text-sm line-clamp-2 break-words">{item.name}</p>
                    <div className="text-xs text-muted-foreground">
                      {item.type === "directory" ? "Directory" : formatBytes(item.size)}
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
