"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Pause, Play, Search, Terminal, AlertCircle } from "lucide-react"

export default function LogsPage() {
  const [isPaused, setIsPaused] = useState(false)
  const [filter, setFilter] = useState("")

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div>
        <h1 className="text-2xl font-bold">Logs</h1>
        <p className="text-muted-foreground">System logs viewer</p>
      </div>

      <Card className="border-yellow-500/50 bg-yellow-500/5">
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-500" />
            <div>
              <p className="font-medium">Log streaming not yet implemented</p>
              <p className="text-sm text-muted-foreground">
                View logs directly from Docker: <code className="bg-muted px-1 rounded">docker logs -f schrodrive</code>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="flex-1 flex flex-col">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle>System Logs</CardTitle>
            <Badge variant={isPaused ? "secondary" : "outline"}>
              {isPaused ? "Paused" : "Waiting"}
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
                disabled
              />
            </div>
            <Button variant="outline" size="icon" onClick={() => setIsPaused(!isPaused)} disabled>
              {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          <ScrollArea className="h-[400px]">
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Terminal className="h-12 w-12 text-muted-foreground/50" />
              <p className="mt-4 text-lg font-medium">No logs available</p>
              <p className="text-sm text-muted-foreground max-w-md">
                Log streaming will be available in a future update. For now, use Docker logs or check the console output.
              </p>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
