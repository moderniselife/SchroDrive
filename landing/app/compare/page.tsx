'use client';

import {
  Zap,
  ArrowRight,
  Database,
  Server,
  HardDrive,
  Container,
  Clock,
  Shield,
  MemoryStick,
  Copy,
  Settings,
  CheckCircle2,
  Minus,
  Archive,
  Layers,
  Boxes,
  AlertTriangle,
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import AnimatedSection, { AnimatedChild } from '@/components/ui/AnimatedSection';
import GradientText from '@/components/ui/GradientText';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import ComparisonTable from '@/components/compare/ComparisonTable';

/* ────────────────────────────────────────────────
   Data
   ──────────────────────────────────────────────── */

const projectSummaries = [
  {
    name: 'SchröDrive',
    gradient: true,
    summary:
      'All-in-one orchestrator with 11-provider redundancy, 3-phase torrent repair, native *arr bridge, embedded SQLite, full Next.js dashboard, and single container deployment.',
    highlights: [
      '11 debrid providers with failover',
      '3-phase dead torrent repair',
      'Native qBittorrent API bridge',
      'Embedded SQLite — zero external DBs',
      'Full Next.js dashboard included',
      'Single container, single config',
    ],
  },
  {
    name: 'DUMB',
    gradient: false,
    summary:
      'AIO multi-service wrapper that bundles ~30 third-party projects (Zurg, Riven, cli_debrid, Decypharr, Arrs, Plex, Zilean, etc.) into a single Docker image with a guided setup wizard and Traefik access layer.',
    highlights: [
      'Bundles ~30 services in one container',
      'Guided setup wizard',
      'Bundled Traefik + Cloudflare tunnels',
      'Symlink backup and repair',
      'Aggregates existing tools — not native features',
      'Python orchestrator for third-party binaries',
    ],
  },
  {
    name: 'pd_zurg',
    gradient: false,
    summary:
      'Deprecated as of January 2026. Was the original all-in-one Docker solution wrapping Zurg with Plex integration. Successor project is DUMB.',
    highlights: [
      'Archived — no longer maintained',
      'Was the pioneer all-in-one approach',
      'Successor: DUMB project',
      'Python + rclone stack',
    ],
    deprecated: true,
  },
  {
    name: 'Zurg',
    gradient: false,
    summary:
      'Purpose-built WebDAV server for RealDebrid. Excellent at serving files with fast Go binary, but requires additional tools for automation, scraping, and media server integration.',
    highlights: [
      'Fast Go binary',
      'Excellent WebDAV serving',
      'RealDebrid only',
      'Needs additional tools for full setup',
      'Sponsor-only access',
    ],
  },
  {
    name: 'Riven',
    gradient: false,
    summary:
      'Feature-rich media automation with 7+ scrapers, Trakt/Mdblist integration, built-in VFS, and settings UI. Requires PostgreSQL and multi-container deployment.',
    highlights: [
      '7+ scraper sources',
      'Trakt & Mdblist integration',
      'Built-in VFS system',
      'Settings UI for configuration',
      'Requires PostgreSQL + Redis',
      'Multi-container deployment',
    ],
  },
];

interface SQLiteComparisonRow {
  feature: string;
  sqlite: string;
  postgres: string;
}

const sqliteComparison: SQLiteComparisonRow[] = [
  { feature: 'Containers needed', sqlite: '1 (SchröDrive only)', postgres: '3+ (app + PostgreSQL + Redis)' },
  { feature: 'RAM overhead', sqlite: '~50 MB total', postgres: '~300-500 MB (PostgreSQL alone ~200 MB)' },
  { feature: 'Backup method', sqlite: 'Copy a single file', postgres: 'pg_dump + Redis snapshot' },
  { feature: 'Config complexity', sqlite: 'Zero — just works', postgres: 'Connection strings, credentials, networking' },
  { feature: 'Scaling needs', sqlite: 'None — it\'s a single-user app', postgres: 'Overkill for single-user workloads' },
  { feature: 'Migration risk', sqlite: 'Schema built-in, auto-migrated', postgres: 'Manual migration scripts needed' },
  { feature: 'Cold start time', sqlite: '< 1 second', postgres: '10-30 seconds (DB init)' },
  { feature: 'Disk footprint', sqlite: '~5 MB', postgres: '~500 MB (PostgreSQL image)' },
];

/* ────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────── */

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-[#030014] text-white overflow-x-hidden">
      {/* Ambient background */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-1/4 w-[600px] h-[600px] bg-purple-600/8 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/3 left-1/3 w-[500px] h-[500px] bg-blue-600/8 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10">
        {/* ═══════ Hero ═══════ */}
        <section className="pt-32 pb-20 px-6">
          <div className="max-w-6xl mx-auto text-center">
            <AnimatedSection>
              <AnimatedChild>
                <Badge variant="gradient" className="mb-6">
                  <Layers className="w-3.5 h-3.5" /> Honest Comparison
                </Badge>
              </AnimatedChild>
              <AnimatedChild>
                <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold mb-6 leading-tight">
                  <GradientText>SchröDrive</GradientText> vs the Alternatives
                </h1>
              </AnimatedChild>
              <AnimatedChild>
                <p className="text-xl md:text-2xl text-white/50 max-w-3xl mx-auto mb-6">
                  An honest comparison based on each project&apos;s public documentation.
                </p>
              </AnimatedChild>
              <AnimatedChild>
                <Badge variant="outline" className="text-xs text-white/40">
                  <Clock className="w-3 h-3" /> Last updated June 2026
                </Badge>
              </AnimatedChild>
            </AnimatedSection>
          </div>
        </section>

        {/* ═══════ Comparison Table ═══════ */}
        <section className="py-12 px-6">
          <div className="max-w-6xl mx-auto">
            <AnimatedSection>
              <AnimatedChild>
                <ComparisonTable />
              </AnimatedChild>
            </AnimatedSection>
          </div>
        </section>

        {/* ═══════ What Each Project Does Best ═══════ */}
        <section className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <AnimatedSection className="mb-12">
              <AnimatedChild>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/20">
                    <Boxes className="w-6 h-6 text-purple-400" />
                  </div>
                  <GradientText as="h2" className="text-3xl md:text-4xl font-bold">
                    What Each Project Does Best
                  </GradientText>
                </div>
              </AnimatedChild>
              <AnimatedChild>
                <p className="text-lg text-white/50 max-w-3xl">
                  Every project in this space has its strengths. Here&apos;s a fair summary.
                </p>
              </AnimatedChild>
            </AnimatedSection>

            <AnimatedSection stagger={0.12} className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {projectSummaries.map((project) => (
                <AnimatedChild key={project.name}>
                  <GlassCard
                    className={`p-6 h-full ${project.gradient ? 'border-purple-500/30' : ''}`}
                    gradientBorder={project.gradient}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      {project.gradient ? (
                        <GradientText as="h3" className="text-xl font-bold">
                          {project.name}
                        </GradientText>
                      ) : (
                        <h3 className="text-xl font-bold text-white/90">{project.name}</h3>
                      )}
                      {project.deprecated && (
                        <Badge variant="outline" className="text-xs border-red-500/40 text-red-400">
                          <AlertTriangle className="w-3 h-3" /> Deprecated
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-white/50 mb-4">{project.summary}</p>
                    <ul className="space-y-1.5">
                      {project.highlights.map((highlight) => (
                        <li key={highlight} className="flex items-center gap-2 text-sm">
                          <CheckCircle2 className={`w-3.5 h-3.5 flex-shrink-0 ${project.gradient ? 'text-emerald-400' : 'text-white/30'}`} />
                          <span className={project.gradient ? 'text-white/70' : 'text-white/40'}>{highlight}</span>
                        </li>
                      ))}
                    </ul>
                  </GlassCard>
                </AnimatedChild>
              ))}
            </AnimatedSection>
          </div>
        </section>

        {/* ═══════ Why SQLite? ═══════ */}
        <section className="py-20 px-6">
          <div className="max-w-6xl mx-auto">
            <AnimatedSection className="mb-12">
              <AnimatedChild>
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/20">
                    <Database className="w-6 h-6 text-purple-400" />
                  </div>
                  <GradientText as="h2" className="text-3xl md:text-4xl font-bold">
                    Why SQLite?
                  </GradientText>
                </div>
              </AnimatedChild>
              <AnimatedChild>
                <p className="text-lg text-white/50 max-w-3xl">
                  SchröDrive is a single-user application managing your personal media. PostgreSQL + Redis is
                  infrastructure designed for thousands of concurrent users — it&apos;s overkill and operational overhead
                  you shouldn&apos;t need.
                </p>
              </AnimatedChild>
            </AnimatedSection>

            {/* SQLite vs PostgreSQL Table */}
            <AnimatedSection className="mb-12">
              <AnimatedChild>
                <GlassCard className="p-0 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[500px]">
                      <thead>
                        <tr className="border-b border-white/10">
                          <th className="text-left py-4 px-6 text-sm font-medium text-white/40">Aspect</th>
                          <th className="text-center py-4 px-4 text-sm font-semibold">
                            <span className="bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                              SQLite (SchröDrive)
                            </span>
                          </th>
                          <th className="text-center py-4 px-4 text-sm font-semibold text-white/60">
                            PostgreSQL + Redis
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sqliteComparison.map((row, idx) => (
                          <tr
                            key={row.feature}
                            className="border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                          >
                            <td className="py-3 px-6 text-sm text-white/70 font-medium">{row.feature}</td>
                            <td className="py-3 px-4 text-center text-sm text-emerald-400/80">{row.sqlite}</td>
                            <td className="py-3 px-4 text-center text-sm text-white/40">{row.postgres}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </GlassCard>
              </AnimatedChild>
            </AnimatedSection>

            {/* SQLite Philosophy Cards */}
            <AnimatedSection stagger={0.1} className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {
                  icon: Container,
                  title: 'Single Container',
                  desc: 'No Docker Compose orchestration. No networking between services. One container, one volume, done.',
                },
                {
                  icon: Copy,
                  title: 'Backup = cp',
                  desc: 'Your entire database is one file. Back it up with cp, rsync, or any file sync tool. No pg_dump needed.',
                },
                {
                  icon: Shield,
                  title: 'Zero Attack Surface',
                  desc: 'No exposed database ports. No Redis instance to secure. No connection string credentials to manage.',
                },
              ].map((card) => (
                <AnimatedChild key={card.title}>
                  <GlassCard className="p-5">
                    <card.icon className="w-5 h-5 text-purple-400 mb-3" />
                    <h4 className="font-semibold text-sm mb-1">{card.title}</h4>
                    <p className="text-xs text-white/40">{card.desc}</p>
                  </GlassCard>
                </AnimatedChild>
              ))}
            </AnimatedSection>
          </div>
        </section>

        {/* ═══════ CTA ═══════ */}
        <section className="py-24 px-6">
          <div className="max-w-3xl mx-auto text-center">
            <AnimatedSection>
              <AnimatedChild>
                <GradientText as="h2" className="text-3xl md:text-5xl font-bold mb-4">
                  Convinced? Get started in 30 seconds
                </GradientText>
              </AnimatedChild>
              <AnimatedChild>
                <p className="text-lg text-white/50 mb-8">
                  One container. One config. Zero external databases. Deploy SchröDrive and start observing your media.
                </p>
              </AnimatedChild>
              <AnimatedChild>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <Button href="/docs" size="lg">
                    <Zap className="w-5 h-5" /> Read the Docs
                  </Button>
                  <Button href="/features" variant="secondary" size="lg">
                    Explore Features <ArrowRight className="w-5 h-5" />
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
