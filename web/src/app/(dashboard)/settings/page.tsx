"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { 
  Save, 
  RefreshCw, 
  RotateCcw,
  Search,
  Database,
  HardDrive,
  Server,
  FolderSync,
  Settings,
  Tv,
  AlertTriangle,
  Loader2,
  Cloud,
  FileText,
  CircleDot,
} from "lucide-react"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8978"

interface ConfigValue {
  value: string
  source: "env" | "file" | "default"
  schema: {
    type: string
    default: string
    category: string
    label: string
    options?: string[]
  }
}

type ConfigData = Record<string, ConfigValue>

function SourceBadge({ source }: { source: "env" | "file" | "default" }) {
  if (source === "env") {
    return (
      <Badge variant="default" className="gap-1 text-xs bg-blue-500/20 text-blue-400 border-blue-500/30">
        <Cloud className="h-3 w-3" />
        Container
      </Badge>
    )
  }
  if (source === "file") {
    return (
      <Badge variant="default" className="gap-1 text-xs bg-green-500/20 text-green-400 border-green-500/30">
        <FileText className="h-3 w-3" />
        .env File
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="gap-1 text-xs">
      <CircleDot className="h-3 w-3" />
      Default
    </Badge>
  )
}

function ConfigSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  )
}

interface ConfigFieldProps {
  label: string
  description?: string
  envVar: string
  value: string
  source: "env" | "file" | "default"
  onChange: (value: string) => void
  type?: string
  options?: string[]
}

function ConfigField({ label, description, envVar, value, source, onChange, type = "string", options }: ConfigFieldProps) {
  const isLocked = source === "env"
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <div className="flex items-center gap-2">
          <SourceBadge source={source} />
          <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{envVar}</code>
        </div>
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {type === "select" && options ? (
        <select 
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={isLocked}
          title={isLocked ? "This value is set by container environment variable and cannot be changed here" : undefined}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <Input 
          type={type === "password" ? "password" : type === "number" ? "number" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={isLocked}
          title={isLocked ? "This value is set by container environment variable and cannot be changed here" : undefined}
          className={isLocked ? "opacity-50 cursor-not-allowed" : ""}
        />
      )}
      {isLocked && (
        <p className="text-xs text-blue-400">🔒 Locked: Set by container environment variable</p>
      )}
    </div>
  )
}

interface SwitchFieldProps {
  label: string
  description?: string
  envVar: string
  value: boolean
  source: "env" | "file" | "default"
  onChange: (value: boolean) => void
}

function SwitchField({ label, description, envVar, value, source, onChange }: SwitchFieldProps) {
  const isLocked = source === "env"
  
  return (
    <div className="flex items-center justify-between py-2">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          <SourceBadge source={source} />
          <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{envVar}</code>
        </div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        {isLocked && <p className="text-xs text-blue-400">🔒 Locked: Set by container environment variable</p>}
      </div>
      <Switch 
        checked={value} 
        onCheckedChange={onChange}
        disabled={isLocked}
      />
    </div>
  )
}

