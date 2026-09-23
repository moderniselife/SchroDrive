'use client';

import { motion } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Minus } from 'lucide-react';
import Badge from '@/components/ui/Badge';

/* ────────────────────────────────────────────────
   Data Types & Constants
   ──────────────────────────────────────────────── */

type CellValue = 'yes' | 'no' | 'untested' | string;

interface ComparisonRow {
  label: string;
  category?: string;
  values: [CellValue, CellValue, CellValue, CellValue, CellValue]; // SchröDrive, DUMB, pd_zurg, Zurg, Riven
}

const tools = ['SchröDrive', 'DUMB', 'pd_zurg', 'Zurg', 'Riven'] as const;

const comparisonData: ComparisonRow[] = [
  // Status
  { category: 'Status', label: 'Project Status', values: ['Active', 'Active', 'Deprecated (Jan 2026)', 'Active (sponsors only)', 'Active'] },
  { label: 'Scope', values: ['Full automation orchestrator', 'AIO multi-service wrapper', 'All-in-one wrapper', 'WebDAV server only', 'Full media automation'] },
  { label: 'Source', values: ['Open (MIT)', 'Open (AGPL-3.0)', 'Open (archived)', 'Closed (sponsors)', 'Open (GPLv3)'] },
  { label: 'Approach', values: ['Single codebase', 'Bundles ~30 third-party services', 'Wraps Zurg + plex_debrid', 'Standalone Go binary', 'Single codebase'] },

  // Provider Support
  { category: 'Provider Support', label: 'TorBox', values: ['yes', 'Via cli_debrid', 'no', 'no', 'yes'] },
  { label: 'RealDebrid', values: ['yes', 'Via Zurg/Decypharr', 'yes', 'yes', 'yes'] },
  { label: 'AllDebrid', values: ['yes', 'Via cli_debrid', 'yes', 'no', 'yes'] },
  { label: 'Premiumize', values: ['untested', 'no', 'no', 'no', 'no'] },
  { label: 'Debrid-Link', values: ['untested', 'no', 'no', 'no', 'no'] },
  { label: 'Deepbrid', values: ['untested', 'no', 'no', 'no', 'no'] },
  { label: 'Offcloud', values: ['untested', 'no', 'no', 'no', 'no'] },
  { label: 'Put.io', values: ['untested', 'no', 'no', 'no', 'no'] },
  { label: 'MegaDebrid', values: ['untested', 'no', 'no', 'no', 'no'] },
  { label: 'Seedr', values: ['untested', 'no', 'no', 'no', 'no'] },
  { label: 'PikPak', values: ['untested', 'no', 'no', 'no', 'no'] },
  { label: 'Multi-Provider Failover', values: ['yes', 'no', 'no', 'no', 'no'] },
  { label: 'Multi-Token Rotation', values: ['yes', 'no', 'no', 'no', 'no'] },

  // Integrations
  { category: 'Integrations', label: 'Prowlarr', values: ['yes', 'Bundled', 'yes', 'no', 'yes'] },
  { label: 'Jackett', values: ['yes', 'no', 'yes', 'no', 'yes'] },
  { label: 'Torrentio', values: ['yes', 'Via plex_debrid', 'no', 'no', 'yes'] },
  { label: 'Comet', values: ['yes', 'no', 'no', 'no', 'yes'] },
  { label: 'Zilean', values: ['yes', 'Bundled', 'no', 'no', 'yes'] },
  { label: 'Mediafusion', values: ['yes', 'no', 'no', 'no', 'yes'] },
  { label: 'Overseerr / Jellyseerr / Seerr', values: ['yes', 'Bundled (Seerr)', 'yes', 'no', 'yes'] },
  { label: 'Radarr/Sonarr (*arr Bridge)', values: ['Native (fake qBit)', 'Bundled + Decypharr', 'Needs Decypharr', 'Needs Decypharr', 'Built-in VFS'] },
  { label: 'Plex', values: ['yes', 'Bundled', 'yes', 'yes', 'yes'] },
  { label: 'Jellyfin', values: ['yes', 'Bundled', 'no', 'yes', 'yes'] },
  { label: 'Emby', values: ['yes', 'Bundled', 'no', 'no', 'yes'] },
  { label: 'Trakt', values: ['yes', 'Via plex_debrid', 'no', 'no', 'yes'] },
  { label: 'Mdblist', values: ['yes', 'no', 'no', 'no', 'yes'] },
  { label: 'Listrr', values: ['yes', 'no', 'no', 'no', 'no'] },
  { label: 'Stremio Addon Server', values: ['yes', 'no', 'no', 'no', 'no'] },
  { label: 'Usenet (NzbDAV)', values: ['no', 'Bundled', 'no', 'no', 'no'] },
  { label: 'Tautulli', values: ['yes', 'Bundled', 'no', 'no', 'no'] },

  // Architecture
  { category: 'Architecture', label: 'Container Model', values: ['Single container', 'Single mega-container', 'Single container', 'Single (+rclone)', 'Multi-service (App + DB + Redis)'] },
  { label: 'Runtime', values: ['Bun/TypeScript', 'Python orchestrator', 'Python + Go', 'Go', 'TypeScript/Node.js'] },
  { label: 'Config Style', values: ['Env vars + Web GUI', 'Guided setup wizard', 'Env vars + config files', 'Single YAML', 'Settings UI + compose'] },
  { label: 'Database', values: ['Embedded SQLite', 'PostgreSQL (bundled)', 'None (in-memory)', 'None (in-memory)', 'PostgreSQL + Redis'] },
  { label: 'Web Dashboard', values: ['10-page Next.js GUI', 'DUMB Dashboard + service UIs', 'no', 'no', 'Settings UI'] },
  { label: 'External DB Required', values: ['no', 'no', 'no', 'no', 'yes'] },
  { label: 'External WebDAV Mounts', values: ['yes', 'no', 'no', 'no', 'no'] },
  { label: 'Cloud Storage Mounts', values: ['yes', 'no', 'no', 'no', 'no'] },
  { label: 'Reverse Proxy / Tunnels', values: ['no', 'Bundled (Traefik + Cloudflared)', 'no', 'no', 'no'] },

  // Resilience
  { category: 'Resilience', label: 'Dead Torrent Repair', values: ['3-phase auto-repair', 'Via Zurg', 'Via Zurg', 'enable_repair', 'Not documented'] },
  { label: 'Mount Health Monitoring', values: ['Auto-remount', 'Via rclone', 'Not documented', 'N/A (WebDAV server)', 'N/A (built-in VFS)'] },
  { label: 'Rate Limit Learning', values: ['Per-endpoint adaptive', 'no', 'no', 'Configurable limits', 'Not documented'] },
  { label: 'Stale Cache Fallback', values: ['yes', 'no', 'no', 'no', 'no'] },
  { label: 'Persistent Blacklist', values: ['yes', 'no', 'no', 'no', 'no'] },
  { label: 'FUSE Auto-Recovery', values: ['yes', 'no', 'no', 'N/A', 'N/A'] },
  { label: 'Symlink Backup/Repair', values: ['no', 'yes', 'no', 'no', 'no'] },
];

