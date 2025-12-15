"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Download, CheckCircle2, Clock, XCircle, Pause, Trash2, RefreshCw } from "lucide-react"

function formatBytes(bytes: number) {
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

const transfers = [
  { id: 1, title: "Movie.Name.2024.1080p.BluRay.x264", status: "downloading", progress: 67, size: 8500000000, speed: "12.5 MB/s", eta: "4m 32s", provider: "TorBox" },
  { id: 2, title: "TV.Show.S01E05.1080p.WEB-DL", status: "downloading", progress: 23, size: 1200000000, speed: "8.2 MB/s", eta: "1m 52s", provider: "Real-Debrid" },
  { id: 3, title: "Documentary.2023.2160p.WEB-DL", status: "queued", progress: 0, size: 12000000000, provider: "TorBox" },
  { id: 4, title: "Movie.Classic.1995.1080p.BluRay", status: "completed", progress: 100, size: 6000000000, provider: "Real-Debrid", completedAt: "2 min ago" },
  { id: 5, title: "Anime.EP01-12.1080p", status: "failed", progress: 45, size: 8000000000, provider: "TorBox", error: "No seeders" },
]

const statusIcons: Record<string, React.ReactNode> = {
  downloading: <Download className="h-4 w-4 text-blue-500 animate-pulse" />,
  completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  queued: <Clock className="h-4 w-4 text-yellow-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
}

export default function ActivityPage() {
  const activeCount = transfers.filter((t) => t.status === "downloading").length
  const queuedCount = transfers.filter((t) => t.status === "queued").length
  const completedCount = transfers.filter((t) => t.status === "completed").length

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div>
        <h1 className="text-2xl font-bold">Activity</h1>
        <p className="text-muted-foreground">Monitor downloads and transfers</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
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
                <p className="text-sm text-muted-foreground">Queued</p>
                <p className="text-2xl font-bold">{queuedCount}</p>
              </div>
              <Clock className="h-8 w-8 text-yellow-500" />
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
              <CheckCircle2 className="h-8 w-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Speed</p>
                <p className="text-2xl font-bold">20.7 MB/s</p>
              </div>
              <Download className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="flex-1">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Transfers</CardTitle>
              <CardDescription>All active and recent transfers</CardDescription>
            </div>
            <Button variant="outline" size="sm"><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            <div className="space-y-4">
              {transfers.map((transfer) => (
                <div key={transfer.id} className="rounded-lg border p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      {statusIcons[transfer.status]}
                      <div>
                        <p className="font-medium leading-none">{transfer.title}</p>
                        <div className="flex gap-2 mt-1">
                          <Badge variant="outline">{transfer.provider}</Badge>
                          <span className="text-xs text-muted-foreground">{formatBytes(transfer.size)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {transfer.status === "downloading" && (
                        <Button variant="ghost" size="icon" className="h-8 w-8"><Pause className="h-4 w-4" /></Button>
                      )}
                      {transfer.status === "failed" && (
                        <Button variant="ghost" size="icon" className="h-8 w-8"><RefreshCw className="h-4 w-4" /></Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  {(transfer.status === "downloading" || transfer.status === "failed") && (
                    <div className="space-y-1">
                      <Progress value={transfer.progress} />
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{transfer.progress}%</span>
                        {transfer.speed && <span>{transfer.speed}</span>}
                        {transfer.eta && <span>ETA: {transfer.eta}</span>}
                        {transfer.error && <span className="text-red-500">{transfer.error}</span>}
                      </div>
                    </div>
                  )}
                  {transfer.status === "completed" && (
                    <p className="text-xs text-muted-foreground">Completed {transfer.completedAt}</p>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
