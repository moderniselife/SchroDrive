'use client';

import { motion } from 'framer-motion';
import {
  Box,
  Shield,
  Zap,
  Heart,
  ExternalLink,
  Database,
  Layers,
  RefreshCw,
  FileCode,
  Container,
  Cpu,
  Server,
  Film,
  HardDrive,
  Globe,
} from 'lucide-react';
import GitHubIcon from '@/components/ui/GitHubIcon';
import GradientText from '@/components/ui/GradientText';
import GlassCard from '@/components/ui/GlassCard';
import AnimatedSection, { AnimatedChild } from '@/components/ui/AnimatedSection';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';

import { GitHubStatsBar } from '@/components/ui/GitHubStats';
import NewsletterSignup from '@/components/ui/NewsletterSignup';

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const philosophyItems = [
  {
    icon: Container,
    title: 'Single container, zero external databases',
    description:
      'One Docker image. No PostgreSQL, no Redis, no message queues. SQLite with WAL journalling keeps everything self-contained and crash-safe.',
  },
  {
    icon: Layers,
    title: 'Provider-agnostic by design',
    description:
      'TorBox, RealDebrid, AllDebrid, Premiumize, Debrid-Link, Deepbrid, Offcloud, Put.io, MegaDebrid, Seedr, PikPak — swap, combine, or run them all. Every provider implements the same interface; adding a new one is a single file.',
  },
  {
    icon: Shield,
    title: 'Safety-first',
    description:
      'Read-only FUSE mounts. Partial writes with atomic renames. Confirmation modals before destructive actions. Your media is treated with care.',
  },
  {
    icon: RefreshCw,
    title: 'Self-healing',
    description:
      '3-phase torrent repair (same-provider → cross-provider → replace). Stale mount recovery. Pre-emptive repair for stalling torrents. Mount health monitoring with auto-remount.',
  },
  {
    icon: Heart,
    title: 'Open source · MIT',
    description:
      'Built in the open, licensed under MIT. Contributions welcome. No telemetry, no tracking, no premium tiers.',
  },
];