/* ────────────────────────────────────────────────
   Cell Renderer
   ──────────────────────────────────────────────── */

function CellContent({ value, colIdx }: { value: CellValue; colIdx: number }) {
  if (value === 'yes') {
    return (
      <motion.div
        initial={{ scale: 0 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true }}
        transition={{ type: 'spring', stiffness: 400, damping: 15, delay: colIdx * 0.05 }}
        className="flex justify-center"
      >
        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
      </motion.div>
    );
  }

  if (value === 'no') {
    return (
      <div className="flex justify-center">
        <Minus className="w-5 h-5 text-white/15" />
      </div>
    );
  }

  if (value === 'untested') {
    return (
      <motion.div
        initial={{ scale: 0 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true }}
        transition={{ type: 'spring', stiffness: 400, damping: 15, delay: colIdx * 0.05 }}
        className="flex justify-center"
      >
        <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-400">
          <AlertTriangle className="w-3 h-3" /> Untested
        </Badge>
      </motion.div>
    );
  }

  // Text value
  return (
    <span className={`text-xs md:text-sm ${colIdx === 0 ? 'text-white/80 font-medium' : 'text-white/50'}`}>
      {value}
    </span>
  );
}

/* ────────────────────────────────────────────────
   Component
   ──────────────────────────────────────────────── */

export default function ComparisonTable() {
  return (
    <div className="w-full overflow-x-auto rounded-2xl border border-white/10 backdrop-blur-xl bg-white/[0.03]">
      <table className="w-full min-w-[700px]">
        {/* Header */}
        <thead>
          <tr>
            <th className="text-left py-4 px-4 md:px-6 text-sm font-medium text-white/40 w-[200px] md:w-[260px]">
              Feature
            </th>
            {tools.map((tool, idx) => (
              <th
                key={tool}
                className={`text-center py-4 px-3 md:px-4 text-sm font-semibold ${
                  idx === 0
                    ? 'bg-gradient-to-b from-purple-500/10 to-transparent border-x border-t border-purple-500/20 rounded-t-xl'
                    : 'text-white/60'
                }`}
              >
                {idx === 0 ? (
                  <span className="bg-gradient-to-r from-purple-400 via-blue-400 to-pink-400 bg-clip-text text-transparent font-bold">
                    {tool}
                  </span>
                ) : (
                  tool
                )}
              </th>
            ))}
          </tr>
        </thead>

        {/* Body */}
        <tbody>
          {comparisonData.map((row, rowIdx) => (
            <>
              {/* Category Header */}
              {row.category && (
                <tr key={`cat-${row.category}`}>
                  <td
                    colSpan={6}
                    className="py-3 px-4 md:px-6 text-xs font-bold uppercase tracking-wider text-white/30 bg-white/[0.02] border-t border-white/10"
                  >
                    {row.category}
                  </td>
                </tr>
              )}

              {/* Data Row */}
              <motion.tr
                key={`row-${rowIdx}`}
                className="group border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ delay: rowIdx * 0.02 }}
              >
                <td className="py-3 px-4 md:px-6 text-sm text-white/70 font-medium">
                  {row.label}
                </td>
                {row.values.map((value, colIdx) => (
                  <td
                    key={colIdx}
                    className={`py-3 px-3 md:px-4 text-center ${
                      colIdx === 0 ? 'bg-purple-500/[0.03] border-x border-purple-500/10' : ''
                    }`}
                  >
                    <CellContent value={value} colIdx={colIdx} />
                  </td>
                ))}
              </motion.tr>
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