export default function SettingsPage() {
  const [config, setConfig] = useState<ConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [envPath, setEnvPath] = useState("")
  const [isDocker, setIsDocker] = useState(false)
  const [changes, setChanges] = useState<Record<string, string>>({})

  useEffect(() => {
    fetchConfig()
  }, [])

  async function fetchConfig() {
    try {
      setLoading(true)
      const res = await fetch(`${API_BASE}/api/config`)
      const data = await res.json()
      if (data.ok) {
        setConfig(data.config)
        setEnvPath(data.envPath)
        setIsDocker(data.isDocker)
        setChanges({})
      } else {
        toast.error("Failed to load config: " + data.error)
      }
    } catch (err: any) {
      toast.error("Failed to connect to backend: " + err.message)
    } finally {
      setLoading(false)
    }
  }

  function getValue(key: string): string {
    if (changes[key] !== undefined) return changes[key]
    return config?.[key]?.value || ""
  }

  function getSource(key: string): "env" | "file" | "default" {
    return config?.[key]?.source || "default"
  }

  function updateValue(key: string, value: string) {
    setChanges((prev) => ({ ...prev, [key]: value }))
  }

  function getBoolValue(key: string): boolean {
    const val = getValue(key)
    return val === "true" || val === "1"
  }

  function updateBoolValue(key: string, value: boolean) {
    updateValue(key, value ? "true" : "false")
  }

  async function handleSave() {
    if (Object.keys(changes).length === 0) {
      toast.info("No changes to save")
      return
    }
    
    try {
      setSaving(true)
      const res = await fetch(`${API_BASE}/api/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: changes }),
      })
      const data = await res.json()
      if (data.ok) {
        toast.success("Configuration saved to " + data.path)
        await fetchConfig()
      } else {
        toast.error("Failed to save: " + data.error)
      }
    } catch (err: any) {
      toast.error("Failed to save: " + err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleRestart() {
    try {
      setRestarting(true)
      const res = await fetch(`${API_BASE}/api/restart`, { method: "POST" })
      const data = await res.json()
      if (data.ok) {
        toast.success(data.message)
      } else {
        toast.error(data.message || "Failed to restart")
      }
    } catch (err: any) {
      toast.error("Failed to restart: " + err.message)
    } finally {
      setRestarting(false)
    }
  }

  function handleReset() {
    setChanges({})
    toast.info("Changes reset")
  }

  const hasChanges = Object.keys(changes).length > 0

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Settings</h1>
            <p className="text-muted-foreground">Loading configuration...</p>
          </div>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Configure your SchröDrive instance</p>
          {envPath && <p className="text-xs text-muted-foreground mt-1">Config file: {envPath}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={handleReset} disabled={!hasChanges}>
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <Button variant="destructive" className="gap-2" onClick={handleRestart} disabled={restarting}>
            {restarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Restart Container
          </Button>
          <Button className="gap-2" onClick={handleSave} disabled={saving || !hasChanges}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Changes {hasChanges && `(${Object.keys(changes).length})`}
          </Button>
        </div>
      </div>

      <Card className="border-yellow-500/50 bg-yellow-500/5">
        <CardContent className="flex items-center gap-3 py-3">
          <AlertTriangle className="h-5 w-5 text-yellow-500" />
          <div className="flex-1">
            <p className="text-sm">Some settings require a container restart to take effect.</p>
            <p className="text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Cloud className="h-3 w-3 text-blue-400" /> Container</span> values are set via Docker/environment and cannot be changed here.
            </p>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:grid-cols-9">
          <TabsTrigger value="general" className="gap-2"><Settings className="h-4 w-4 hidden sm:block" />General</TabsTrigger>
          <TabsTrigger value="indexers" className="gap-2"><Search className="h-4 w-4 hidden sm:block" />Indexers</TabsTrigger>
          <TabsTrigger value="torbox" className="gap-2"><Database className="h-4 w-4 hidden sm:block" />TorBox</TabsTrigger>
          <TabsTrigger value="realdebrid" className="gap-2"><Database className="h-4 w-4 hidden sm:block" />Real-Debrid</TabsTrigger>
          <TabsTrigger value="overseerr" className="gap-2"><Tv className="h-4 w-4 hidden sm:block" />Overseerr</TabsTrigger>
          <TabsTrigger value="mounts" className="gap-2"><HardDrive className="h-4 w-4 hidden sm:block" />Mounts</TabsTrigger>
          <TabsTrigger value="services" className="gap-2"><Server className="h-4 w-4 hidden sm:block" />Services</TabsTrigger>
          <TabsTrigger value="organizer" className="gap-2"><FolderSync className="h-4 w-4 hidden sm:block" />Organizer</TabsTrigger>
          <TabsTrigger value="updates" className="gap-2"><RefreshCw className="h-4 w-4 hidden sm:block" />Updates</TabsTrigger>
        </TabsList>

        {/* General Settings */}
        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>General Settings</CardTitle>
              <CardDescription>Core application configuration</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <ConfigField label="Server Port" envVar="PORT" description="Port for the webhook server" value={getValue("PORT")} source={getSource("PORT")} onChange={(v) => updateValue("PORT", v)} type="number" />
                <ConfigField label="Active Providers" envVar="PROVIDERS" description="Comma-separated: torbox,realdebrid" value={getValue("PROVIDERS")} source={getSource("PROVIDERS")} onChange={(v) => updateValue("PROVIDERS", v)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Indexers Tab */}
        <TabsContent value="indexers" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Indexer Provider Selection</CardTitle>
              <CardDescription>Choose which indexer to use for torrent searches</CardDescription>
            </CardHeader>
            <CardContent>
              <ConfigField label="Indexer Provider" envVar="INDEXER_PROVIDER" description="auto = Jackett if configured, else Prowlarr" value={getValue("INDEXER_PROVIDER")} source={getSource("INDEXER_PROVIDER")} onChange={(v) => updateValue("INDEXER_PROVIDER", v)} type="select" options={["auto", "jackett", "prowlarr"]} />
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Jackett</CardTitle>
                    <CardDescription>Jackett indexer configuration</CardDescription>
                  </div>
                  <Badge variant="outline">Recommended</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <ConfigField label="Jackett URL" envVar="JACKETT_URL" value={getValue("JACKETT_URL")} source={getSource("JACKETT_URL")} onChange={(v) => updateValue("JACKETT_URL", v)} />
                <ConfigField label="API Key" envVar="JACKETT_API_KEY" type="password" value={getValue("JACKETT_API_KEY")} source={getSource("JACKETT_API_KEY")} onChange={(v) => updateValue("JACKETT_API_KEY", v)} />
                <ConfigField label="Categories" envVar="JACKETT_CATEGORIES" description="Comma-separated category IDs" value={getValue("JACKETT_CATEGORIES")} source={getSource("JACKETT_CATEGORIES")} onChange={(v) => updateValue("JACKETT_CATEGORIES", v)} />
                <ConfigField label="Indexer IDs" envVar="JACKETT_INDEXER_IDS" description="Limit to specific indexers" value={getValue("JACKETT_INDEXER_IDS")} source={getSource("JACKETT_INDEXER_IDS")} onChange={(v) => updateValue("JACKETT_INDEXER_IDS", v)} />
                <div className="grid grid-cols-2 gap-4">
                  <ConfigField label="Search Limit" envVar="JACKETT_SEARCH_LIMIT" type="number" value={getValue("JACKETT_SEARCH_LIMIT")} source={getSource("JACKETT_SEARCH_LIMIT")} onChange={(v) => updateValue("JACKETT_SEARCH_LIMIT", v)} />
                  <ConfigField label="Timeout (ms)" envVar="JACKETT_TIMEOUT_MS" type="number" value={getValue("JACKETT_TIMEOUT_MS")} source={getSource("JACKETT_TIMEOUT_MS")} onChange={(v) => updateValue("JACKETT_TIMEOUT_MS", v)} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Prowlarr</CardTitle>
                <CardDescription>Prowlarr indexer configuration</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ConfigField label="Prowlarr URL" envVar="PROWLARR_URL" value={getValue("PROWLARR_URL")} source={getSource("PROWLARR_URL")} onChange={(v) => updateValue("PROWLARR_URL", v)} />
                <ConfigField label="API Key" envVar="PROWLARR_API_KEY" type="password" value={getValue("PROWLARR_API_KEY")} source={getSource("PROWLARR_API_KEY")} onChange={(v) => updateValue("PROWLARR_API_KEY", v)} />
                <ConfigField label="Categories" envVar="PROWLARR_CATEGORIES" description="Comma-separated category IDs" value={getValue("PROWLARR_CATEGORIES")} source={getSource("PROWLARR_CATEGORIES")} onChange={(v) => updateValue("PROWLARR_CATEGORIES", v)} />
                <ConfigField label="Indexer IDs" envVar="PROWLARR_INDEXER_IDS" description="Limit to specific indexers" value={getValue("PROWLARR_INDEXER_IDS")} source={getSource("PROWLARR_INDEXER_IDS")} onChange={(v) => updateValue("PROWLARR_INDEXER_IDS", v)} />
                <div className="grid grid-cols-2 gap-4">
                  <ConfigField label="Search Limit" envVar="PROWLARR_SEARCH_LIMIT" type="number" value={getValue("PROWLARR_SEARCH_LIMIT")} source={getSource("PROWLARR_SEARCH_LIMIT")} onChange={(v) => updateValue("PROWLARR_SEARCH_LIMIT", v)} />
                  <ConfigField label="Timeout (ms)" envVar="PROWLARR_TIMEOUT_MS" type="number" value={getValue("PROWLARR_TIMEOUT_MS")} source={getSource("PROWLARR_TIMEOUT_MS")} onChange={(v) => updateValue("PROWLARR_TIMEOUT_MS", v)} />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TorBox Tab */}
        <TabsContent value="torbox" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>TorBox API</CardTitle>
                <CardDescription>TorBox debrid service configuration</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ConfigField label="API Key" envVar="TORBOX_API_KEY" description="Your TorBox API key (starts with tb_)" type="password" value={getValue("TORBOX_API_KEY")} source={getSource("TORBOX_API_KEY")} onChange={(v) => updateValue("TORBOX_API_KEY", v)} />
                <ConfigField label="Base URL" envVar="TORBOX_BASE_URL" value={getValue("TORBOX_BASE_URL")} source={getSource("TORBOX_BASE_URL")} onChange={(v) => updateValue("TORBOX_BASE_URL", v)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>TorBox WebDAV</CardTitle>
                <CardDescription>WebDAV mount credentials for TorBox</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ConfigField label="WebDAV URL" envVar="TORBOX_WEBDAV_URL" value={getValue("TORBOX_WEBDAV_URL")} source={getSource("TORBOX_WEBDAV_URL")} onChange={(v) => updateValue("TORBOX_WEBDAV_URL", v)} />
                <ConfigField label="Username" envVar="TORBOX_WEBDAV_USERNAME" description="Usually your email" value={getValue("TORBOX_WEBDAV_USERNAME")} source={getSource("TORBOX_WEBDAV_USERNAME")} onChange={(v) => updateValue("TORBOX_WEBDAV_USERNAME", v)} />
                <ConfigField label="Password" envVar="TORBOX_WEBDAV_PASSWORD" type="password" value={getValue("TORBOX_WEBDAV_PASSWORD")} source={getSource("TORBOX_WEBDAV_PASSWORD")} onChange={(v) => updateValue("TORBOX_WEBDAV_PASSWORD", v)} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Real-Debrid Tab */}
        <TabsContent value="realdebrid" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Real-Debrid API</CardTitle>
                <CardDescription>Real-Debrid debrid service configuration</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ConfigField label="Access Token" envVar="RD_ACCESS_TOKEN" description="Your Real-Debrid API token" type="password" value={getValue("RD_ACCESS_TOKEN")} source={getSource("RD_ACCESS_TOKEN")} onChange={(v) => updateValue("RD_ACCESS_TOKEN", v)} />
                <ConfigField label="API Base URL" envVar="RD_API_BASE" value={getValue("RD_API_BASE")} source={getSource("RD_API_BASE")} onChange={(v) => updateValue("RD_API_BASE", v)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Real-Debrid WebDAV</CardTitle>
                <CardDescription>WebDAV mount credentials for Real-Debrid</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ConfigField label="WebDAV URL" envVar="RD_WEBDAV_URL" value={getValue("RD_WEBDAV_URL")} source={getSource("RD_WEBDAV_URL")} onChange={(v) => updateValue("RD_WEBDAV_URL", v)} />
                <ConfigField label="Username" envVar="RD_WEBDAV_USERNAME" value={getValue("RD_WEBDAV_USERNAME")} source={getSource("RD_WEBDAV_USERNAME")} onChange={(v) => updateValue("RD_WEBDAV_USERNAME", v)} />
                <ConfigField label="Password" envVar="RD_WEBDAV_PASSWORD" type="password" value={getValue("RD_WEBDAV_PASSWORD")} source={getSource("RD_WEBDAV_PASSWORD")} onChange={(v) => updateValue("RD_WEBDAV_PASSWORD", v)} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Overseerr Tab */}
        <TabsContent value="overseerr" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Overseerr Configuration</CardTitle>
              <CardDescription>Connect to your Overseerr instance for media requests</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <ConfigField label="Overseerr URL" envVar="OVERSEERR_URL" description="Must include /api/v1" value={getValue("OVERSEERR_URL")} source={getSource("OVERSEERR_URL")} onChange={(v) => updateValue("OVERSEERR_URL", v)} />
                <ConfigField label="API Key" envVar="OVERSEERR_API_KEY" type="password" value={getValue("OVERSEERR_API_KEY")} source={getSource("OVERSEERR_API_KEY")} onChange={(v) => updateValue("OVERSEERR_API_KEY", v)} />
              </div>
              <Separator />
              <ConfigSection title="Webhook Authentication" description="Optional security for incoming webhooks">
                <ConfigField label="Webhook Auth Header" envVar="OVERSEERR_AUTH" description="Authorization header value to require" type="password" value={getValue("OVERSEERR_AUTH")} source={getSource("OVERSEERR_AUTH")} onChange={(v) => updateValue("OVERSEERR_AUTH", v)} />
              </ConfigSection>
              <Separator />
              <ConfigSection title="Poller Settings" description="Poll Overseerr for approved requests">
                <ConfigField label="Poll Interval (seconds)" envVar="POLL_INTERVAL_S" type="number" value={getValue("POLL_INTERVAL_S")} source={getSource("POLL_INTERVAL_S")} onChange={(v) => updateValue("POLL_INTERVAL_S", v)} />
              </ConfigSection>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Mounts Tab */}
        <TabsContent value="mounts" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Mount Configuration</CardTitle>
              <CardDescription>WebDAV mount settings via rclone</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <ConfigField label="Mount Base Path" envVar="MOUNT_BASE" description="Base directory for all mounts" value={getValue("MOUNT_BASE")} source={getSource("MOUNT_BASE")} onChange={(v) => updateValue("MOUNT_BASE", v)} />
                <ConfigField label="Rclone Path" envVar="RCLONE_PATH" description="Path to rclone binary" value={getValue("RCLONE_PATH")} source={getSource("RCLONE_PATH")} onChange={(v) => updateValue("RCLONE_PATH", v)} />
              </div>
              
              <Separator />
              <ConfigSection title="Cache Settings" description="Rclone cache configuration">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <ConfigField label="VFS Cache Mode" envVar="MOUNT_VFS_CACHE_MODE" type="select" options={["off", "minimal", "writes", "full"]} value={getValue("MOUNT_VFS_CACHE_MODE")} source={getSource("MOUNT_VFS_CACHE_MODE")} onChange={(v) => updateValue("MOUNT_VFS_CACHE_MODE", v)} />
                  <ConfigField label="Dir Cache Time" envVar="MOUNT_DIR_CACHE_TIME" value={getValue("MOUNT_DIR_CACHE_TIME")} source={getSource("MOUNT_DIR_CACHE_TIME")} onChange={(v) => updateValue("MOUNT_DIR_CACHE_TIME", v)} />
                  <ConfigField label="Poll Interval" envVar="MOUNT_POLL_INTERVAL" value={getValue("MOUNT_POLL_INTERVAL")} source={getSource("MOUNT_POLL_INTERVAL")} onChange={(v) => updateValue("MOUNT_POLL_INTERVAL", v)} />
                  <ConfigField label="Buffer Size" envVar="MOUNT_BUFFER_SIZE" value={getValue("MOUNT_BUFFER_SIZE")} source={getSource("MOUNT_BUFFER_SIZE")} onChange={(v) => updateValue("MOUNT_BUFFER_SIZE", v)} />
                </div>
              </ConfigSection>

              <Separator />
              <ConfigSection title="Permissions" description="Mount file/directory permissions">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <ConfigField label="UID" envVar="MOUNT_UID" type="number" value={getValue("MOUNT_UID")} source={getSource("MOUNT_UID")} onChange={(v) => updateValue("MOUNT_UID", v)} />
                  <ConfigField label="GID" envVar="MOUNT_GID" type="number" value={getValue("MOUNT_GID")} source={getSource("MOUNT_GID")} onChange={(v) => updateValue("MOUNT_GID", v)} />
                  <ConfigField label="Dir Perms" envVar="MOUNT_DIR_PERMS" value={getValue("MOUNT_DIR_PERMS")} source={getSource("MOUNT_DIR_PERMS")} onChange={(v) => updateValue("MOUNT_DIR_PERMS", v)} />
                  <ConfigField label="File Perms" envVar="MOUNT_FILE_PERMS" value={getValue("MOUNT_FILE_PERMS")} source={getSource("MOUNT_FILE_PERMS")} onChange={(v) => updateValue("MOUNT_FILE_PERMS", v)} />
                </div>
                <SwitchField label="Allow Other" envVar="MOUNT_ALLOW_OTHER" description="Allow other users to access the mount" value={getBoolValue("MOUNT_ALLOW_OTHER")} source={getSource("MOUNT_ALLOW_OTHER")} onChange={(v) => updateBoolValue("MOUNT_ALLOW_OTHER", v)} />
              </ConfigSection>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Services Tab */}
        <TabsContent value="services" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Runtime Services</CardTitle>
              <CardDescription>Enable or disable background services (requires restart)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <SwitchField label="Webhook Server" envVar="RUN_WEBHOOK" description="Listen for Overseerr webhook notifications" value={getBoolValue("RUN_WEBHOOK")} source={getSource("RUN_WEBHOOK")} onChange={(v) => updateBoolValue("RUN_WEBHOOK", v)} />
              <Separator />
              <SwitchField label="Overseerr Poller" envVar="RUN_POLLER" description="Poll Overseerr API for approved requests" value={getBoolValue("RUN_POLLER")} source={getSource("RUN_POLLER")} onChange={(v) => updateBoolValue("RUN_POLLER", v)} />
              <Separator />
              <SwitchField label="Auto-Mount WebDAV" envVar="RUN_MOUNT" description="Automatically mount WebDAV drives on startup" value={getBoolValue("RUN_MOUNT")} source={getSource("RUN_MOUNT")} onChange={(v) => updateBoolValue("RUN_MOUNT", v)} />
              <Separator />
              <SwitchField label="Dead Scanner" envVar="RUN_DEAD_SCANNER" description="Scan for dead/stalled torrents" value={getBoolValue("RUN_DEAD_SCANNER")} source={getSource("RUN_DEAD_SCANNER")} onChange={(v) => updateBoolValue("RUN_DEAD_SCANNER", v)} />
              <Separator />
              <SwitchField label="Dead Scanner Watch Mode" envVar="RUN_DEAD_SCANNER_WATCH" description="Run dead scanner continuously" value={getBoolValue("RUN_DEAD_SCANNER_WATCH")} source={getSource("RUN_DEAD_SCANNER_WATCH")} onChange={(v) => updateBoolValue("RUN_DEAD_SCANNER_WATCH", v)} />
              <Separator />
              <SwitchField label="Organizer Watch Mode" envVar="RUN_ORGANIZER_WATCH" description="Run media organizer continuously" value={getBoolValue("RUN_ORGANIZER_WATCH")} source={getSource("RUN_ORGANIZER_WATCH")} onChange={(v) => updateBoolValue("RUN_ORGANIZER_WATCH", v)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dead Scanner Settings</CardTitle>
              <CardDescription>Configure dead torrent detection</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-6 md:grid-cols-2">
                <ConfigField label="Scan Interval (seconds)" envVar="DEAD_SCAN_INTERVAL_S" description="How often to scan for dead torrents" type="number" value={getValue("DEAD_SCAN_INTERVAL_S")} source={getSource("DEAD_SCAN_INTERVAL_S")} onChange={(v) => updateValue("DEAD_SCAN_INTERVAL_S", v)} />
                <ConfigField label="Idle Threshold (minutes)" envVar="DEAD_IDLE_MIN" description="Consider torrent dead after this idle time" type="number" value={getValue("DEAD_IDLE_MIN")} source={getSource("DEAD_IDLE_MIN")} onChange={(v) => updateValue("DEAD_IDLE_MIN", v)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Organizer Tab */}
        <TabsContent value="organizer" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Media Organizer</CardTitle>
              <CardDescription>Organize media with symlinks and metadata from TMDB/TVMaze</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <ConfigField label="TMDB API Key" envVar="TMDB_API_KEY" description="Optional - falls back to TVMaze/iTunes" type="password" value={getValue("TMDB_API_KEY")} source={getSource("TMDB_API_KEY")} onChange={(v) => updateValue("TMDB_API_KEY", v)} />
                <ConfigField label="Organized Base Path" envVar="ORGANIZED_BASE" description="Where to create organized structure" value={getValue("ORGANIZED_BASE")} source={getSource("ORGANIZED_BASE")} onChange={(v) => updateValue("ORGANIZED_BASE", v)} />
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <ConfigField label="Organizer Mode" envVar="ORGANIZER_MODE" type="select" options={["symlink", "copy", "move"]} value={getValue("ORGANIZER_MODE")} source={getSource("ORGANIZER_MODE")} onChange={(v) => updateValue("ORGANIZER_MODE", v)} />
                <ConfigField label="Scan Interval (seconds)" envVar="ORG_SCAN_INTERVAL_S" description="How often to scan for new media" type="number" value={getValue("ORG_SCAN_INTERVAL_S")} source={getSource("ORG_SCAN_INTERVAL_S")} onChange={(v) => updateValue("ORG_SCAN_INTERVAL_S", v)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Auto-Update Tab */}
        <TabsContent value="updates" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Auto-Update Configuration</CardTitle>
              <CardDescription>Automatically check for and apply updates from GitHub</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <SwitchField label="Enable Auto-Update" envVar="AUTO_UPDATE_ENABLED" description="Check GitHub for new releases" value={getBoolValue("AUTO_UPDATE_ENABLED")} source={getSource("AUTO_UPDATE_ENABLED")} onChange={(v) => updateBoolValue("AUTO_UPDATE_ENABLED", v)} />
              <Separator />
              <div className="grid gap-6 md:grid-cols-2">
                <ConfigField label="Check Interval (seconds)" envVar="AUTO_UPDATE_INTERVAL_S" type="number" value={getValue("AUTO_UPDATE_INTERVAL_S")} source={getSource("AUTO_UPDATE_INTERVAL_S")} onChange={(v) => updateValue("AUTO_UPDATE_INTERVAL_S", v)} />
                <ConfigField label="Update Strategy" envVar="AUTO_UPDATE_STRATEGY" description="How to handle updates" type="select" options={["exit", "git"]} value={getValue("AUTO_UPDATE_STRATEGY")} source={getSource("AUTO_UPDATE_STRATEGY")} onChange={(v) => updateValue("AUTO_UPDATE_STRATEGY", v)} />
              </div>
              <Separator />
              <ConfigSection title="Repository" description="GitHub repository to check for updates">
                <div className="grid gap-6 md:grid-cols-2">
                  <ConfigField label="Repo Owner" envVar="REPO_OWNER" value={getValue("REPO_OWNER")} source={getSource("REPO_OWNER")} onChange={(v) => updateValue("REPO_OWNER", v)} />
                  <ConfigField label="Repo Name" envVar="REPO_NAME" value={getValue("REPO_NAME")} source={getSource("REPO_NAME")} onChange={(v) => updateValue("REPO_NAME", v)} />
                </div>
              </ConfigSection>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Sticky Save Bar */}
      {hasChanges && (
        <div className="sticky bottom-0 -mx-6 -mb-6 bg-background/95 backdrop-blur border-t p-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{Object.keys(changes).length} unsaved change(s)</p>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={handleReset}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
            <Button className="gap-2" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Changes
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
