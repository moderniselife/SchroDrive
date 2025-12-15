"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
} from "lucide-react"

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

function ConfigField({ label, description, envVar, children }: { label: string; description?: string; envVar: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{envVar}</code>
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {children}
    </div>
  )
}

function SwitchField({ label, description, envVar, defaultChecked }: { label: string; description?: string; envVar: string; defaultChecked?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{envVar}</code>
        </div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch defaultChecked={defaultChecked} />
    </div>
  )
}

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Configure your SchröDrive instance</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Reset to Defaults
          </Button>
          <Button variant="destructive" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Restart Container
          </Button>
          <Button className="gap-2">
            <Save className="h-4 w-4" />
            Save Changes
          </Button>
        </div>
      </div>

      <Card className="border-yellow-500/50 bg-yellow-500/5">
        <CardContent className="flex items-center gap-3 py-3">
          <AlertTriangle className="h-5 w-5 text-yellow-500" />
          <p className="text-sm">Some settings require a container restart to take effect. Click &quot;Restart Container&quot; after saving.</p>
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
                <ConfigField label="Server Port" envVar="PORT" description="Port for the webhook server">
                  <Input type="number" placeholder="8978" defaultValue="8978" />
                </ConfigField>
                <ConfigField label="Active Providers" envVar="PROVIDERS" description="Comma-separated list: torbox,realdebrid">
                  <Input placeholder="torbox,realdebrid" defaultValue="torbox,realdebrid" />
                </ConfigField>
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
              <ConfigField label="Indexer Provider" envVar="INDEXER_PROVIDER" description="auto = Jackett if configured, else Prowlarr">
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" defaultValue="auto">
                  <option value="auto">Auto-detect</option>
                  <option value="jackett">Jackett</option>
                  <option value="prowlarr">Prowlarr</option>
                </select>
              </ConfigField>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Jackett */}
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
                <ConfigField label="Jackett URL" envVar="JACKETT_URL">
                  <Input placeholder="http://localhost:9117" />
                </ConfigField>
                <ConfigField label="API Key" envVar="JACKETT_API_KEY">
                  <Input type="password" placeholder="Your Jackett API key" />
                </ConfigField>
                <ConfigField label="Categories" envVar="JACKETT_CATEGORIES" description="Comma-separated category IDs">
                  <Input placeholder="5000,2000" />
                </ConfigField>
                <ConfigField label="Indexer IDs" envVar="JACKETT_INDEXER_IDS" description="Limit to specific indexers (optional)">
                  <Input placeholder="Leave empty for all" />
                </ConfigField>
                <div className="grid grid-cols-2 gap-4">
                  <ConfigField label="Search Limit" envVar="JACKETT_SEARCH_LIMIT">
                    <Input type="number" placeholder="100" defaultValue="100" />
                  </ConfigField>
                  <ConfigField label="Timeout (ms)" envVar="JACKETT_TIMEOUT_MS">
                    <Input type="number" placeholder="120000" defaultValue="120000" />
                  </ConfigField>
                </div>
                <ConfigField label="Max Redirect Hops" envVar="JACKETT_REDIRECT_MAX_HOPS">
                  <Input type="number" placeholder="5" defaultValue="5" />
                </ConfigField>
              </CardContent>
            </Card>

            {/* Prowlarr */}
            <Card>
              <CardHeader>
                <CardTitle>Prowlarr</CardTitle>
                <CardDescription>Prowlarr indexer configuration</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ConfigField label="Prowlarr URL" envVar="PROWLARR_URL">
                  <Input placeholder="http://localhost:9696" />
                </ConfigField>
                <ConfigField label="API Key" envVar="PROWLARR_API_KEY">
                  <Input type="password" placeholder="Your Prowlarr API key" />
                </ConfigField>
                <ConfigField label="Categories" envVar="PROWLARR_CATEGORIES" description="Comma-separated category IDs">
                  <Input placeholder="5000,2000" />
                </ConfigField>
                <ConfigField label="Indexer IDs" envVar="PROWLARR_INDEXER_IDS" description="Limit to specific indexers (optional)">
                  <Input placeholder="Leave empty for all" />
                </ConfigField>
                <div className="grid grid-cols-2 gap-4">
                  <ConfigField label="Search Limit" envVar="PROWLARR_SEARCH_LIMIT">
                    <Input type="number" placeholder="100" defaultValue="100" />
                  </ConfigField>
                  <ConfigField label="Timeout (ms)" envVar="PROWLARR_TIMEOUT_MS">
                    <Input type="number" placeholder="120000" defaultValue="120000" />
                  </ConfigField>
                </div>
                <ConfigField label="Max Redirect Hops" envVar="PROWLARR_REDIRECT_MAX_HOPS">
                  <Input type="number" placeholder="5" defaultValue="5" />
                </ConfigField>
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
                <ConfigField label="API Key" envVar="TORBOX_API_KEY" description="Your TorBox API key (starts with tb_)">
                  <Input type="password" placeholder="tb_xxxxxxxxxxxx" />
                </ConfigField>
                <ConfigField label="Base URL" envVar="TORBOX_BASE_URL">
                  <Input placeholder="https://api.torbox.app" defaultValue="https://api.torbox.app" />
                </ConfigField>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>TorBox WebDAV</CardTitle>
                <CardDescription>WebDAV mount credentials for TorBox</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ConfigField label="WebDAV URL" envVar="TORBOX_WEBDAV_URL">
                  <Input placeholder="https://webdav.torbox.app" defaultValue="https://webdav.torbox.app" />
                </ConfigField>
                <ConfigField label="Username" envVar="TORBOX_WEBDAV_USERNAME" description="Usually your email">
                  <Input placeholder="email@example.com" />
                </ConfigField>
                <ConfigField label="Password" envVar="TORBOX_WEBDAV_PASSWORD">
                  <Input type="password" placeholder="WebDAV password" />
                </ConfigField>
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
                <ConfigField label="Access Token" envVar="RD_ACCESS_TOKEN" description="Your Real-Debrid API token">
                  <Input type="password" placeholder="Real-Debrid access token" />
                </ConfigField>
                <ConfigField label="API Base URL" envVar="RD_API_BASE">
                  <Input placeholder="https://api.real-debrid.com/rest/1.0" defaultValue="https://api.real-debrid.com/rest/1.0" />
                </ConfigField>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Real-Debrid WebDAV</CardTitle>
                <CardDescription>WebDAV mount credentials for Real-Debrid</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ConfigField label="WebDAV URL" envVar="RD_WEBDAV_URL">
                  <Input placeholder="https://dav.real-debrid.com" defaultValue="https://dav.real-debrid.com" />
                </ConfigField>
                <ConfigField label="Username" envVar="RD_WEBDAV_USERNAME">
                  <Input placeholder="username" />
                </ConfigField>
                <ConfigField label="Password" envVar="RD_WEBDAV_PASSWORD">
                  <Input type="password" placeholder="WebDAV password" />
                </ConfigField>
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
                <ConfigField label="Overseerr URL" envVar="OVERSEERR_URL" description="Must include /api/v1">
                  <Input placeholder="http://localhost:5055/api/v1" />
                </ConfigField>
                <ConfigField label="API Key" envVar="OVERSEERR_API_KEY">
                  <Input type="password" placeholder="Overseerr API key" />
                </ConfigField>
              </div>
              <Separator />
              <ConfigSection title="Webhook Authentication" description="Optional security for incoming webhooks">
                <ConfigField label="Webhook Auth Header" envVar="OVERSEERR_AUTH" description="Authorization header value to require on incoming webhooks">
                  <Input type="password" placeholder="Optional secret" />
                </ConfigField>
              </ConfigSection>
              <Separator />
              <ConfigSection title="Poller Settings" description="Poll Overseerr for approved requests instead of using webhooks">
                <ConfigField label="Poll Interval (seconds)" envVar="POLL_INTERVAL_S">
                  <Input type="number" placeholder="30" defaultValue="30" />
                </ConfigField>
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
                <ConfigField label="Mount Base Path" envVar="MOUNT_BASE" description="Base directory for all mounts">
                  <Input placeholder="/mnt/schrodrive" defaultValue="/mnt/schrodrive" />
                </ConfigField>
                <ConfigField label="Rclone Path" envVar="RCLONE_PATH" description="Path to rclone binary">
                  <Input placeholder="rclone" defaultValue="rclone" />
                </ConfigField>
              </div>
              
              <Separator />
              <ConfigSection title="Mount Options" description="Custom rclone mount flags">
                <ConfigField label="Mount Options" envVar="MOUNT_OPTIONS" description="Full rclone mount options string">
                  <Input placeholder="--vfs-cache-mode=full --dir-cache-time=12h" defaultValue="--vfs-cache-mode=full --dir-cache-time=12h --poll-interval=0 --buffer-size=64M" />
                </ConfigField>
              </ConfigSection>

              <Separator />
              <ConfigSection title="Cache Settings" description="Individual cache configuration options">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <ConfigField label="VFS Cache Mode" envVar="MOUNT_VFS_CACHE_MODE">
                    <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" defaultValue="full">
                      <option value="off">Off</option>
                      <option value="minimal">Minimal</option>
                      <option value="writes">Writes</option>
                      <option value="full">Full</option>
                    </select>
                  </ConfigField>
                  <ConfigField label="Dir Cache Time" envVar="MOUNT_DIR_CACHE_TIME">
                    <Input placeholder="12h" defaultValue="12h" />
                  </ConfigField>
                  <ConfigField label="Poll Interval" envVar="MOUNT_POLL_INTERVAL">
                    <Input placeholder="0" defaultValue="0" />
                  </ConfigField>
                  <ConfigField label="Buffer Size" envVar="MOUNT_BUFFER_SIZE">
                    <Input placeholder="64M" defaultValue="64M" />
                  </ConfigField>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <ConfigField label="VFS Read Chunk Size" envVar="MOUNT_VFS_READ_CHUNK_SIZE">
                    <Input placeholder="Optional" />
                  </ConfigField>
                  <ConfigField label="VFS Read Chunk Limit" envVar="MOUNT_VFS_READ_CHUNK_SIZE_LIMIT">
                    <Input placeholder="Optional" />
                  </ConfigField>
                  <ConfigField label="VFS Cache Max Age" envVar="MOUNT_VFS_CACHE_MAX_AGE">
                    <Input placeholder="Optional" />
                  </ConfigField>
                  <ConfigField label="VFS Cache Max Size" envVar="MOUNT_VFS_CACHE_MAX_SIZE">
                    <Input placeholder="Optional" />
                  </ConfigField>
                </div>
              </ConfigSection>

              <Separator />
              <ConfigSection title="Permissions" description="Mount file/directory permissions">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <ConfigField label="UID" envVar="MOUNT_UID / PUID">
                    <Input type="number" placeholder="1000" />
                  </ConfigField>
                  <ConfigField label="GID" envVar="MOUNT_GID / PGID">
                    <Input type="number" placeholder="1000" />
                  </ConfigField>
                  <ConfigField label="Dir Perms" envVar="MOUNT_DIR_PERMS">
                    <Input placeholder="0755" />
                  </ConfigField>
                  <ConfigField label="File Perms" envVar="MOUNT_FILE_PERMS">
                    <Input placeholder="0644" />
                  </ConfigField>
                </div>
                <SwitchField label="Allow Other" envVar="MOUNT_ALLOW_OTHER" description="Allow other users to access the mount" defaultChecked />
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
              <SwitchField label="Webhook Server" envVar="RUN_WEBHOOK" description="Listen for Overseerr webhook notifications" defaultChecked />
              <Separator />
              <SwitchField label="Overseerr Poller" envVar="RUN_POLLER" description="Poll Overseerr API for approved requests" />
              <Separator />
              <SwitchField label="Auto-Mount WebDAV" envVar="RUN_MOUNT" description="Automatically mount WebDAV drives on startup" />
              <Separator />
              <SwitchField label="Dead Scanner" envVar="RUN_DEAD_SCANNER" description="Scan for dead/stalled torrents" />
              <Separator />
              <SwitchField label="Dead Scanner Watch Mode" envVar="RUN_DEAD_SCANNER_WATCH" description="Run dead scanner continuously in watch mode" />
              <Separator />
              <SwitchField label="Organizer Watch Mode" envVar="RUN_ORGANIZER_WATCH" description="Run media organizer continuously" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dead Scanner Settings</CardTitle>
              <CardDescription>Configure dead torrent detection and re-adding</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-6 md:grid-cols-2">
                <ConfigField label="Scan Interval (seconds)" envVar="DEAD_SCAN_INTERVAL_S" description="How often to scan for dead torrents">
                  <Input type="number" placeholder="600" defaultValue="600" />
                </ConfigField>
                <ConfigField label="Idle Threshold (minutes)" envVar="DEAD_IDLE_MIN" description="Consider torrent dead after this idle time">
                  <Input type="number" placeholder="120" defaultValue="120" />
                </ConfigField>
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
                <ConfigField label="TMDB API Key" envVar="TMDB_API_KEY" description="Optional - falls back to TVMaze/iTunes if not set">
                  <Input type="password" placeholder="Your TMDB API key" />
                </ConfigField>
                <ConfigField label="Organized Base Path" envVar="ORGANIZED_BASE" description="Where to create the organized structure">
                  <Input placeholder="/mnt/schrodrive/organized" />
                </ConfigField>
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                <ConfigField label="Organizer Mode" envVar="ORGANIZER_MODE">
                  <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" defaultValue="symlink">
                    <option value="symlink">Symlink (recommended)</option>
                    <option value="copy">Copy</option>
                    <option value="move">Move</option>
                  </select>
                </ConfigField>
                <ConfigField label="Scan Interval (seconds)" envVar="ORG_SCAN_INTERVAL_S" description="How often to scan for new media">
                  <Input type="number" placeholder="300" defaultValue="300" />
                </ConfigField>
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
              <SwitchField label="Enable Auto-Update" envVar="AUTO_UPDATE_ENABLED" description="Check GitHub for new releases" />
              <Separator />
              <div className="grid gap-6 md:grid-cols-2">
                <ConfigField label="Check Interval (seconds)" envVar="AUTO_UPDATE_INTERVAL_S">
                  <Input type="number" placeholder="3600" defaultValue="3600" />
                </ConfigField>
                <ConfigField label="Update Strategy" envVar="AUTO_UPDATE_STRATEGY" description="How to handle updates">
                  <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" defaultValue="exit">
                    <option value="exit">Exit (for Docker + Watchtower)</option>
                    <option value="git">Git Pull (for bare-metal)</option>
                  </select>
                </ConfigField>
              </div>
              <Separator />
              <ConfigSection title="Repository" description="GitHub repository to check for updates">
                <div className="grid gap-6 md:grid-cols-2">
                  <ConfigField label="Repo Owner" envVar="REPO_OWNER">
                    <Input placeholder="moderniselife" defaultValue="moderniselife" />
                  </ConfigField>
                  <ConfigField label="Repo Name" envVar="REPO_NAME">
                    <Input placeholder="SchroDrive" defaultValue="SchroDrive" />
                  </ConfigField>
                </div>
              </ConfigSection>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Sticky Save Bar */}
      <div className="sticky bottom-0 -mx-6 -mb-6 bg-background/95 backdrop-blur border-t p-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Changes will be saved to environment configuration</p>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <Button variant="destructive" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Restart Container
          </Button>
          <Button className="gap-2">
            <Save className="h-4 w-4" />
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  )
}
