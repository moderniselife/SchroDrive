'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Cloud,
  Plug,
  Settings,
  FolderOpen,
  HardDrive,
  Copy,
  Check,
  Download,
  ChevronRight,
  Info,
  Sparkles,
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import GradientText from '@/components/ui/GradientText';
import Badge from '@/components/ui/Badge';
import CodeBlock from '@/components/ui/CodeBlock';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface ProviderConfig {
  id: string;
  name: string;
  envKey: string;
  enabled: boolean;
  apiKeyLabel: string;
  apiKey: string;
}

interface IntegrationConfig {
  id: string;
  name: string;
  enabled: boolean;
  fields: { key: string; label: string; placeholder: string; value: string }[];
}

interface ServiceConfig {
  envName: string;
  label: string;
  description: string;
  enabled: boolean;
}

interface PathConfig {
  mountBase: string;
  configDir: string;
  timezone: string;
}

interface MediaManagerConfig {
  enabled: boolean;
  plexToken: string;
  tautulliApiKey: string;
  qbitHost: string;
  qbitUsername: string;
  qbitPassword: string;
  tmdbApiKey: string;
  encoderDefault: 'nvenc' | 'cpu';
  mediaMovies: string;
  mediaTv: string;
}

// ─────────────────────────────────────────────
// Default State
// ─────────────────────────────────────────────

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: 'torbox', name: 'TorBox', envKey: 'TORBOX_API_KEY', enabled: true, apiKeyLabel: 'API Key', apiKey: '' },
  { id: 'realdebrid', name: 'RealDebrid', envKey: 'RD_ACCESS_TOKEN', enabled: true, apiKeyLabel: 'Access Token', apiKey: '' },
  { id: 'alldebrid', name: 'AllDebrid', envKey: 'ALLDEBRID_API_KEY', enabled: false, apiKeyLabel: 'API Key', apiKey: '' },
  { id: 'premiumize', name: 'Premiumize', envKey: 'PREMIUMIZE_API_KEY', enabled: false, apiKeyLabel: 'API Key', apiKey: '' },
  { id: 'debridlink', name: 'Debrid-Link', envKey: 'DEBRIDLINK_API_KEY', enabled: false, apiKeyLabel: 'API Key', apiKey: '' },
  { id: 'deepbrid', name: 'Deepbrid', envKey: 'DEEPBRID_API_KEY', enabled: false, apiKeyLabel: 'API Key', apiKey: '' },
  { id: 'offcloud', name: 'Offcloud', envKey: 'OFFCLOUD_API_KEY', enabled: false, apiKeyLabel: 'API Key', apiKey: '' },
  { id: 'putio', name: 'Put.io', envKey: 'PUTIO_OAUTH_TOKEN', enabled: false, apiKeyLabel: 'OAuth Token', apiKey: '' },
  { id: 'megadebrid', name: 'MegaDebrid', envKey: 'MEGADEBRID_API_KEY', enabled: false, apiKeyLabel: 'API Key', apiKey: '' },
  { id: 'seedr', name: 'Seedr', envKey: 'SEEDR_API_KEY', enabled: false, apiKeyLabel: 'API Key', apiKey: '' },
  { id: 'pikpak', name: 'PikPak', envKey: 'PIKPAK_USERNAME', enabled: false, apiKeyLabel: 'Username', apiKey: '' },
];

