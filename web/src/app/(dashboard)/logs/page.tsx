"use client"

import { useEffect, useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Pause, Play, Download, Trash2, Search, Loader2, Radio } from "lucide-react"
import { toast } from "sonner"

interface LogEntry {
  id: string
  timestamp: string
  level: "info" | "warn" | "error" | "debug"
  service: string
  message: string
}

const levelColors: Record<string, string> = {
  info: "text-blue-400",
  warn: "text-yellow-400",
  error: "text-red-400",
  debug: "text-muted-foreground",
}

const levelBadgeVariants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  info: "default",
  warn: "secondary",
  error: "destructive",
  debug: "outline",
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [isPaused, setIsPaused] = useState(false)
  const [filter, setFilter] = useState("")
  const [levelFilter, setLevelFilter] = useState<string>("all")
  const [isConnected, setIsConnected] = useState(false)
  const [clearing, setClearing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const pausedRef = useRef(false)

  // Keep pausedRef in sync with isPaused state
  useEffect(() => {
    pausedRef.current = isPaused
  }, [isPaused])

  // Connect to SSE stream
  useEffect(() => {
    function connect() {
      const eventSource = new EventSource("/api/logs/stream")
      eventSourceRef.current = eventSource

      eventSource.onopen = () => {
        setIsConnected(true)
        setLoading(false)
      }

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          
          if (data.type === "initial") {
            setLogs(data.logs || [])
          } else if (data.type === "log" && !pausedRef.current) {
            setLogs((prev) => {
              const newLogs = [...prev, data.log]
              // Keep max 500 logs in UI
              if (newLogs.length > 500) {
                return newLogs.slice(-500)
              }
              return newLogs
            })
          } else if (data.type === "error") {
            console.error("Log stream error:", data.error)
          }
        } catch (err) {
          // Ignore parse errors (heartbeats, etc)
        }
      }

      eventSource.onerror = () => {
        setIsConnected(false)
        eventSource.close()
        // Reconnect after 3 seconds
        setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [])

  // Auto-scroll to bottom when new logs arrive (if not paused)
  useEffect(() => {
    if (!isPaused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, isPaused])

  async function handleClear() {
    setClearing(true)
    try {
      const res = await fetch("/api/logs", { method: "DELETE" })
      const data = await res.json()
      if (data.ok) {
        setLogs([])
        toast.success("Logs cleared")
      } else {
        toast.error(data.error || "Failed to clear logs")
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to clear logs")
    } finally {
      setClearing(false)
    }
  }

  function handleDownload() {
    const content = filteredLogs
      .map((log) => `${log.timestamp} [${log.level.toUpperCase()}] [${log.service}] ${log.message}`)
      .join("\n")
    
    const blob = new Blob([content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `schrodrive-logs-${new Date().toISOString().split("T")[0]}.log`
    a.click()
    URL.revokeObjectURL(url)
    toast.success("Logs downloaded")
  }

  // Filter logs
  const filteredLogs = logs.filter((log) => {
    if (levelFilter !== "all" && log.level !== levelFilter) return false
    if (filter) {
      const searchLower = filter.toLowerCase()
      return (
        log.message.toLowerCase().includes(searchLower) ||
        log.service.toLowerCase().includes(searchLower)
      )
    }
    return true
  })

  // Count by level
  const counts = {
    all: logs.length,
    info: logs.filter((l) => l.level === "info").length,
    warn: logs.filter((l) => l.level === "warn").length,
    error: logs.filter((l) => l.level === "error").length,
    debug: logs.filter((l) => l.level === "debug").length,
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Logs</h1>
          <p className="text-muted-foreground">Connecting to log stream...</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-96 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Logs</h1>
          <p className="text-muted-foreground">Real-time system logs</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isConnected ? "default" : "destructive"} className="gap-1">
            <Radio className={`h-3 w-3 ${isConnected ? "animate-pulse" : ""}`} />
            {isConnected ? "Live" : "Disconnected"}
          </Badge>
        </div>
      </div>

      <Card className="flex-1 flex flex-col">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle>System Logs</CardTitle>
            <Badge variant={isPaused ? "secondary" : "default"}>
              {isPaused ? "Paused" : "Streaming"}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-4">
            <div className="flex items-center gap-1">
              <Button
                variant={levelFilter === "all" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setLevelFilter("all")}
              >
                All ({counts.all})
              </Button>
              <Button
                variant={levelFilter === "info" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setLevelFilter("info")}
                className="text-blue-400"
              >
                Info ({counts.info})
              </Button>
              <Button
                variant={levelFilter === "warn" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setLevelFilter("warn")}
                className="text-yellow-400"
              >
                Warn ({counts.warn})
              </Button>
              <Button
                variant={levelFilter === "error" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setLevelFilter("error")}
                className="text-red-400"
              >
                Error ({counts.error})
              </Button>
            </div>
            <div className="flex-1" />
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Filter logs..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button variant="outline" size="icon" onClick={() => setIsPaused(!isPaused)}>
              {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </Button>
            <Button variant="outline" size="icon" onClick={handleDownload}>
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={handleClear} disabled={clearing}>
              {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          <ScrollArea className="h-[500px]" ref={scrollRef}>
            {filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Radio className="h-12 w-12 text-muted-foreground/50" />
                <p className="mt-4 text-lg font-medium">No logs yet</p>
                <p className="text-sm text-muted-foreground">
                  {filter ? "Try a different filter" : "Logs will appear here as events occur"}
                </p>
              </div>
            ) : (
              <div className="bg-black/50 p-4 font-mono text-xs">
                <div className="overflow-x-auto">
                  <div className="min-w-max space-y-0.5">
                    {filteredLogs.map((log) => (
                      <div key={log.id} className="hover:bg-muted/20 px-2 py-0.5 flex items-start gap-2">
                        <span className="text-muted-foreground whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleTimeString("en-US", {
                            hour12: false,
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </span>
                        <span className={`${levelColors[log.level]} whitespace-nowrap`}>
                          [{log.level.toUpperCase().padEnd(5)}]
                        </span>
                        <span className="text-purple-400 whitespace-nowrap">[{log.service}]</span>
                        <span className="whitespace-pre-wrap break-words">{log.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
