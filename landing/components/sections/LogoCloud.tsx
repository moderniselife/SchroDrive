'use client';

import { motion } from 'framer-motion';
import { useRef } from 'react';
import AnimatedSection, { AnimatedChild } from '@/components/ui/AnimatedSection';

const integrations = [
  { name: 'Plex', color: '#E5A00D' },
  { name: 'Jellyfin', color: '#00A4DC' },
  { name: 'Emby', color: '#52B54B' },
  { name: 'Seerr', color: '#7B68EE' },
  { name: 'Radarr', color: '#FFC230' },
  { name: 'Sonarr', color: '#00BFFF' },
  { name: 'Prowlarr', color: '#FF6347' },
  { name: 'Jackett', color: '#C62828' },
  { name: 'Trakt', color: '#ED1C24' },
  { name: 'Stremio', color: '#8A5EBC' },
];

// Double the items for seamless looping
const doubledIntegrations = [...integrations, ...integrations];

export default function LogoCloud() {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <section className="relative z-10 overflow-hidden py-20 sm:py-24">
      <AnimatedSection className="mx-auto max-w-7xl px-4">
        <AnimatedChild>
          <p className="text-center text-sm font-medium uppercase tracking-[0.2em] text-white/40 mb-12">
            Works with your entire stack
          </p>
        </AnimatedChild>
      </AnimatedSection>

      {/* Infinite scroll container */}
      <div className="relative" ref={containerRef}>
        {/* Fade edges */}
        <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-24 bg-gradient-to-r from-[#030014] to-transparent" />
        <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-24 bg-gradient-to-l from-[#030014] to-transparent" />

        <motion.div
          className="flex gap-8 py-4"
          animate={{
            x: ['0%', '-50%'],
          }}
          transition={{
            x: {
              repeat: Infinity,
              repeatType: 'loop',
              duration: 30,
              ease: 'linear',
            },
          }}
        >
          {doubledIntegrations.map((integration, index) => (
            <div
              key={`${integration.name}-${index}`}
              className="group flex-shrink-0"
            >
              <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-6 py-3 transition-all duration-300 hover:border-white/20 hover:bg-white/[0.06]">
                {/* Coloured dot indicator */}
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full opacity-40 transition-opacity duration-300 group-hover:opacity-100"
                  style={{ backgroundColor: integration.color }}
                />
                <span className="whitespace-nowrap text-base font-medium text-white/40 transition-colors duration-300 group-hover:text-white/90">
                  {integration.name}
                </span>
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
