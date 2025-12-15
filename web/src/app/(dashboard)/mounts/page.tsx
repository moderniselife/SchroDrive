"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { HardDrive, Play, Square, RefreshCw, FolderOpen, Settings } from "lucide-react"

const mounts = [
  {
    id: "torbox",
    name: "TorBox",
    status: "mounted",
    path: "/mnt/schrodrive/torbox",
    used: 1.2,
    total: 2,
    files: 1234,
  },
  {
    id: "realdebrid",
    name: "Real-Debrid",
    status: "mounted",
    path: "/mnt/schrodrive/realdebrid",
    used: 0.8,
    total: 1,
    files: 567,
  },
]

export default function MountsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Virtual Mounts</h1>
        <p className="text-muted-foreground">Manage WebDAV mount points</p>
      </div>

      <div className="flex gap-2">
        <Button>
          <Play className="mr-2 h-4 w-4" />
          Mount All
        </Button>
        <Button variant="outline">
          <Square className="mr-2 h-4 w-4" />
          Unmount All
        </Button>
        <Button variant="outline">
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {mounts.map((mount) => (
          <Card key={mount.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                    mount.id === "torbox" ? "bg-blue-500/10" : "bg-purple-500/10"
                  }`}>
                    <HardDrive className={`h-5 w-5 ${
                      mount.id === "torbox" ? "text-blue-500" : "text-purple-500"
                    }`} />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{mount.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">{mount.path}</CardDescription>
                  </div>
                </div>
                <Badge variant={mount.status === "mounted" ? "default" : "secondary"}>
                  {mount.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span className="text-muted-foreground">Storage Used</span>
                  <span>{mount.used} / {mount.total} TB</span>
                </div>
                <Progress value={(mount.used / mount.total) * 100} />
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Files: </span>
                <span className="font-medium">{mount.files.toLocaleString()}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1">
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Browse
                </Button>
                <Button variant="outline" size="sm">
                  <Settings className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
