'use client';

import { motion } from 'framer-motion';
import { ChevronDown, ExternalLink } from 'lucide-react';
import GitHubIcon from '@/components/ui/GitHubIcon';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import GradientText from '@/components/ui/GradientText';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.3,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1] as const,
    },
  },
};

export default function HeroSection() {
  return (
    <section className="relative z-10 flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <motion.div
        className="mx-auto max-w-4xl"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {/* Badge */}
        <motion.div variants={itemVariants}>
          <Badge variant="gradient" className="mb-8">
            <span className="inline-block h-2 w-2 rounded-full bg-purple-400 animate-pulse" />
            Part of the Schrödinger&apos;s Copy stack
          </Badge>
        </motion.div>

        {/* Main Heading */}
        <motion.h1
          variants={itemVariants}
          className="text-5xl font-bold leading-tight tracking-tight sm:text-6xl md:text-7xl lg:text-8xl"
        >
          <GradientText as="span" className="block">
            Your content exists
          </GradientText>
          <span className="block text-white">
            everywhere and nowhere
          </span>
        </motion.h1>

        {/* Subheading */}
        <motion.p
          variants={itemVariants}
          className="mt-6 text-xl text-white/60 sm:text-2xl md:text-3xl"
        >
          — until <span className="text-white font-medium">SchröDrive</span>{' '}
          observes it.
        </motion.p>

        {/* Description */}
        <motion.p
          variants={itemVariants}
          className="mx-auto mt-8 max-w-2xl text-base leading-relaxed text-white/50 sm:text-lg"
        >
          The ultimate media automation orchestrator for debrid services.
          Connect your requests, indexers, and providers into a single
          self-healing pipeline — from Seerr to your media server,
          fully automated in one container.
        </motion.p>

        {/* CTA Buttons */}
        <motion.div
          variants={itemVariants}
          className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center"
        >
          <Button href="/docs" size="lg" variant="primary">
            Get Started
            <ExternalLink className="h-4 w-4" />
          </Button>
          <Button
            href="https://github.com/moderniselife/SchroDrive"
            size="lg"
            variant="secondary"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GitHubIcon className="h-5 w-5" />
            View on GitHub
          </Button>
        </motion.div>
      </motion.div>

      {/* Scroll Indicator */}
      <motion.div
        className="absolute bottom-8 left-1/2 -translate-x-1/2"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.5, duration: 0.6 }}
      >
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          className="flex flex-col items-center gap-2"
        >
          <span className="text-xs font-medium uppercase tracking-widest text-white/30">
            Scroll
          </span>
          <ChevronDown className="h-5 w-5 text-white/30" />
        </motion.div>
      </motion.div>
    </section>
  );
}