const techStackItems = [
  { icon: Zap, label: 'Bun', colour: 'text-amber-400' },
  { icon: FileCode, label: 'TypeScript', colour: 'text-blue-400' },
  { icon: Server, label: 'Hono', colour: 'text-orange-400' },
  { icon: Globe, label: 'Next.js', colour: 'text-white' },
  { icon: Box, label: 'React 19', colour: 'text-cyan-400' },
  { icon: Database, label: 'SQLite', colour: 'text-sky-400' },
  { icon: Film, label: 'FFmpeg', colour: 'text-green-400' },
  { icon: HardDrive, label: 'rclone', colour: 'text-purple-400' },
  { icon: Container, label: 'Docker', colour: 'text-blue-500' },
  { icon: Cpu, label: 'NVENC', colour: 'text-lime-400' },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.2,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  },
};

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-[#030014] text-white">

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-4 text-center overflow-hidden">
        {/* Background glows */}
        <div className="absolute top-10 left-1/4 w-[500px] h-[400px] bg-purple-600/8 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-20 right-1/4 w-[400px] h-[300px] bg-blue-600/8 rounded-full blur-3xl pointer-events-none" />

        <AnimatedSection className="mx-auto max-w-4xl relative z-10">
          <AnimatedChild>
            <GradientText as="h1" className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight">
              About SchröDrive
            </GradientText>
          </AnimatedChild>
          <AnimatedChild>
            <p className="mt-6 text-xl sm:text-2xl text-white/50">
              Born from frustration. Built with obsession.
            </p>
          </AnimatedChild>
          <AnimatedChild>
            <div className="mt-8">
              <GitHubStatsBar />
            </div>
          </AnimatedChild>
        </AnimatedSection>
      </section>

      {/* Origin Story */}
      <section className="px-4 pb-24">
        <AnimatedSection className="mx-auto max-w-4xl">
          <AnimatedChild>
            <GlassCard className="p-8 md:p-12" hoverEffect={false}>
              <div className="space-y-8">
                {/* Quantum Physics Name */}
                <div>
                  <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-3">
                    <span className="text-3xl">🐱</span>
                    The Quantum Physics Name
                  </h2>
                  <p className="text-white/60 leading-relaxed text-lg">
                    In quantum mechanics, Schrödinger&apos;s cat exists in superposition —
                    simultaneously alive and dead — until observed. Your debrid-cached media
                    works the same way: it exists{' '}
                    <GradientText className="font-semibold">everywhere and nowhere</GradientText>{' '}
                    across the cloud, simultaneously available and ephemeral, until SchröDrive
                    observes it and collapses it into a concrete, streamable file on your local drive.
                  </p>
                </div>

                {/* Divider */}
                <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                {/* Why it was built */}
                <div>
                  <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-3">
                    <span className="text-3xl">⚡</span>
                    Why It Was Built
                  </h2>
                  <p className="text-white/60 leading-relaxed mb-4">
                    Before SchröDrive, you needed a fragmented toolchain just to get debrid media
                    working:{' '}
                    <span className="text-white/80 font-medium">
                      pd_zurg + Zurg + Decypharr + RDT-Client
                    </span>{' '}
                    + separate databases + separate configuration files + hope that the pieces
                    wouldn&apos;t fall apart at 2am when your family wants to watch a film.
                  </p>
                  <p className="text-white/60 leading-relaxed">
                    SchröDrive consolidates{' '}
                    <span className="text-white/80 font-medium">everything</span> into a single
                    container. One config. One log. One thing to debug. Zero external databases.
                    It was built by someone who got tired of duct-taping tools together and
                    decided to write something that just <em>works</em>.
                  </p>
                </div>

                {/* Divider */}
                <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />

                {/* Australian-built */}
                <div className="flex items-start gap-4">
                  <span className="text-3xl">🇦🇺</span>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1">Australian-built. Open-source. MIT licenced.</h3>
                    <p className="text-white/50 text-sm leading-relaxed">
                      Designed and maintained in Australia. We spell it &ldquo;colour&rdquo; and
                      &ldquo;organise&rdquo; and we won&apos;t apologise for it. The entire codebase is
                      MIT-licenced — use it however you like.
                    </p>
                  </div>
                </div>
              </div>
            </GlassCard>
          </AnimatedChild>
        </AnimatedSection>
      </section>

      {/* The Schrödinger's Copy Stack */}
      <section className="px-4 pb-24">
        <AnimatedSection className="mx-auto max-w-5xl">
          <AnimatedChild>
            <div className="text-center mb-12">
              <Badge variant="gradient" className="mb-4">
                <span className="inline-block h-2 w-2 rounded-full bg-purple-400 animate-pulse" />
                The Schrödinger&apos;s Copy Stack
              </Badge>
              <GradientText as="h2" className="text-3xl sm:text-4xl font-bold">
                Two tools. Complete media management.
              </GradientText>
            </div>
          </AnimatedChild>

          <div className="grid md:grid-cols-2 gap-6">
            <AnimatedChild>
              <GlassCard className="p-8 h-full" gradientBorder>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/20 border border-purple-500/20">
                    <Zap className="h-5 w-5 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">SchröDrive Core</h3>
                    <p className="text-xs text-purple-400 font-medium uppercase tracking-wider">The Orchestrator</p>
                  </div>
                </div>
                <p className="text-white/50 leading-relaxed text-sm">
                  Connects Seerr → Prowlarr/Jackett → debrid services → rclone FUSE mounts →
                  Plex/Jellyfin/Emby. Handles torrent lifecycle, self-healing mounts, multi-provider
                  token rotation, watchlist polling, and a native *arr bridge — all in a single container.
                </p>
              </GlassCard>
            </AnimatedChild>

            <AnimatedChild>
              <GlassCard className="p-8 h-full" gradientBorder>
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/20 border border-blue-500/20">
                    <HardDrive className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Media Manager</h3>
                    <p className="text-xs text-blue-400 font-medium uppercase tracking-wider">The Preserver</p>
                  </div>
                </div>
                <p className="text-white/50 leading-relaxed text-sm">
                  Discovers popular cloud-streamed media, downloads it locally, hardware-encodes
                  (NVIDIA NVENC / CPU x265) with HDR preservation, and organises it into permanent
                  local libraries. Uses Tautulli watch stats to intelligently suggest what to preserve.
                </p>
              </GlassCard>
            </AnimatedChild>
          </div>

          <AnimatedChild>
            <div className="mt-8 text-center">
              <GlassCard className="inline-block px-6 py-3" hoverEffect={false}>
                <p className="text-sm text-white/50">
                  <span className="text-white/70 font-medium">The quantum metaphor:</span>{' '}
                  Your media exists in superposition (cloud/local, cached/streamed, everywhere/nowhere)
                  — until SchröDrive observes it.
                </p>
              </GlassCard>
            </div>
          </AnimatedChild>
        </AnimatedSection>
      </section>

      {/* Philosophy */}
      <section className="px-4 pb-24">
        <AnimatedSection className="mx-auto max-w-5xl">
          <AnimatedChild>
            <div className="text-center mb-12">
              <GradientText as="h2" className="text-3xl sm:text-4xl font-bold">
                Design Philosophy
              </GradientText>
              <p className="mt-3 text-white/40 text-lg">
                Principles that guide every line of code.
              </p>
            </div>
          </AnimatedChild>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {philosophyItems.map((item) => (
              <AnimatedChild key={item.title}>
                <GlassCard className="p-6 h-full">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-white/10 mb-4">
                    <item.icon className="h-5 w-5 text-purple-400" />
                  </div>
                  <h3 className="text-base font-semibold text-white mb-2">{item.title}</h3>
                  <p className="text-sm text-white/45 leading-relaxed">{item.description}</p>
                </GlassCard>
              </AnimatedChild>
            ))}
          </div>
        </AnimatedSection>
      </section>

      {/* Tech Stack */}
      <section className="px-4 pb-24">
        <AnimatedSection className="mx-auto max-w-4xl">
          <AnimatedChild>
            <div className="text-center mb-12">
              <GradientText as="h2" className="text-3xl sm:text-4xl font-bold">
                Built With
              </GradientText>
            </div>
          </AnimatedChild>

          <motion.div
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4"
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-100px' }}
          >
            {techStackItems.map((tech) => (
              <motion.div
                key={tech.label}
                variants={itemVariants}
                className="flex flex-col items-center gap-2.5 rounded-2xl backdrop-blur-xl bg-white/[0.03] border border-white/10 p-5 hover:bg-white/[0.07] transition-colors duration-300"
              >
                <tech.icon className={`h-7 w-7 ${tech.colour}`} />
                <span className="text-sm font-medium text-white/70">{tech.label}</span>
              </motion.div>
            ))}
          </motion.div>
        </AnimatedSection>
      </section>

      {/* Contributing */}
      <section className="px-4 pb-24">
        <AnimatedSection className="mx-auto max-w-3xl">
          <AnimatedChild>
            <GlassCard className="p-8 md:p-12 text-center" hoverEffect={false} gradientBorder>
              <GitHubIcon className="h-10 w-10 text-white/30 mx-auto mb-4" />
              <GradientText as="h2" className="text-3xl font-bold mb-3">
                Contribute
              </GradientText>
              <p className="text-white/50 leading-relaxed mb-6 max-w-lg mx-auto">
                SchröDrive is open-source and actively developed. Want to add a new debrid provider?
                It&apos;s a single file implementing the <code className="text-purple-400 text-sm bg-purple-500/10 px-1.5 py-0.5 rounded">DebridProvider</code> interface.
                Found a bug? Open an issue. Have an idea? Start a discussion.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Button
                  href="https://github.com/moderniselife/SchroDrive"
                  variant="primary"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <GitHubIcon className="h-4 w-4" />
                  View Repository
                </Button>
                <Button
                  href="https://github.com/moderniselife/SchroDrive/issues"
                  variant="secondary"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4" />
                  Issue Tracker
                </Button>
              </div>
            </GlassCard>
          </AnimatedChild>
        </AnimatedSection>
      </section>

      {/* Newsletter */}
      <section className="px-4 pb-24">
        <div className="mx-auto max-w-xl">
          <NewsletterSignup />
        </div>
      </section>
    </div>
  );
}
