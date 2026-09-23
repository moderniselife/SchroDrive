'use client';

import Link from 'next/link';
import { Heart } from 'lucide-react';
import GitHubIcon from '@/components/ui/GitHubIcon';
import GradientText from '@/components/ui/GradientText';

const footerLinks = {
  Product: [
    { label: 'Features', href: '/features' },
    { label: 'Docker Generator', href: '/docs/docker' },
    { label: 'Compare', href: '/compare' },
    { label: 'Changelog', href: '/changelog' },
    { label: 'About', href: '/about' },
  ],
  Resources: [
    { label: 'Documentation', href: '/docs' },
    { label: 'Getting Started', href: '/docs' },
    { label: 'Configuration', href: '/docs#config' },
    { label: 'API Reference', href: '/docs#api' },
  ],
  Community: [
    { label: 'GitHub', href: 'https://github.com/moderniselife/SchroDrive', external: true },
    { label: 'Issues', href: 'https://github.com/moderniselife/SchroDrive/issues', external: true },
    { label: 'Discussions', href: 'https://github.com/moderniselife/SchroDrive/discussions', external: true },
    { label: 'Contributing', href: 'https://github.com/moderniselife/SchroDrive/blob/main/CONTRIBUTING.md', external: true },
  ],
  Legal: [
    { label: 'MIT Licence', href: 'https://github.com/moderniselife/SchroDrive/blob/main/LICENSE', external: true },
    { label: 'Privacy', href: '/privacy' },
  ],
};

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="relative mt-auto border-t border-white/5">
      {/* Gradient divider */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-3/4 bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />

      <div className="mx-auto max-w-7xl px-6 py-16">
        {/* Footer Grid */}
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-white/40 mb-4">
                {category}
              </h3>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.label}>
                    {'external' in link && link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-white/50 hover:text-white/80 transition-colors duration-200"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-white/50 hover:text-white/80 transition-colors duration-200"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom Bar */}
        <div className="mt-16 flex flex-col items-center gap-6 border-t border-white/5 pt-8 sm:flex-row sm:justify-between">
          {/* Brand */}
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-purple-600 to-blue-600 text-white font-bold text-xs">
              S
            </div>
            <GradientText className="text-sm font-semibold">SchröDrive</GradientText>
          </div>

          {/* Copyright */}
          <p className="flex items-center gap-1.5 text-xs text-white/30">
            © {currentYear} SchröDrive. Built with
            <Heart className="h-3 w-3 text-pink-400 fill-pink-400" />
            in Australia.
          </p>

          {/* Social */}
          <a
            href="https://github.com/moderniselife/SchroDrive"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-white/30 hover:text-white/60 transition-colors"
          >
            <GitHubIcon className="h-4 w-4" />
            Open Source · MIT
          </a>
        </div>
      </div>
    </footer>
  );
}
