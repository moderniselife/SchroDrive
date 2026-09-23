'use client';

import { motion, type HTMLMotionProps } from 'framer-motion';
import { type ReactNode } from 'react';

interface GlassCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode;
  className?: string;
  hoverEffect?: boolean;
  gradientBorder?: boolean;
}

export default function GlassCard({
  children,
  className = '',
  hoverEffect = true,
  gradientBorder = false,
  ...props
}: GlassCardProps) {
  return (
    <motion.div
      className={`relative rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10 ${hoverEffect ? 'transition-all duration-300 hover:bg-white/[0.08] hover:border-white/20' : ''} ${gradientBorder ? 'before:absolute before:inset-0 before:rounded-2xl before:p-[1px] before:bg-gradient-to-r before:from-purple-500/50 before:via-blue-500/50 before:to-pink-500/50 before:-z-10' : ''} ${className}`.trim()}
      {...props}
    >
      {children}
    </motion.div>
  );
}
