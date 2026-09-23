'use client';

import { motion } from 'framer-motion';
import {
  Server,
  HardDrive,
  FolderTree,
  Link2,
  Cog,
  ShieldCheck,
  MonitorPlay,
  LayoutDashboard,
  CheckCircle2,
  AlertTriangle,
  MinusCircle,
  Zap,
  ArrowRight,
  RefreshCw,
  Heart,
  Timer,
  RotateCcw,
  Ban,
  Eye,
  List,
  Settings,
  Activity,
  FileSearch,
  Download,
  Upload,
  Cloud,
  Globe,
  Search,
  Film,
  Tv,
  BookOpen,
  ChevronRight,
  Network,
  type LucideIcon,
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import AnimatedSection, { AnimatedChild } from '@/components/ui/AnimatedSection';
import GradientText from '@/components/ui/GradientText';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';

/* ────────────────────────────────────────────────
   Data
   ──────────────────────────────────────────────── */

interface DebridProvider {
  name: string;
  status: 'supported' | 'in-testing' | 'untested';
  features: { torrents: boolean; web: boolean; usenet: boolean; webdav: boolean; bridge: boolean };
}

const providers: DebridProvider[] = [
  { name: 'TorBox', status: 'supported', features: { torrents: true, web: true, usenet: true, webdav: true, bridge: true } },
  { name: 'RealDebrid', status: 'supported', features: { torrents: true, web: false, usenet: false, webdav: true, bridge: true } },
  { name: 'AllDebrid', status: 'supported', features: { torrents: true, web: false, usenet: false, webdav: true, bridge: true } },
  { name: 'Premiumize', status: 'untested', features: { torrents: true, web: false, usenet: false, webdav: true, bridge: true } },
  { name: 'Debrid-Link', status: 'untested', features: { torrents: true, web: false, usenet: false, webdav: true, bridge: true } },
  { name: 'Deepbrid', status: 'untested', features: { torrents: true, web: false, usenet: false, webdav: true, bridge: true } },
  { name: 'Offcloud', status: 'untested', features: { torrents: true, web: false, usenet: false, webdav: true, bridge: true } },
  { name: 'Put.io', status: 'untested', features: { torrents: true, web: false, usenet: false, webdav: true, bridge: true } },
  { name: 'MegaDebrid', status: 'untested', features: { torrents: true, web: false, usenet: false, webdav: false, bridge: true } },
  { name: 'Seedr', status: 'untested', features: { torrents: true, web: false, usenet: false, webdav: true, bridge: true } },
  { name: 'PikPak', status: 'untested', features: { torrents: true, web: false, usenet: false, webdav: true, bridge: true } },
];

const strategies = [
  { name: 'all', description: 'Use all configured providers simultaneously for maximum redundancy.' },
  { name: 'failover', description: 'Try the primary provider first, fall back to others on failure.' },
  { name: 'single', description: 'Use only one provider. Simple and predictable.' },
];

const scrapers = [
  { name: 'Torrentio', description: 'Stremio addon scraper with huge torrent database' },
  { name: 'Comet', description: 'Modern scraper with advanced filtering' },
  { name: 'Zilean', description: 'DMM hashed media scraper for instant results' },
  { name: 'Mediafusion', description: 'Multi-source aggregator with provider support' },
];

const mountTree = [
  { path: '/mnt/schrodrive/', level: 0 },
  { path: '├── realdebrid/', level: 1 },
  { path: '│   ├── __all__/', level: 2 },
  { path: '│   ├── anime/', level: 2 },
  { path: '│   ├── shows/', level: 2 },
  { path: '│   └── movies/', level: 2 },
  { path: '├── torbox/', level: 1 },
  { path: '│   ├── __all__/', level: 2 },
  { path: '│   ├── anime/', level: 2 },
  { path: '│   ├── shows/', level: 2 },
  { path: '│   └── movies/', level: 2 },
  { path: '├── webdav/', level: 1 },
  { path: '│   ├── nas-media/', level: 2 },
  { path: '│   └── seedbox/', level: 2 },
  { path: '└── merged/', level: 1 },
  { path: '    ├── movies/', level: 2 },
  { path: '    ├── shows/', level: 2 },
  { path: '    └── anime/', level: 2 },
];

const cloudStorageProviders = ['MEGA', 'Dropbox', 'Google Drive', 'OneDrive'];

const arrEndpoints = [
  { method: 'GET', path: '/api/v2/app/version', description: 'Returns spoofed qBittorrent version' },
  { method: 'GET', path: '/api/v2/app/preferences', description: 'Returns compatible preferences' },
  { method: 'POST', path: '/api/v2/torrents/add', description: 'Accepts torrent/magnet from *arr' },
  { method: 'GET', path: '/api/v2/torrents/info', description: 'Lists active torrents with status' },
  { method: 'POST', path: '/api/v2/torrents/delete', description: 'Removes torrents on request' },
  { method: 'POST', path: '/api/v2/torrents/pause', description: 'Pause endpoint (no-op, always "seeding")' },
  { method: 'POST', path: '/api/v2/torrents/resume', description: 'Resume endpoint (no-op)' },
  { method: 'POST', path: '/api/v2/auth/login', description: 'Returns session cookie' },
];

const automationServices = [
  { name: 'Seerr Requests', env: 'RUN_POLLER', default: false, description: 'Polls Seerr (Overseerr/Jellyseerr) for approved requests and auto-acquires content.' },
  { name: 'Watchlist Poller', env: 'RUN_WATCHLIST_POLLER', default: false, description: 'Monitors Plex, Jellyfin, Emby, Trakt, Mdblist, and Listrr watchlists for new additions — each source activates automatically once configured.' },
  { name: 'Dead Torrent Scanner', env: 'RUN_DEAD_SCANNER_WATCH', default: false, description: 'Continuously watches for dead or stalled torrents so repair can kick in automatically.' },
  { name: 'Library Refresh', env: 'REFRESH_LIBRARY_ON_ADD', default: true, description: 'Auto-triggers Plex/Jellyfin/Emby library scans after new content.' },
  { name: 'Content Repair', env: 'ENABLE_REPAIR', default: true, description: 'Automatically detects and re-acquires dead or broken torrents.' },
];

const repairPhases = [
  { phase: 'Phase 1: Detection', description: 'Mount health monitor detects dead symlinks and missing files from debrid providers.', icon: Search },
  { phase: 'Phase 2: Re-scrape', description: 'Scraper engine finds alternative torrents with healthy seeders for the same content.', icon: RefreshCw },
  { phase: 'Phase 3: Re-acquire', description: 'New torrent is sent to debrid, cached, mounted, and symlinked — automatically.', icon: CheckCircle2 },
];

const mediaServers = [
  { name: 'Plex', watchlist: true, libraryRefresh: true },
  { name: 'Jellyfin', watchlist: true, libraryRefresh: true },
  { name: 'Emby', watchlist: true, libraryRefresh: true },
];

const watchlistSources = [
  { name: 'Plex', icon: MonitorPlay },
  { name: 'Jellyfin', icon: Film },
  { name: 'Emby', icon: Tv },
  { name: 'Trakt', icon: Eye },
  { name: 'Mdblist', icon: List },
  { name: 'Listrr', icon: BookOpen },
];

const dashboardPages = [
  { name: 'Overview', description: 'System health, active torrents, provider status at a glance.' },
  { name: 'Content Browser', description: 'Browse all mounted media with metadata and poster art.' },
  { name: 'Provider Management', description: 'Configure and monitor debrid provider connections and quotas.' },
  { name: 'Torrent Queue', description: 'Real-time view of active, queued, and completed torrents.' },
  { name: 'Automation Rules', description: 'Enable/disable automation services and configure triggers.' },
  { name: 'Scraper Config', description: 'Manage indexer and scraper sources with priority ordering.' },
  { name: 'Mount Status', description: 'Live FUSE mount health with read/write latency metrics.' },
  { name: 'Logs & Events', description: 'Filterable log viewer with severity levels and search.' },
  { name: 'Settings', description: 'Global configuration, environment variables, and API keys.' },
  { name: 'System Info', description: 'Container stats, uptime, version info, and update checks.' },
];

/* ────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────── */

function FeatureCheck({ supported }: { supported: boolean }) {
  return supported ? (
    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
  ) : (
    <MinusCircle className="w-4 h-4 text-white/20" />
  );
}

function StatusBadge({ status }: { status: 'supported' | 'in-testing' | 'untested' }) {
  if (status === 'supported') {
    return <Badge variant="gradient">✅ Fully Supported</Badge>;
  }
  if (status === 'in-testing') {
    return (
      <Badge variant="outline" className="border-sky-500/40 text-sky-400">
        🧪 In-testing
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-500/40 text-amber-400">
      <AlertTriangle className="w-3 h-3" /> Untested
    </Badge>
  );
}

function SectionHeader({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <AnimatedSection className="mb-12">
      <AnimatedChild>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/20">
            <Icon className="w-6 h-6 text-purple-400" />
          </div>
          <GradientText as="h2" className="text-3xl md:text-4xl font-bold">
            {title}
          </GradientText>
        </div>
      </AnimatedChild>
      <AnimatedChild>
        <p className="text-lg text-white/60 max-w-3xl">{description}</p>
      </AnimatedChild>
    </AnimatedSection>
  );
}

/* ────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────── */

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-[#030014] text-white overflow-x-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-purple-600/8 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-blue-600/8 rounded-full blur-[120px]" />
        <div className="absolute top-1/2 left-1/2 w-[400px] h-[400px] bg-pink-600/5 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10">
        {/* ═══════ Hero ═══════ */}
        <section className="pt-32 pb-20 px-6">
          <div className="max-w-6xl mx-auto text-center">
            <AnimatedSection>
              <AnimatedChild>
                <Badge variant="gradient" className="mb-6">
                  <Zap className="w-3.5 h-3.5" /> Deep Feature Breakdown
                </Badge>
              </AnimatedChild>
              <AnimatedChild>
                <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
                  Features that set{' '}
                  <GradientText>SchröDrive</GradientText>{' '}
                  apart
                </h1>
              </AnimatedChild>
              <AnimatedChild>
                <p className="text-xl md:text-2xl text-white/50 max-w-3xl mx-auto">
                  Built from the ground up to solve the real-world chaos of debrid services.
                </p>
              </AnimatedChild>
            </AnimatedSection>
          </div>
        </section>

        {/* ═══════ 1. Multi-Provider Debrid Support ═══════ */}
        <section className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <SectionHeader
              icon={Server}
              title="Multi-Provider Debrid Support"
              description="Connect up to 11 debrid providers with intelligent failover and redundancy strategies."
            />

            {/* Provider Cards */}
            <AnimatedSection stagger={0.08} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-12">
              {providers.map((provider) => (
                <AnimatedChild key={provider.name}>
                  <GlassCard className="p-6 h-full">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">{provider.name}</h3>
                      <StatusBadge status={provider.status} />
                    </div>
                    <div className="space-y-2">
                      {Object.entries(provider.features).map(([feature, supported]) => (
                        <div key={feature} className="flex items-center justify-between text-sm">
                          <span className="text-white/50 capitalize">{feature === 'web' ? 'Web Downloads' : feature}</span>
                          <FeatureCheck supported={supported} />
                        </div>
                      ))}
                    </div>
                  </GlassCard>
                </AnimatedChild>
              ))}
            </AnimatedSection>

            {/* Strategy explanation */}
            <AnimatedSection className="mb-8">
              <AnimatedChild>
                <h3 className="text-xl font-semibold mb-6 text-white/80">Provider Strategies</h3>
              </AnimatedChild>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {strategies.map((strategy) => (
                  <AnimatedChild key={strategy.name}>
                    <GlassCard className="p-5">
                      <Badge variant="default" className="mb-3 font-mono text-xs">
                        {strategy.name}
                      </Badge>
                      <p className="text-sm text-white/60">{strategy.description}</p>
                    </GlassCard>
                  </AnimatedChild>
                ))}
              </div>
            </AnimatedSection>
          </div>
        </section>

        {/* ═══════ 2. Dual Indexer & Scraper Support ═══════ */}
        <section className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <SectionHeader
              icon={Search}
              title="Dual Indexer & Scraper Support"
              description="Prowlarr or Jackett for indexing, plus 4 additional scrapers for maximum content discovery."
            />

            <AnimatedSection className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
              {/* Indexers */}
              <AnimatedChild>
                <GlassCard className="p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <FileSearch className="w-5 h-5 text-blue-400" />
                    Indexers (Auto-Detected)
                  </h3>
                  <div className="space-y-3">
                    {['Prowlarr', 'Jackett'].map((indexer) => (
                      <div key={indexer} className="flex items-center gap-3 p-3 rounded-lg bg-white/5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        <span className="font-medium">{indexer}</span>
                        <Badge variant="outline" className="ml-auto text-xs">Auto-detect</Badge>
                      </div>
                    ))}
                  </div>
                  <p className="text-sm text-white/40 mt-4">
                    SchröDrive auto-detects which indexer you&apos;re running and configures itself accordingly.
                  </p>
                </GlassCard>
              </AnimatedChild>

              {/* Scrapers */}
              <AnimatedChild>
                <GlassCard className="p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Globe className="w-5 h-5 text-pink-400" />
                    Additional Scrapers
                  </h3>
                  <div className="space-y-3">
                    {scrapers.map((scraper) => (
                      <div key={scraper.name} className="p-3 rounded-lg bg-white/5">
                        <div className="flex items-center gap-2 mb-1">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          <span className="font-medium">{scraper.name}</span>
                        </div>
                        <p className="text-xs text-white/40 ml-6">{scraper.description}</p>
                      </div>
                    ))}
                  </div>
                </GlassCard>
              </AnimatedChild>
            </AnimatedSection>

            <AnimatedSection className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AnimatedChild>
                <GlassCard className="p-5 flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <Activity className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Intelligent Ranking</h4>
                    <p className="text-sm text-white/50">Results are ranked by seeder count, resolution, and source quality automatically.</p>
                  </div>
                </GlassCard>
              </AnimatedChild>
              <AnimatedChild>
                <GlassCard className="p-5 flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <Download className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">.torrent File Support</h4>
                    <p className="text-sm text-white/50">Drop .torrent files directly — SchröDrive extracts the magnet and processes it.</p>
                  </div>
                </GlassCard>
              </AnimatedChild>
            </AnimatedSection>
          </div>
        </section>

        {/* ═══════ 3. Virtual Drive System ═══════ */}
        <section className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <SectionHeader
              icon={HardDrive}
              title="Virtual Drive System"
              description="FUSE-mounted virtual filesystem backed by rclone WebDAV, with external WebDAV server mounting for third-party sources — your debrid content looks like local files."
            />

            <AnimatedSection className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
              {/* Mount Tree */}
              <AnimatedChild>
                <GlassCard className="p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <FolderTree className="w-5 h-5 text-purple-400" />
                    Mount Structure
                  </h3>
                  <div className="font-mono text-sm space-y-0.5 bg-black/30 p-4 rounded-xl border border-white/5">
                    {mountTree.map((item, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, x: -10 }}
                        whileInView={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05, duration: 0.3 }}
                        viewport={{ once: true }}
                        className={`${item.level === 0 ? 'text-purple-400 font-semibold' : item.level === 1 ? 'text-blue-400' : 'text-white/50'}`}
                      >
                        {item.path}
                      </motion.div>
                    ))}
                  </div>
                </GlassCard>
              </AnimatedChild>

              {/* rclone + WebDAV */}
              <AnimatedChild>
                <div className="space-y-4">
                  <GlassCard className="p-6">
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <Upload className="w-5 h-5 text-blue-400" />
                      rclone FUSE Mount
                    </h3>
                    <p className="text-sm text-white/50 mb-4">
                      Each debrid provider exposes its cached content via WebDAV. SchröDrive uses rclone to mount these as local FUSE filesystems, enabling any application to read debrid content as though it were on a local drive.
                    </p>
                    <div className="flex items-center gap-2 text-xs text-white/30">
                      <Badge variant="outline" className="text-xs">rclone</Badge>
                      <ArrowRight className="w-3 h-3" />
                      <Badge variant="outline" className="text-xs">WebDAV</Badge>
                      <ArrowRight className="w-3 h-3" />
                      <Badge variant="outline" className="text-xs">FUSE</Badge>
                      <ArrowRight className="w-3 h-3" />
                      <Badge variant="outline" className="text-xs">/mnt/</Badge>
                    </div>
                  </GlassCard>

                  <GlassCard className="p-6">
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <Link2 className="w-5 h-5 text-pink-400" />
                      WebDAV Bridge
                    </h3>
                    <p className="text-sm text-white/50">
                      For providers without native WebDAV, SchröDrive runs a built-in bridge that translates the provider&apos;s API into a standard WebDAV interface — no external tools needed.
                    </p>
                  </GlassCard>
                </div>
              </AnimatedChild>
            </AnimatedSection>

            {/* Cloud Storage & Links */}
            <AnimatedSection className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <AnimatedChild>
                <GlassCard className="p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Cloud className="w-5 h-5 text-sky-400" />
                    Cloud Storage Mounting
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {cloudStorageProviders.map((provider) => (
                      <Badge key={provider} variant="default">{provider}</Badge>
                    ))}
                  </div>
                  <p className="text-sm text-white/40 mt-3">
                    Mount your cloud storage alongside debrid content for a unified media view.
                  </p>
                </GlassCard>
              </AnimatedChild>
              <AnimatedChild>
                <GlassCard className="p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Globe className="w-5 h-5 text-emerald-400" />
                    Cloud Links
                  </h3>
                  <p className="text-sm text-white/50">
                    Mount public shared folders from cloud providers directly into your filesystem. Point SchröDrive at a shared link and it appears as a local directory.
                  </p>
                </GlassCard>
              </AnimatedChild>
            </AnimatedSection>
          </div>
        </section>

        {/* ═══════ 3b. External WebDAV Mounts ═══════ */}
        <section className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <SectionHeader
              icon={Network}
              title="External WebDAV Mounts"
              description="Mount third-party WebDAV servers as read-only FUSE filesystems — NAS boxes, seedboxes, or any WebDAV-compatible source."
            />

            <AnimatedSection className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
              <AnimatedChild>
                <GlassCard className="p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Settings className="w-5 h-5 text-purple-400" />
                    Configuration
                  </h3>
                  <p className="text-sm text-white/50 mb-4">
                    Define mounts in a <code className="text-xs bg-white/10 px-1.5 py-0.5 rounded text-purple-300">webdav.json</code> file
                    or via the <code className="text-xs bg-white/10 px-1.5 py-0.5 rounded text-purple-300">WEBDAV_MOUNTS</code> environment variable.
                    Each entry specifies a name, URL, credentials, and optional organiser behaviour.
                  </p>
                  <div className="space-y-2">
                    {[
                      { env: 'WEBDAV_MOUNTS_ENABLED', desc: 'Enable external WebDAV mounting' },
                      { env: 'WEBDAV_MOUNTS_FILE', desc: 'Path to JSON config file' },
                      { env: 'WEBDAV_MOUNTS', desc: 'Inline JSON array (fallback)' },
                    ].map((item) => (
                      <div key={item.env} className="flex items-center gap-3 p-2.5 rounded-lg bg-white/5">
                        <code className="text-xs text-purple-300 font-mono bg-white/5 px-1.5 py-0.5 rounded">{item.env}</code>
                        <span className="text-xs text-white/40">{item.desc}</span>
                      </div>
                    ))}
                  </div>
                </GlassCard>
              </AnimatedChild>

              <AnimatedChild>
                <GlassCard className="p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <FolderTree className="w-5 h-5 text-blue-400" />
                    Mount Structure
                  </h3>
                  <div className="font-mono text-sm space-y-0.5 bg-black/30 p-4 rounded-xl border border-white/5">
                    <div className="text-purple-400 font-semibold">/mnt/schrodrive/webdav/</div>
                    <div className="text-blue-400">├── nas-media/</div>
                    <div className="text-white/50">│   ├── movies/</div>
                    <div className="text-white/50">│   └── shows/</div>
                    <div className="text-blue-400">└── seedbox/</div>
                    <div className="text-white/50">    ├── completed/</div>
                    <div className="text-white/50">    └── importing/</div>
                  </div>
                  <p className="text-xs text-white/40 mt-3">
                    Each mount name from your configuration becomes a subdirectory under <code className="text-xs bg-white/10 px-1 py-0.5 rounded">/webdav/</code>.
                  </p>
                </GlassCard>
              </AnimatedChild>
            </AnimatedSection>

            <AnimatedSection>
              <AnimatedChild>
                <GlassCard className="p-5 flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <Eye className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Read-Only &amp; Organiser-Aware</h4>
                    <p className="text-sm text-white/50">
                      External WebDAV mounts are read-only FUSE filesystems. Set <code className="text-xs bg-white/10 px-1 py-0.5 rounded">skipOrganiser: true</code> (default)
                      to prevent the media organiser from processing pre-sorted content from external sources.
                    </p>
                  </div>
                </GlassCard>
              </AnimatedChild>
            </AnimatedSection>
          </div>
        </section>

        {/* ═══════ 4. *arr Bridge ═══════ */}
        <section className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <SectionHeader
              icon={Link2}
              title="*arr Bridge"
              description="SchröDrive masquerades as qBittorrent — Radarr and Sonarr never know the difference."
            />

            {/* Pipeline Diagram */}
            <AnimatedSection className="mb-12">
              <AnimatedChild>
                <GlassCard className="p-6 md:p-8">
                  <h3 className="text-lg font-semibold mb-6">Request Pipeline</h3>
                  <div className="flex flex-wrap items-center justify-center gap-3 text-sm">
                    {[
                      { label: 'Seerr', colour: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
                      { label: 'Radarr / Sonarr', colour: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
                      { label: 'SchröDrive (fake qBit)', colour: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
                      { label: '11 Debrid Providers', colour: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
                      { label: 'FUSE Mount', colour: 'bg-pink-500/20 text-pink-300 border-pink-500/30' },
                      { label: 'Plex / Jellyfin', colour: 'bg-sky-500/20 text-sky-300 border-sky-500/30' },
                    ].map((step, idx, arr) => (
                      <div key={step.label} className="flex items-center gap-3">
                        <span className={`px-4 py-2 rounded-xl border font-medium ${step.colour}`}>
                          {step.label}
                        </span>
                        {idx < arr.length - 1 && (
                          <ChevronRight className="w-4 h-4 text-white/20 hidden sm:block" />
                        )}
                      </div>
                    ))}
                  </div>
                </GlassCard>
              </AnimatedChild>
            </AnimatedSection>

            {/* API Endpoints Table */}
            <AnimatedSection className="mb-12">
              <AnimatedChild>
                <GlassCard className="p-6 overflow-x-auto">
                  <h3 className="text-lg font-semibold mb-4">Supported qBittorrent API Endpoints</h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-white/40 border-b border-white/10">
                        <th className="text-left py-2 px-3 font-medium">Method</th>
                        <th className="text-left py-2 px-3 font-medium">Endpoint</th>
                        <th className="text-left py-2 px-3 font-medium hidden md:table-cell">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {arrEndpoints.map((ep, idx) => (
                        <motion.tr
                          key={ep.path}
                          initial={{ opacity: 0, y: 10 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05 }}
                          viewport={{ once: true }}
                          className="border-b border-white/5 hover:bg-white/5 transition-colors"
                        >
                          <td className="py-2.5 px-3">
                            <span className={`font-mono text-xs px-2 py-0.5 rounded ${ep.method === 'GET' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                              {ep.method}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs text-white/70">{ep.path}</td>
                          <td className="py-2.5 px-3 text-white/40 hidden md:table-cell">{ep.description}</td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </GlassCard>
              </AnimatedChild>
            </AnimatedSection>

            {/* Dual Mode */}
            <AnimatedSection className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AnimatedChild>
                <GlassCard className="p-5">
                  <Badge variant="gradient" className="mb-3">Direct Mode</Badge>
                  <p className="text-sm text-white/50">
                    SchröDrive handles everything end-to-end — from scraping to mounting. No Radarr or Sonarr needed.
                  </p>
                </GlassCard>
              </AnimatedChild>
              <AnimatedChild>
                <GlassCard className="p-5">
                  <Badge variant="gradient" className="mb-3">*arr Mode</Badge>
                  <p className="text-sm text-white/50">
                    Plug into your existing Radarr/Sonarr setup. SchröDrive acts as a download client via the qBittorrent API.
                  </p>
                </GlassCard>
              </AnimatedChild>
            </AnimatedSection>
          </div>
        </section>

        {/* ═══════ 5. Automation Engine ═══════ */}
        <section className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <SectionHeader
              icon={Cog}
              title="Automation Engine"
              description="8 built-in automation services — each independently toggleable via environment variables."
            />

            <AnimatedSection stagger={0.08}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {automationServices.map((service) => (
                  <AnimatedChild key={service.name}>
                    <GlassCard className="p-5 flex items-start gap-4">
                      <div className="flex-shrink-0 mt-1">
                        <div className={`w-3 h-3 rounded-full ${service.default ? 'bg-emerald-400 shadow-lg shadow-emerald-400/50' : 'bg-white/20'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="font-semibold text-sm">{service.name}</h4>
                          <code className="text-xs text-white/30 font-mono bg-white/5 px-1.5 py-0.5 rounded">
                            {service.env}
                          </code>
                          <Badge variant={service.default ? 'gradient' : 'outline'} className="text-xs">
                            {service.default ? 'On by default' : 'Off by default'}
                          </Badge>
                        </div>
                        <p className="text-xs text-white/40">{service.description}</p>
                      </div>
                    </GlassCard>
                  </AnimatedChild>
                ))}
              </div>
            </AnimatedSection>
          </div>
        </section>

        {/* ═══════ 6. Resilience & Self-Healing ═══════ */}
        <section className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <SectionHeader
              icon={ShieldCheck}
              title="Resilience & Self-Healing"
              description="SchröDrive doesn't just report problems — it fixes them. Automatically."
            />

            {/* 3-Phase Repair */}
            <AnimatedSection className="mb-12">
              <AnimatedChild>
                <h3 className="text-xl font-semibold mb-6 text-white/80">3-Phase Dead Torrent Repair</h3>
              </AnimatedChild>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {repairPhases.map((phase, idx) => (
                  <AnimatedChild key={phase.phase}>
                    <GlassCard className="p-6 relative">
                      <div className="absolute top-4 right-4 text-4xl font-bold text-white/5">
                        {idx + 1}
                      </div>
                      <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/15 w-fit mb-4">
                        <phase.icon className="w-5 h-5 text-purple-400" />
                      </div>
                      <h4 className="font-semibold mb-2">{phase.phase}</h4>
                      <p className="text-sm text-white/50">{phase.description}</p>
                      {idx < repairPhases.length - 1 && (
                        <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 z-10">
                          <ArrowRight className="w-5 h-5 text-white/20" />
                        </div>
                      )}
                    </GlassCard>
                  </AnimatedChild>
                ))}
              </div>
            </AnimatedSection>

            {/* Additional Resilience Features */}
            <AnimatedSection stagger={0.1}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { icon: RotateCcw, title: 'Stale Cache Fallback', desc: 'Falls back to cached data when providers are temporarily unreachable.' },
                  { icon: Heart, title: 'Mount Health Monitoring', desc: 'Continuously checks FUSE mount health and auto-remounts on failure.' },
                  { icon: Timer, title: 'Rate Limit Learning', desc: 'Learns and adapts to provider rate limits to avoid throttling.' },
                  { icon: Ban, title: 'Persistent Blacklist', desc: 'Permanently blacklists dead torrents so they\'re never retried.' },
                ].map((feature) => (
                  <AnimatedChild key={feature.title}>
                    <GlassCard className="p-5">
                      <feature.icon className="w-5 h-5 text-blue-400 mb-3" />
                      <h4 className="font-semibold text-sm mb-1">{feature.title}</h4>
                      <p className="text-xs text-white/40">{feature.desc}</p>
                    </GlassCard>
                  </AnimatedChild>
                ))}
              </div>
            </AnimatedSection>

            {/* Multi-Token */}
            <AnimatedSection className="mt-6">
              <AnimatedChild>
                <GlassCard className="p-5 flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <Settings className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Multi-Token Rotation</h4>
                    <p className="text-sm text-white/50">
                      Configure multiple API tokens per provider. SchröDrive rotates through them to distribute load and bypass per-token rate limits.
                    </p>
                  </div>
                </GlassCard>
              </AnimatedChild>
            </AnimatedSection>
          </div>
        </section>

        {/* ═══════ 6b. Zero-Block Plex Architecture ═══════ */}
        <section className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <SectionHeader
              icon={Zap}
              title="Zero-Block Plex Architecture"
              description="Never-block PROPFIND + deferred FUSE mount architecture prevents Plex library deletion on cold starts."
            />

            <AnimatedSection className="mb-12">
              <AnimatedChild>
                <h3 className="text-xl font-semibold mb-6 text-white/80">Two-Phase Pre-Warm Startup</h3>
              </AnimatedChild>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  {
                    phase: 'Phase 1: Container Created',
                    description: 'Plex container is created but not started. SchröDrive begins FUSE mount initialisation and PROPFIND pre-warm cache population.',
                    icon: Server,
                  },
                  {
                    phase: 'Phase 2: Depth-1 Scan',
                    description: 'Pre-warm cache completes a depth-1 directory scan across all configured providers. PROPFIND responses are cached for instant access.',
                    icon: Search,
                  },
                  {
                    phase: 'Phase 3: Bridge Ready',
                    description: 'Two-phase pre-warm signals bridge ready. Plex container is started with a fully populated cache — no empty-library deletion risk.',
                    icon: CheckCircle2,
                  },
                ].map((phase, idx) => (
                  <AnimatedChild key={phase.phase}>
                    <GlassCard className="p-6 relative">
                      <div className="absolute top-4 right-4 text-4xl font-bold text-white/5">
                        {idx + 1}
                      </div>
                      <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/15 w-fit mb-4">
                        <phase.icon className="w-5 h-5 text-purple-400" />
                      </div>
                      <h4 className="font-semibold mb-2">{phase.phase}</h4>
                      <p className="text-sm text-white/50">{phase.description}</p>
                      {idx < 2 && (
                        <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 z-10">
                          <ArrowRight className="w-5 h-5 text-white/20" />
                        </div>
                      )}
                    </GlassCard>
                  </AnimatedChild>
                ))}
              </div>
            </AnimatedSection>

            <AnimatedSection>
              <AnimatedChild>
                <GlassCard className="p-5 flex items-start gap-4">
                  <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Why This Matters</h4>
                    <p className="text-sm text-white/50">
                      Traditional setups risk Plex seeing empty mount points on cold start and deleting your entire library from its database.
                      SchröDrive&apos;s zero-block architecture guarantees the FUSE filesystem is fully populated before Plex ever touches it.
                    </p>
                  </div>
                </GlassCard>
              </AnimatedChild>
            </AnimatedSection>
          </div>
        </section>

        {/* ═══════ 7. Media Server Integration ═══════ */}
        <section className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <SectionHeader
              icon={MonitorPlay}
              title="Media Server Integration"
              description="First-class integration with every major media server — watchlists, library refreshes, and more."
            />

            {/* Media Server Cards */}
            <AnimatedSection stagger={0.12} className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              {mediaServers.map((server) => (
                <AnimatedChild key={server.name}>
                  <GlassCard className="p-6 text-center">
                    <MonitorPlay className="w-10 h-10 text-purple-400 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold mb-4">{server.name}</h3>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-white/50">Watchlist</span>
                        <FeatureCheck supported={server.watchlist} />
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-white/50">Library Refresh</span>
                        <FeatureCheck supported={server.libraryRefresh} />
                      </div>
                    </div>
                  </GlassCard>
                </AnimatedChild>
              ))}
            </AnimatedSection>

            {/* Watchlist Sources */}
            <AnimatedSection>
              <AnimatedChild>
                <h3 className="text-xl font-semibold mb-6 text-white/80">6 Watchlist Sources</h3>
              </AnimatedChild>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {watchlistSources.map((source) => (
                  <AnimatedChild key={source.name}>
                    <GlassCard className="p-4 text-center" hoverEffect>
                      <source.icon className="w-6 h-6 text-blue-400 mx-auto mb-2" />
                      <span className="text-sm font-medium">{source.name}</span>
                    </GlassCard>
                  </AnimatedChild>
                ))}
              </div>
            </AnimatedSection>
          </div>
        </section>

        {/* ═══════ 8. Web Dashboard ═══════ */}
        <section className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <SectionHeader
              icon={LayoutDashboard}
              title="Web Dashboard"
              description="A full 10-page Next.js dashboard embedded in the container — enable with RUN_WEB_GUI=true, no external UI to deploy."
            />

            <AnimatedSection stagger={0.06}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {dashboardPages.map((page, idx) => (
                  <AnimatedChild key={page.name}>
                    <GlassCard className="p-5 flex items-start gap-4">
                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/15 flex items-center justify-center text-xs font-bold text-purple-400">
                        {String(idx + 1).padStart(2, '0')}
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm mb-1">{page.name}</h4>
                        <p className="text-xs text-white/40">{page.description}</p>
                      </div>
                    </GlassCard>
                  </AnimatedChild>
                ))}
              </div>
            </AnimatedSection>
          </div>
        </section>

        {/* ═══════ CTA ═══════ */}
        <section className="py-24 px-6">
          <div className="max-w-3xl mx-auto text-center">
            <AnimatedSection>
              <AnimatedChild>
                <GradientText as="h2" className="text-3xl md:text-5xl font-bold mb-4">
                  Ready to observe your media?
                </GradientText>
              </AnimatedChild>
              <AnimatedChild>
                <p className="text-lg text-white/50 mb-8">
                  Deploy SchröDrive in a single container and collapse the wavefunction.
                </p>
              </AnimatedChild>
              <AnimatedChild>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button href="/docs" size="lg">
                    <Zap className="w-5 h-5" /> Get Started
                  </Button>
                  <Button href="/compare" variant="secondary" size="lg">
                    Compare Alternatives <ArrowRight className="w-5 h-5" />
                  </Button>
                </div>
              </AnimatedChild>
            </AnimatedSection>
          </div>
        </section>
      </div>
    </div>
  );
}
