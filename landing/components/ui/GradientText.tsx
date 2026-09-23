'use client';

import { type ReactNode } from 'react';

interface GradientTextProps {
  children: ReactNode;
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'h4' | 'span' | 'p';
}

export default function GradientText({
  children,
  className = '',
  as: Component = 'span',
}: GradientTextProps) {
  return (
    <Component
      className={`bg-gradient-to-r from-purple-400 via-blue-400 to-pink-400 bg-clip-text text-transparent ${className}`}
    >
      {children}
    </Component>
  );
}
