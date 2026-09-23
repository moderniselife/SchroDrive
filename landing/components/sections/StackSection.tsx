'use client';

import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { Zap, Database, ArrowRight, ExternalLink } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import GradientText from '@/components/ui/GradientText';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';

const products = [
  {
    icon: Zap,
    name: 'SchröDrive',
    subtitle: 'The Orchestrator',
    description:
      'Automates media requests, searches indexers, submits to debrid providers, mounts as virtual drives, and serves content to your media servers. The brain of the operation.',
    stats: ['11 providers', '6 watchlist sources', '4 scrapers'],
    version: 'v0.11.2',
    gradient: 'from-purple-500 to-blue-500',
    link: 'https://github.com/moderniselife/SchroDrive',
  },
  {
    icon: Database,
    name: 'SchroDrive Media Manager',
    subtitle: 'The Preserver',
    description:
      'Monitors what you watch, downloads popular cloud content locally, hardware-encodes with HDR preservation, and organises it into permanent local libraries.',
    stats: ['NVIDIA NVENC', 'Tautulli sync', 'Plex integration'],
    version: 'v0.1.0',
    gradient: 'from-blue-500 to-pink-500',
    link: 'https://github.com/moderniselife/ContentManager',
  },
];

export default function StackSection() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section className="relative z-10 py-24 sm:py-32" ref={ref}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* Section heading */}
        <motion.div
          className="mx-auto max-w-3xl text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl font-bold text-white sm:text-4xl md:text-5xl">
            <GradientText>The Schrödinger&apos;s Copy Stack</GradientText>
          </h2>
          <p className="mt-4 text-lg text-white/50">
            Two tools. One quantum leap for your media.
          </p>
        </motion.div>

        {/* Product cards */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {products.map((product, index) => (
            <motion.div
              key={product.name}
              initial={{ opacity: 0, y: 40 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{
                duration: 0.6,
                delay: index * 0.2,
                ease: [0.22, 1, 0.36, 1] as const,
              }}
            >
              <GlassCard className="relative overflow-hidden p-8 h-full">
                {/* Gradient top border */}
                <div
                  className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${product.gradient}`}
                />

                {/* Header */}
                <div className="flex items-start justify-between mb-6">
                  <div
                    className={`inline-flex rounded-xl bg-gradient-to-br ${product.gradient} p-3 opacity-80`}
                  >
                    <product.icon className="h-7 w-7 text-white" />
                  </div>
                  <Badge variant="outline">{product.version}</Badge>
                </div>

                {/* Title */}
                <h3 className="text-2xl font-bold text-white mb-1">
                  {product.name}
                </h3>
                <p className="text-sm font-medium text-white/40 mb-4">
                  {product.subtitle}
                </p>

                {/* Description */}
                <p className="text-sm leading-relaxed text-white/50 mb-6">
                  {product.description}
                </p>

                {/* Stats */}
                <div className="flex flex-wrap gap-2 mb-6">
                  {product.stats.map((stat) => (
                    <Badge key={stat} variant="default">
                      {stat}
                    </Badge>
                  ))}
                </div>

                {/* Link */}
                <Button
                  href={product.link}
                  variant="ghost"
                  size="sm"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on GitHub
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </GlassCard>
            </motion.div>
          ))}
        </div>

        {/* Connector / data flow */}
        <motion.div
          className="mt-12 flex flex-col items-center"
          initial={{ opacity: 0 }}
          animate={isInView ? { opacity: 1 } : {}}
          transition={{ duration: 0.8, delay: 0.6 }}
        >
          {/* Flow graphic */}
          <div className="flex items-center gap-4 mb-8">
            <div className="flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-4 py-2">
              <Zap className="h-4 w-4 text-purple-400" />
              <span className="text-sm font-medium text-purple-300">
                Cloud Stream
              </span>
            </div>
            <motion.div
              animate={{ x: [0, 8, 0] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
            >
              <ArrowRight className="h-5 w-5 text-white/30" />
            </motion.div>
            <div className="flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-2">
              <span className="text-sm text-blue-300">🔬 Superposition</span>
            </div>
            <motion.div
              animate={{ x: [0, 8, 0] }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: 0.3,
              }}
            >
              <ArrowRight className="h-5 w-5 text-white/30" />
            </motion.div>
            <div className="flex items-center gap-2 rounded-full border border-pink-500/30 bg-pink-500/10 px-4 py-2">
              <Database className="h-4 w-4 text-pink-400" />
              <span className="text-sm font-medium text-pink-300">
                Local Permanence
              </span>
            </div>
          </div>

          {/* Quantum quote */}
          <p className="max-w-2xl text-center text-sm leading-relaxed text-white/40 italic">
            &ldquo;Together, your media exists in perfect superposition — streamed from the cloud until it&apos;s popular enough to collapse into local permanence.&rdquo;
          </p>
        </motion.div>
      </div>
    </section>
  );
}
