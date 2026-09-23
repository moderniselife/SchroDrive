'use client';

import { motion, useInView, animate } from 'framer-motion';
import { useRef, useEffect, useState } from 'react';

const stats = [
  { value: 11, label: 'Debrid Providers' },
  { value: 6, label: 'Watchlist Sources' },
  { value: 4, label: 'Stremio Scrapers' },
  { value: 1, label: 'Container Required' },
  { value: 0, label: 'External Databases' },
];

function AnimatedNumber({ value, isInView }: { value: number; isInView: boolean }) {
  const [displayValue, setDisplayValue] = useState(0);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (isInView && !hasAnimated.current) {
      hasAnimated.current = true;
      const controls = animate(0, value, {
        duration: 1.5,
        ease: [0.22, 1, 0.36, 1] as const,
        onUpdate(latest) {
          setDisplayValue(Math.round(latest));
        },
      });
      return () => controls.stop();
    }
  }, [isInView, value]);

  return <span>{displayValue}</span>;
}

export default function StatsCounter() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });

  return (
    <section className="relative z-10 py-20" ref={ref}>
      {/* Gradient background band */}
      <div className="absolute inset-0 bg-gradient-to-r from-purple-900/20 via-blue-900/20 to-pink-900/20" />
      <div className="absolute inset-0 border-y border-white/5" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((stat, index) => (
            <motion.div
              key={stat.label}
              className="text-center"
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{
                duration: 0.5,
                delay: index * 0.1,
                ease: [0.22, 1, 0.36, 1] as const,
              }}
            >
              <p className="text-4xl font-bold text-white sm:text-5xl md:text-6xl">
                <AnimatedNumber value={stat.value} isInView={isInView} />
              </p>
              <p className="mt-2 text-sm font-medium text-white/40">
                {stat.label}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