const DEFAULT_INTEGRATIONS: IntegrationConfig[] = [
  {
    id: 'overseerr',
    name: 'Seerr (Overseerr / Jellyseerr)',
    enabled: false,
    fields: [
      { key: 'SEERR_URL', label: 'URL', placeholder: 'http://seerr:5055', value: '' },
      { key: 'SEERR_API_KEY', label: 'API Key', placeholder: 'your_seerr_api_key', value: '' },
    ],
  },
  {
    id: 'prowlarr',
    name: 'Prowlarr',
    enabled: false,
    fields: [
      { key: 'PROWLARR_URL', label: 'URL', placeholder: 'http://prowlarr:9696', value: '' },
      { key: 'PROWLARR_API_KEY', label: 'API Key', placeholder: 'your_prowlarr_api_key', value: '' },
    ],
  },
  {
    id: 'jackett',
    name: 'Jackett',
    enabled: false,
    fields: [
      { key: 'JACKETT_URL', label: 'URL', placeholder: 'http://jackett:9117', value: '' },
      { key: 'JACKETT_API_KEY', label: 'API Key', placeholder: 'your_jackett_api_key', value: '' },
    ],
  },
  {
    id: 'plex',
    name: 'Plex',
    enabled: false,
    fields: [
      { key: 'PLEX_URL', label: 'URL', placeholder: 'http://plex:32400', value: '' },
      { key: 'PLEX_TOKEN', label: 'Token', placeholder: 'your_plex_token', value: '' },
    ],
  },
  {
    id: 'jellyfin',
    name: 'Jellyfin',
    enabled: false,
    fields: [
      { key: 'JELLYFIN_URL', label: 'URL', placeholder: 'http://jellyfin:8096', value: '' },
      { key: 'JELLYFIN_API_KEY', label: 'API Key', placeholder: 'your_jellyfin_api_key', value: '' },
    ],
  },
  {
    id: 'emby',
    name: 'Emby',
    enabled: false,
    fields: [
      { key: 'EMBY_URL', label: 'URL', placeholder: 'http://emby:8096', value: '' },
      { key: 'EMBY_API_KEY', label: 'API Key', placeholder: 'your_emby_api_key', value: '' },
    ],
  },
];

const DEFAULT_SERVICES: ServiceConfig[] = [
  { envName: 'RUN_MOUNT', label: 'rclone FUSE Mounts', description: 'Mount debrid cloud storage as local directories.', enabled: false },
  { envName: 'RUN_WEBHOOK', label: 'Seerr Webhook', description: 'Listen for media requests via webhook.', enabled: true },
  { envName: 'RUN_POLLER', label: 'API Poller', description: 'Periodically poll Seerr for new requests.', enabled: false },
  { envName: 'RUN_WATCHLIST_POLLER', label: 'Watchlist Poller', description: 'Poll Plex/Jellyfin/Emby watchlists for requests.', enabled: false },
  { envName: 'RUN_DEAD_SCANNER_WATCH', label: 'Dead Scanner', description: 'Detect and replace broken or stalled torrents.', enabled: false },
  { envName: 'RUN_ORGANIZER_WATCH', label: 'Media Organiser', description: 'Auto-organise media into library folders via TMDB.', enabled: false },
  { envName: 'ARR_BRIDGE_ENABLED', label: '*arr Bridge', description: 'Emulate qBittorrent for Sonarr/Radarr.', enabled: false },
  { envName: 'AUTO_UPDATE_ENABLED', label: 'Auto-Update', description: 'Check GitHub releases and auto-update.', enabled: false },
  { envName: 'RUN_WEB_GUI', label: 'Web GUI', description: '10-page Next.js dashboard on :3000.', enabled: false },
  { envName: 'WEBDAV_MOUNTS_ENABLED', label: 'External WebDAV Mounts', description: 'Mount third-party WebDAV servers as read-only FUSE filesystems.', enabled: false },
];

const DEFAULT_PATHS: PathConfig = {
  mountBase: '/mnt/schrodrive',
  configDir: './schrodrive/config',
  timezone: 'Australia/Sydney',
};

