"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Pause, Play, Download, Trash2, Search } from "lucide-react"

const mockLogs = [
  { id: 1, timestamp: "07:45:23.123", level: "info", service: "webhook", message: "hit /webhook/overseerr" },
  { id: 2, timestamp: "07:45:23.456", level: "info", service: "jackett", message: "searching query=\"Movie Name 2024\"" },
  { id: 3, timestamp: "07:45:24.789", level: "info", service: "jackett", message: "results count=45 ms=1332" },
  { id: 4, timestamp: "07:45:24.890", level: "info", service: "torbox", message: "adding magnet title=\"Movie.Name.2024.1080p\"" },
  { id: 5, timestamp: "07:44:00.000", level: "warn", service: "dead-scan", message: "torrent stalled for >2h" },
  { id: 6, timestamp: "07:43:00.000", level: "error", service: "mount", message: "rclone mount failed" },
]

export default function LogsPage() {
  const [isPaused, setIsPaused] = useState(false)
  const [filter, setFilter] = useState("")

  const levelColors: Record<string, string> = {
    info: "text-blue-400",
    warn: "text-yellow-400",
    error: "text-red-400",
    debug: "text-muted-foreground",
  }

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div>
        <h1 className="text-2xl font-bold">Logs</h1>
        <p className="text-muted-foreground">Real-time system logs</p>
      </div>

      <Card className="flex-1 flex flex-col">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle>System Logs</CardTitle>
            <Badge variant={isPaused ? "secondary" : "default"}>
              {isPaused ? "Paused" : "Live"}
            </Badge>
          </div>
          <div className="flex items-center gap-2 pt-4">
            <div className="relative flex-1">
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
            <Button variant="outline" size="icon">
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          <ScrollArea className="h-[500px]">
            <div className="bg-black/50 p-4 font-mono text-xs space-y-1">
              {mockLogs.map((log) => (
                <div key={log.id} className="hover:bg-muted/20 px-2 py-0.5">
                  <span className="text-muted-foreground">{log.timestamp}</span>
                  <span className={`ml-2 ${levelColors[log.level]}`}>
                    [{log.level.toUpperCase().padEnd(5)}]
                  </span>
                  <span className="ml-2 text-purple-400">[{log.service}]</span>
                  <span className="ml-2">{log.message}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
