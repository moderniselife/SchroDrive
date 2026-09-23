'use client';

import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import {
  Globe,
  HardDrive,
  Link,
  Shield,
  LayoutDashboard,
  Container,
} from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import GradientText from '@/components/ui/GradientText';

const features = [
  {
    icon: Globe,
    title: 'Multi-Provider Debrid',
    description:
      '11 providers — RealDebrid, TorBox, AllDebrid, Premiumize, Debrid-Link, Deepbrid, Offcloud, Put.io, MegaDebrid, Seedr & PikPak — with intelligent failover strategies. Never lose a download again.',
    gradient: 'from-purple-500 to-violet-500',
  },
  {
    icon: HardDrive,
    title: 'Virtual FUSE Drives',
    description:
      'rclone WebDAV mounts with a built-in bridge, plus external WebDAV server mounting for third-party sources. All your content appears as local drives on your media server.',
    gradient: 'from-blue-500 to-cyan-500',
  },
  {
    icon: Link,
    title: 'Native *arr Bridge',
    description:
      'Fake qBittorrent API for seamless Radarr/Sonarr integration. Your *arr stack thinks it\'s talking to a torrent client.',
    gradient: 'from-cyan-500 to-teal-500',
  },
  {
    icon: Shield,
    title: 'Self-Healing Engine',
    description:
      '3-phase dead torrent repair, stale mount recovery, and automatic provider failover. SchröDrive fixes itself.',
    gradient: 'from-pink-500 to-rose-500',
  },
  {
    icon: LayoutDashboard,
    title: 'Full Web Dashboard',
    description:
      '10-page Next.js dashboard — overview, content browser, provider management, torrent queue, automation rules, scraper config, mount status, logs & events, settings, and system info.',
    gradient: 'from-amber-500 to-orange-500',
  },
  {
    icon: Container,
    title: 'Single Container',
    description:
      'No PostgreSQL, no Redis, no external dependencies. Just SQLite and a single Docker container. Deploy in seconds.',
    gradient: 'from-emerald-500 to-green-500',
  },
];

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  },
};

export default function FeaturesGrid() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section className="relative z-10 py-24 sm:py-32" ref={ref}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* Section heading */}
        <motion.div
          className="mx-auto max-w-2xl text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl font-bold text-white sm:text-4xl md:text-5xl">
            Everything you need.{' '}
            <GradientText>Nothing you don&apos;t.</GradientText>
          </h2>
          <p className="mt-4 text-lg text-white/50">
            One container, zero compromises. SchröDrive handles the entire
            pipeline from request to playback.
          </p>
        </motion.div>

        {/* Features grid */}
        <motion.div
          className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
          variants={containerVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
        >
          {features.map((feature) => (
            <motion.div key={feature.title} variants={cardVariants}>
              <GlassCard className="relative overflow-hidden p-6 sm:p-8 h-full">
                {/* Gradient top border accent */}
                <div
                  className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${feature.gradient} opacity-60`}
                />

                {/* Icon */}
                <div
                  className={`mb-5 inline-flex rounded-xl bg-gradient-to-br ${feature.gradient} p-3 opacity-80`}
                >
                  <feature.icon className="h-6 w-6 text-white" />
                </div>

                {/* Title */}
                <h3 className="mb-3 text-lg font-semibold text-white">
                  {feature.title}
                </h3>

                {/* Description */}
                <p className="text-sm leading-relaxed text-white/50">
                  {feature.description}
                </p>
              </GlassCard>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
