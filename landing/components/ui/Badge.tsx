'use client';

import { type ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'gradient' | 'outline';
}

export default function Badge({
  children,
  className = '',
  variant = 'default',
}: BadgeProps) {
  const variantStyles = {
    default: 'bg-white/10 text-white/80 border border-white/10',
    gradient:
      'bg-gradient-to-r from-purple-500/20 via-blue-500/20 to-pink-500/20 text-white/90 border border-purple-500/30',
    outline: 'border border-white/20 text-white/70',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium backdrop-blur-sm ${variantStyles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