const DEFAULT_MEDIA_MANAGER: MediaManagerConfig = {
  enabled: false,
  plexToken: '',
  tautulliApiKey: '',
  qbitHost: '',
  qbitUsername: 'admin',
  qbitPassword: '',
  tmdbApiKey: '',
  encoderDefault: 'nvenc',
  mediaMovies: '/mnt/media/movies',
  mediaTv: '/mnt/media/tv',
};

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export default function DockerGenerator() {
  const [providers, setProviders] = useState<ProviderConfig[]>(DEFAULT_PROVIDERS);
  const [integrations, setIntegrations] = useState<IntegrationConfig[]>(DEFAULT_INTEGRATIONS);
  const [services, setServices] = useState<ServiceConfig[]>(DEFAULT_SERVICES);
  const [paths, setPaths] = useState<PathConfig>(DEFAULT_PATHS);
  const [mediaManager, setMediaManager] = useState<MediaManagerConfig>(DEFAULT_MEDIA_MANAGER);
  const [copied, setCopied] = useState(false);
  const [activeStep, setActiveStep] = useState(1);

  // ─── Provider Handlers ─── //
  const toggleProvider = useCallback((id: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p))
    );
  }, []);

  const updateProviderKey = useCallback((id: string, apiKey: string) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, apiKey } : p))
    );
  }, []);

  // ─── Integration Handlers ─── //
  const toggleIntegration = useCallback((id: string) => {
    setIntegrations((prev) =>
      prev.map((i) => (i.id === id ? { ...i, enabled: !i.enabled } : i))
    );
  }, []);

  const updateIntegrationField = useCallback((integrationId: string, fieldKey: string, value: string) => {
    setIntegrations((prev) =>
      prev.map((i) =>
        i.id === integrationId
          ? {
              ...i,
              fields: i.fields.map((f) =>
                f.key === fieldKey ? { ...f, value } : f
              ),
            }
          : i
      )
    );
  }, []);

  // ─── Service Handlers ─── //
  const toggleService = useCallback((envName: string) => {
    setServices((prev) =>
      prev.map((s) => (s.envName === envName ? { ...s, enabled: !s.enabled } : s))
    );
  }, []);

  // ─── Generate YAML ─── //
  const generatedYaml = useMemo(() => {
    const enabledProviders = providers.filter((p) => p.enabled);
    const enabledIntegrations = integrations.filter((i) => i.enabled);
    const needsNetwork = mediaManager.enabled;

    let yaml = '';
    yaml += '# ──────────────────────────────────────────────\n';
    yaml += '# SchröDrive Docker Compose Configuration\n';
    yaml += `# Generated on ${new Date().toISOString().split('T')[0]}\n`;
    yaml += '# ──────────────────────────────────────────────\n\n';

    yaml += 'services:\n';

    // ─── SchröDrive Core ─── //
    yaml += '  schrodrive:\n';
    yaml += '    image: ghcr.io/moderniselife/schrodrive:latest\n';
    yaml += '    container_name: schrodrive\n';
    yaml += '    restart: unless-stopped\n';
    yaml += '    ports:\n';
    yaml += '      - "8978:8978"\n';
    yaml += '      - "3000:3000"\n';

    // Volumes
    yaml += '    volumes:\n';
    yaml += `      - ${paths.configDir}:/app/config\n`;
    yaml += `      - ${paths.mountBase}:${paths.mountBase}:shared\n`;

    // FUSE capabilities
    yaml += '    cap_add:\n';
    yaml += '      - SYS_ADMIN\n';
    yaml += '    devices:\n';
    yaml += '      - /dev/fuse\n';
    yaml += '    security_opt:\n';
    yaml += '      - apparmor:unconfined\n';

    // Environment
    yaml += '    environment:\n';
    yaml += `      # ── Core Settings ──\n`;
    yaml += `      - PROVIDERS=${enabledProviders.map((p) => p.id).join(',')}\n`;
    yaml += `      - ADD_STRATEGY=all\n`;
    yaml += `      - MOUNT_BASE=${paths.mountBase}\n`;
    yaml += `      - TOKEN_RESET_TIMEZONE=${paths.timezone}\n`;
    yaml += `      - TZ=${paths.timezone} # container timezone\n`;
    yaml += '\n';

    // Debrid keys
    if (enabledProviders.length > 0) {
      yaml += `      # ── Debrid Provider Keys ──\n`;
      for (const provider of enabledProviders) {
        yaml += `      - ${provider.envKey}=${provider.apiKey || `your_${provider.id}_key`}\n`;
      }
      yaml += '\n';
    }

    // Integrations
    if (enabledIntegrations.length > 0) {
      yaml += `      # ── Integrations ──\n`;
      for (const integration of enabledIntegrations) {
        for (const field of integration.fields) {
          yaml += `      - ${field.key}=${field.value || field.placeholder}\n`;
        }
      }
      yaml += '\n';
    }

    // Services
    yaml += `      # ── Service Toggles ──\n`;
    for (const service of services) {
      yaml += `      - ${service.envName}=${service.enabled}\n`;
    }

    // Health check
    yaml += '\n';
    yaml += '    healthcheck:\n';
    yaml += '      test: ["CMD", "curl", "-f", "http://localhost:8978/health"]\n';
    yaml += '      interval: 30s\n';
    yaml += '      timeout: 10s\n';
    yaml += '      retries: 3\n';
    yaml += '      start_period: 30s\n';

    // Network
    if (needsNetwork) {
      yaml += '    networks:\n';
      yaml += '      - schrodrive\n';
    }

    // ─── Media Manager (Coming Soon) ─── //
    // Not generated yet — this service does not exist in the current release.
    // When available, it will be a local storage companion with hardware encoding.
    // Keeping the compose factually correct: no schrodrive-media service is emitted.
    if (false && mediaManager.enabled) {
      // Placeholder for future media-manager service
    }

    // Networks
    if (needsNetwork) {
      yaml += '\nnetworks:\n';
      yaml += '  schrodrive:\n';
      yaml += '    driver: bridge\n';
    }

    return yaml;
  }, [providers, integrations, services, paths, mediaManager]);

  // ─── Copy / Download ─── //
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(generatedYaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = generatedYaml;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }, [generatedYaml]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([generatedYaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'docker-compose.yml';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [generatedYaml]);

  // ─── Steps ─── //
  const steps = [
    { num: 1, label: 'Providers', icon: Cloud },
    { num: 2, label: 'Integrations', icon: Plug },
    { num: 3, label: 'Services', icon: Settings },
    { num: 4, label: 'Paths', icon: FolderOpen },
    { num: 5, label: 'Media Manager', icon: HardDrive },
  ];

  return (
    <div className="space-y-8">
      {/* Step Navigator */}
      <div className="flex flex-wrap gap-2">
        {steps.map((step) => {
          const Icon = step.icon;
          const isActive = activeStep === step.num;
          return (
            <button
              key={step.num}
              onClick={() => setActiveStep(step.num)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 border ${isActive ? 'bg-purple-500/20 border-purple-500/40 text-purple-300' : 'bg-white/5 border-white/10 text-white/50 hover:text-white/80 hover:bg-white/10'}`}
            >
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isActive ? 'bg-purple-500/30 text-purple-200' : 'bg-white/10 text-white/40'}`}>
                {step.num}
              </span>
              <Icon className="w-4 h-4" />
              {step.label}
            </button>
          );
        })}
      </div>

      {/* Step Content */}
      <GlassCard className="p-6 sm:p-8" hoverEffect={false}>
        {/* Step 1: Providers */}
        {activeStep === 1 && (
          <StepContainer
            title="Choose Debrid Providers"
            description="Select which debrid services you want to use. At least one is required."
          >
            <div className="grid sm:grid-cols-2 gap-4">
              {providers.map((provider) => (
                <div key={provider.id} className="space-y-3">
                  <ToggleRow
                    label={provider.name}
                    enabled={provider.enabled}
                    onToggle={() => toggleProvider(provider.id)}
                  />
                  {provider.enabled && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      className="ml-14"
                    >
                      <InputField
                        label={provider.apiKeyLabel}
                        value={provider.apiKey}
                        onChange={(v) => updateProviderKey(provider.id, v)}
                        placeholder={`your_${provider.id}_key`}
                        type="password"
                      />
                    </motion.div>
                  )}
                </div>
              ))}
            </div>
          </StepContainer>
        )}

        {/* Step 2: Integrations */}
        {activeStep === 2 && (
          <StepContainer
            title="Configure Integrations"
            description="Enable and configure your media ecosystem connections."
          >
            <div className="space-y-4">
              {integrations.map((integration) => (
                <div key={integration.id}>
                  <ToggleRow
                    label={integration.name}
                    enabled={integration.enabled}
                    onToggle={() => toggleIntegration(integration.id)}
                  />
                  {integration.enabled && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      className="ml-14 mt-3 grid sm:grid-cols-2 gap-3"
                    >
                      {integration.fields.map((field) => (
                        <InputField
                          key={field.key}
                          label={field.label}
                          value={field.value}
                          onChange={(v) =>
                            updateIntegrationField(integration.id, field.key, v)
                          }
                          placeholder={field.placeholder}
                        />
                      ))}
                    </motion.div>
                  )}
                </div>
              ))}
            </div>
          </StepContainer>
        )}

        {/* Step 3: Services */}
        {activeStep === 3 && (
          <StepContainer
            title="Enable Services"
            description="Choose which SchröDrive services to run."
          >
            <div className="grid sm:grid-cols-2 gap-3">
              {services.map((service) => (
                <ToggleRow
                  key={service.envName}
                  label={service.label}
                  description={service.description}
                  enabled={service.enabled}
                  onToggle={() => toggleService(service.envName)}
                />
              ))}
            </div>
          </StepContainer>
        )}

        {/* Step 4: Paths */}
        {activeStep === 4 && (
          <StepContainer
            title="Set Paths"
            description="Configure directory paths and timezone for your installation."
          >
            <div className="grid sm:grid-cols-2 gap-4">
              <InputField
                label="Mount Base Directory"
                value={paths.mountBase}
                onChange={(v) => setPaths((p) => ({ ...p, mountBase: v }))}
                placeholder="/mnt/schrodrive"
              />
              <InputField
                label="Config Directory"
                value={paths.configDir}
                onChange={(v) => setPaths((p) => ({ ...p, configDir: v }))}
                placeholder="/home/user/schrodrive/config"
              />
              <InputField
                label="Timezone"
                value={paths.timezone}
                onChange={(v) => setPaths((p) => ({ ...p, timezone: v }))}
                placeholder="Australia/Sydney"
              />
            </div>
          </StepContainer>
        )}

        {/* Step 5: Media Manager — Coming Soon */}
        {activeStep === 5 && (
          <StepContainer
            title="Include Media Manager? — Coming Soon"
            description="Local storage companion with hardware encoding. Not yet available in this release — preview only, will not be emitted in compose."
          >
            <div className="mb-4">
              <Badge variant="outline" className="border-amber-500/40 text-amber-400">Coming Soon</Badge>
            </div>
            <ToggleRow
              label="Enable SchroDrive Media Manager (Preview)"
              description="Preview only — does not generate a service yet. Hardware-encodes with HDR preservation when available."
              enabled={false}
              onToggle={() => {}}
            />

            {mediaManager.enabled && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                className="mt-6 space-y-6"
              >
                {/* Encoder selection */}
                <div>
                  <label className="text-sm font-medium text-white/70 mb-2 block">
                    Encoder Default
                  </label>
                  <div className="flex gap-3">
                    {(['nvenc', 'cpu'] as const).map((enc) => (
                      <button
                        key={enc}
                        onClick={() =>
                          setMediaManager((m) => ({ ...m, encoderDefault: enc }))
                        }
                        className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all duration-200 ${mediaManager.encoderDefault === enc ? 'bg-purple-500/20 border-purple-500/40 text-purple-300' : 'bg-white/5 border-white/10 text-white/50 hover:text-white/80'}`}
                      >
                        {enc === 'nvenc' ? 'NVIDIA NVENC' : 'CPU (x265)'}
                      </button>
                    ))}
                  </div>
                  {mediaManager.encoderDefault === 'nvenc' && (
                    <p className="text-xs text-yellow-400/60 mt-2 flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5" />
                      Requires NVIDIA GPU, drivers, and NVIDIA Container Toolkit.
                    </p>
                  )}
                </div>

                {/* API keys */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <InputField
                    label="Plex Token"
                    value={mediaManager.plexToken}
                    onChange={(v) => setMediaManager((m) => ({ ...m, plexToken: v }))}
                    placeholder="your_plex_token"
                    type="password"
                  />
                  <InputField
                    label="Tautulli API Key"
                    value={mediaManager.tautulliApiKey}
                    onChange={(v) => setMediaManager((m) => ({ ...m, tautulliApiKey: v }))}
                    placeholder="your_tautulli_api_key"
                    type="password"
                  />
                  <InputField
                    label="TMDB API Key"
                    value={mediaManager.tmdbApiKey}
                    onChange={(v) => setMediaManager((m) => ({ ...m, tmdbApiKey: v }))}
                    placeholder="your_tmdb_api_key"
                    type="password"
                  />
                  <InputField
                    label="qBittorrent Host"
                    value={mediaManager.qbitHost}
                    onChange={(v) => setMediaManager((m) => ({ ...m, qbitHost: v }))}
                    placeholder="http://qbittorrent:8080"
                  />
                  <InputField
                    label="qBittorrent Username"
                    value={mediaManager.qbitUsername}
                    onChange={(v) => setMediaManager((m) => ({ ...m, qbitUsername: v }))}
                    placeholder="admin"
                  />
                  <InputField
                    label="qBittorrent Password"
                    value={mediaManager.qbitPassword}
                    onChange={(v) => setMediaManager((m) => ({ ...m, qbitPassword: v }))}
                    placeholder="your_password"
                    type="password"
                  />
                </div>

                {/* Media paths */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <InputField
                    label="Movies Path"
                    value={mediaManager.mediaMovies}
                    onChange={(v) => setMediaManager((m) => ({ ...m, mediaMovies: v }))}
                    placeholder="/mnt/media/movies"
                  />
                  <InputField
                    label="TV Shows Path"
                    value={mediaManager.mediaTv}
                    onChange={(v) => setMediaManager((m) => ({ ...m, mediaTv: v }))}
                    placeholder="/mnt/media/tv"
                  />
                </div>
              </motion.div>
            )}
          </StepContainer>
        )}
      </GlassCard>

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={() => setActiveStep((s) => Math.max(1, s - 1))}
          disabled={activeStep === 1}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white/50 hover:text-white/80 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
        >
          ← Previous
        </button>
        {activeStep < 5 ? (
          <button
            onClick={() => setActiveStep((s) => Math.min(5, s + 1))}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-purple-500/20 border border-purple-500/30 text-purple-300 hover:bg-purple-500/30 transition-all duration-200 flex items-center gap-1.5"
          >
            Next <ChevronRight className="w-4 h-4" />
          </button>
        ) : (
          <div />
        )}
      </div>

      {/* Generated YAML Preview */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold text-white">Generated Configuration</h3>
            <p className="text-sm text-white/40">
              Your custom docker-compose.yml — ready to deploy
            </p>
          </div>
          <div className="flex gap-2">
            <motion.button
              onClick={handleCopy}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-shadow duration-200"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy to Clipboard
                </>
              )}
            </motion.button>
            <motion.button
              onClick={handleDownload}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-white/10 text-white border border-white/20 hover:bg-white/15 backdrop-blur-sm transition-all duration-200"
            >
              <Download className="w-4 h-4" />
              Download .yml
            </motion.button>
          </div>
        </div>

        <CodeBlock language="yaml" filename="docker-compose.yml" showLineNumbers>
          {generatedYaml}
        </CodeBlock>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function StepContainer({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-xl font-bold text-white mb-1">{title}</h3>
      <p className="text-sm text-white/40 mb-6">{description}</p>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  enabled,
  onToggle,
}: {
  label: string;
  description?: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-4 p-3 rounded-xl text-left transition-all duration-200 border ${enabled ? 'bg-purple-500/10 border-purple-500/20' : 'bg-white/[0.02] border-white/5 hover:bg-white/[0.04]'}`}
    >
      {/* Toggle switch */}
      <div
        className={`relative w-10 h-5 rounded-full flex-shrink-0 transition-colors duration-200 ${enabled ? 'bg-purple-500' : 'bg-white/15'}`}
      >
        <motion.div
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
          animate={{ left: enabled ? '22px' : '2px' }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      </div>

      <div className="flex-1 min-w-0">
        <span className={`text-sm font-medium ${enabled ? 'text-white' : 'text-white/60'}`}>
          {label}
        </span>
        {description && (
          <p className="text-xs text-white/30 mt-0.5 truncate">{description}</p>
        )}
      </div>
    </button>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: 'text' | 'password';
}) {
  return (
    <div>
      <label className="text-xs font-medium text-white/50 mb-1.5 block">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white/80 font-mono placeholder:text-white/20 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all duration-200"
      />
    </div>
  );
}
