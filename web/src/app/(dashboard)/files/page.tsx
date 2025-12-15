"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Folder, Film, Tv, ChevronRight, Search, Grid, List, Trash2, Download, MoreVertical } from "lucide-react"

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

const mockFiles = [
  { id: 1, name: "Movies", type: "folder", items: 234, provider: "torbox" },
  { id: 2, name: "TV Shows", type: "folder", items: 156, provider: "torbox" },
  { id: 3, name: "Movie.Name.2024.1080p.BluRay.x264", type: "file", size: 8500000000, provider: "torbox" },
  { id: 4, name: "TV.Show.S01E01-E10.1080p.WEB-DL", type: "file", size: 15000000000, provider: "realdebrid" },
]

export default function FilesPage() {
  const [view, setView] = useState<"grid" | "list">("list")

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div>
        <h1 className="text-2xl font-bold">Browse Files</h1>
        <p className="text-muted-foreground">Browse your debrid library</p>
      </div>

      <Card className="flex-1 flex flex-col">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm">Root</Button>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <Button variant="ghost" size="sm">TorBox</Button>
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
            <Input placeholder="Search files..." className="pl-9" />
          </div>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          <ScrollArea className="h-[500px]">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-4 font-medium">Name</th>
                  <th className="p-4 font-medium">Size</th>
                  <th className="p-4 font-medium">Provider</th>
                  <th className="p-4 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {mockFiles.map((file) => (
                  <tr key={file.id} className="border-b hover:bg-muted/50">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        {file.type === "folder" ? (
                          <Folder className="h-5 w-5 text-blue-500" />
                        ) : file.name.toLowerCase().includes("movie") ? (
                          <Film className="h-5 w-5 text-purple-500" />
                        ) : (
                          <Tv className="h-5 w-5 text-green-500" />
                        )}
                        <span className="font-medium">{file.name}</span>
                      </div>
                    </td>
                    <td className="p-4 text-sm text-muted-foreground">
                      {file.type === "folder" ? `${file.items} items` : formatBytes(file.size || 0)}
                    </td>
                    <td className="p-4">
                      <Badge variant="outline" className="capitalize">{file.provider}</Badge>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
