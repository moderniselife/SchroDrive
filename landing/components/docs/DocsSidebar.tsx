'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Rocket,
  CheckCircle2,
  Container,
  Server,
  Settings,
  Variable,
  Plug,
  ChevronDown,
  ChevronRight,
  Menu,
  X,
  FileCode2,
  type LucideIcon,
} from 'lucide-react';

interface SidebarSection {
  id: string;
  label: string;
  icon: LucideIcon;
  children?: { id: string; label: string }[];
}

const SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    id: 'quick-start',
    label: 'Quick Start',
    icon: Rocket,
  },
  {
    id: 'prerequisites',
    label: 'Prerequisites',
    icon: CheckCircle2,
  },
  {
    id: 'docker-setup',
    label: 'Docker Setup',
    icon: Container,
    children: [
      { id: 'docker-run', label: 'Docker Run' },
      { id: 'docker-compose', label: 'Docker Compose' },
    ],
  },
  {
    id: 'bare-metal',
    label: 'Bare Metal',
    icon: Server,
    children: [
      { id: 'bun-install', label: 'Install with Bun' },
    ],
  },
  {
    id: 'configuration',
    label: 'Configuration',
    icon: Settings,
    children: [
      { id: 'env-core', label: 'Core Settings' },
      { id: 'env-debrid', label: 'Debrid Providers' },
      { id: 'env-indexers', label: 'Indexers' },
      { id: 'env-overseerr', label: 'Seerr' },
      { id: 'env-media-servers', label: 'Media Servers' },
      { id: 'env-mount', label: 'Mount & WebDAV' },
      { id: 'env-services', label: 'Service Toggles' },
      { id: 'env-arr-bridge', label: '*arr Bridge' },
      { id: 'env-download-tokens', label: 'Download Tokens' },
    ],
  },
  {
    id: 'environment-variables',
    label: 'Environment Variables',
    icon: Variable,
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: Plug,
  },
  {
    id: 'verify-installation',
    label: 'Verify Installation',
    icon: CheckCircle2,
  },
];

export default function DocsSidebar() {
  const [activeSection, setActiveSection] = useState('quick-start');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['configuration', 'docker-setup'])
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  // Track active section based on scroll position
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 }
    );

    // Observe all sections
    const allIds = SIDEBAR_SECTIONS.flatMap((s) => [
      s.id,
      ...(s.children?.map((c) => c.id) ?? []),
    ]);

    for (const id of allIds) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, []);

  const toggleSection = useCallback((id: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleNavClick = useCallback(
    (id: string) => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActiveSection(id);
      }
      setMobileOpen(false);
    },
    []
  );

  const sidebarContent = (
    <nav className="space-y-1">
      {SIDEBAR_SECTIONS.map((section) => {
        const Icon = section.icon;
        const isActive = activeSection === section.id;
        const isExpanded = expandedSections.has(section.id);
        const hasChildren = section.children && section.children.length > 0;

        return (
          <div key={section.id}>
            <button
              onClick={() => {
                if (hasChildren) {
                  toggleSection(section.id);
                }
                handleNavClick(section.id);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${isActive ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'text-white/60 hover:text-white/90 hover:bg-white/5'}`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 text-left">{section.label}</span>
              {hasChildren && (
                <motion.div
                  animate={{ rotate: isExpanded ? 0 : -90 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown className="w-3.5 h-3.5 text-white/40" />
                </motion.div>
              )}
            </button>

            {/* Collapsible children */}
            <AnimatePresence>
              {hasChildren && isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="ml-7 mt-1 space-y-0.5 border-l border-white/10 pl-3">
                    {section.children!.map((child) => {
                      const isChildActive = activeSection === child.id;
                      return (
                        <button
                          key={child.id}
                          onClick={() => handleNavClick(child.id)}
                          className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-all duration-200 ${isChildActive ? 'text-purple-300 bg-purple-500/10' : 'text-white/40 hover:text-white/70 hover:bg-white/5'}`}
                        >
                          {child.label}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {/* Docker Generator link */}
      <div className="pt-4 mt-4 border-t border-white/10">
        <a
          href="/docs/docker"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium bg-gradient-to-r from-purple-500/10 to-blue-500/10 text-purple-300 border border-purple-500/20 hover:border-purple-500/40 transition-all duration-200 hover:from-purple-500/20 hover:to-blue-500/20"
        >
          <FileCode2 className="w-4 h-4" />
          <span>Docker Compose Generator</span>
          <ChevronRight className="w-3.5 h-3.5 ml-auto" />
        </a>
      </div>
    </nav>
  );

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed bottom-6 right-6 z-40 p-3 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 transition-all duration-200"
        aria-label="Open documentation menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile drawer overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          >
            <motion.div
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="absolute left-0 top-0 bottom-0 w-80 p-6 overflow-y-auto bg-[#0a0a1a]/95 backdrop-blur-xl border-r border-white/10"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-white">Documentation</h3>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="p-1.5 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/5"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {sidebarContent}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <aside className="hidden lg:block w-64 flex-shrink-0">
        <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-xl backdrop-blur-xl bg-white/5 border border-white/10 p-4 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
          {sidebarContent}
        </div>
      </aside>
    </>
  );
}
