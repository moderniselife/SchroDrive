'use client';

import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import GlassCard from '@/components/ui/GlassCard';
import GradientText from '@/components/ui/GradientText';

const steps = [
  {
    label: 'Seerr',
    description: 'Request',
    emoji: '🎬',
  },
  {
    label: 'SchröDrive',
    description: 'Orchestrate',
    emoji: '⚡',
  },
  {
    label: 'Prowlarr',
    description: 'Index',
    emoji: '🔍',
  },
  {
    label: '11 Debrid Providers',
    description: 'Cache',
    emoji: '☁️',
  },
  {
    label: 'rclone Mount',
    description: 'Mount',
    emoji: '💽',
  },
  {
    label: 'Media Server',
    description: 'Play',
    emoji: '📺',
  },
];

export default function ArchitectureFlow() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });

  return (
    <section className="relative z-10 py-24 sm:py-32 overflow-hidden" ref={ref}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        {/* Section heading */}
        <motion.div
          className="mx-auto max-w-2xl text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl font-bold text-white sm:text-4xl md:text-5xl">
            From request to playback —{' '}
            <GradientText>fully automated</GradientText>
          </h2>
        </motion.div>

        {/* Pipeline */}
        <div className="relative">
          {/* Mobile: vertical layout */}
          <div className="flex flex-col gap-4 lg:hidden">
            {steps.map((step, index) => (
              <motion.div
                key={step.label}
                initial={{ opacity: 0, x: -30 }}
                animate={isInView ? { opacity: 1, x: 0 } : {}}
                transition={{
                  duration: 0.5,
                  delay: index * 0.15,
                  ease: [0.22, 1, 0.36, 1] as const,
                }}
              >
                <div className="flex items-center gap-4">
                  <GlassCard className="flex-1 p-4 flex items-center gap-4">
                    <span className="text-2xl">{step.emoji}</span>
                    <div>
                      <p className="font-semibold text-white text-sm">
                        {step.label}
                      </p>
                      <p className="text-xs text-white/40">{step.description}</p>
                    </div>
                  </GlassCard>
                  {index < steps.length - 1 && (
                    <div className="flex flex-col items-center">
                      <motion.div
                        className="w-[2px] h-6 bg-gradient-to-b from-purple-500/60 to-blue-500/60"
                        initial={{ scaleY: 0 }}
                        animate={isInView ? { scaleY: 1 } : {}}
                        transition={{
                          duration: 0.3,
                          delay: index * 0.15 + 0.3,
                        }}
                      />
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          {/* Desktop: horizontal layout with SVG connectors */}
          <div className="hidden lg:block">
            <div className="relative flex items-center justify-between">
              {/* SVG connecting lines */}
              <svg
                className="absolute inset-0 w-full h-full pointer-events-none"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient
                    id="lineGradient"
                    x1="0%"
                    y1="0%"
                    x2="100%"
                    y2="0%"
                  >
                    <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.6" />
                    <stop offset="50%" stopColor="#3b82f6" stopOpacity="0.6" />
                    <stop offset="100%" stopColor="#f472b6" stopOpacity="0.6" />
                  </linearGradient>
                </defs>
                <motion.line
                  x1="8%"
                  y1="50%"
                  x2="92%"
                  y2="50%"
                  stroke="url(#lineGradient)"
                  strokeWidth="2"
                  strokeDasharray="8 4"
                  initial={{ pathLength: 0 }}
                  animate={isInView ? { pathLength: 1 } : {}}
                  transition={{ duration: 1.5, delay: 0.3, ease: 'easeInOut' }}
                />
              </svg>

              {steps.map((step, index) => (
                <motion.div
                  key={step.label}
                  className="relative z-10 flex-1 px-2"
                  initial={{ opacity: 0, y: 30 }}
                  animate={isInView ? { opacity: 1, y: 0 } : {}}
                  transition={{
                    duration: 0.5,
                    delay: index * 0.15,
                    ease: [0.22, 1, 0.36, 1] as const,
                  }}
                >
                  <GlassCard className="p-5 text-center" hoverEffect>
                    <div className="mb-3 text-3xl">{step.emoji}</div>
                    <p className="font-semibold text-white text-sm mb-1">
                      {step.label}
                    </p>
                    <p className="text-xs text-white/40">{step.description}</p>
                  </GlassCard>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
