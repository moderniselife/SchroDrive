'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import Badge from '@/components/ui/Badge';

export interface EnvVariable {
  name: string;
  default: string;
  required: boolean;
  description: string;
}

interface EnvTableProps {
  title: string;
  description: string;
  variables: EnvVariable[];
  id?: string;
  defaultCollapsed?: boolean;
}

export default function EnvTable({
  title,
  description,
  variables,
  id,
  defaultCollapsed = false,
}: EnvTableProps) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const filteredVars = useMemo(() => {
    if (!search.trim()) return variables;
    const q = search.toLowerCase();
    return variables.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q)
    );
  }, [variables, search]);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  return (
    <div id={id} className="scroll-mt-24">
      <div className="rounded-xl border border-white/10 bg-white/[0.02] overflow-hidden">
        {/* Header */}
        <button
          onClick={toggleCollapse}
          className="w-full flex items-center justify-between px-6 py-4 bg-white/[0.03] border-b border-white/10 hover:bg-white/[0.05] transition-colors duration-200 text-left"
        >
          <div>
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            <p className="text-sm text-white/50 mt-0.5">{description}</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0 ml-4">
            <span className="text-xs text-white/30 font-mono">
              {variables.length} var{variables.length !== 1 ? 's' : ''}
            </span>
            {collapsed ? (
              <ChevronDown className="w-4 h-4 text-white/40" />
            ) : (
              <ChevronUp className="w-4 h-4 text-white/40" />
            )}
          </div>
        </button>

        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden"
            >
              {/* Search bar */}
              {variables.length > 3 && (
                <div className="px-6 py-3 border-b border-white/5">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Filter variables..."
                      className="w-full pl-10 pr-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white/80 placeholder:text-white/30 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all duration-200"
                    />
                  </div>
                </div>
              )}

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="text-left px-6 py-3 text-xs font-semibold text-white/40 uppercase tracking-wider">
                        Variable
                      </th>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-white/40 uppercase tracking-wider">
                        Default
                      </th>
                      <th className="text-center px-6 py-3 text-xs font-semibold text-white/40 uppercase tracking-wider">
                        Required
                      </th>
                      <th className="text-left px-6 py-3 text-xs font-semibold text-white/40 uppercase tracking-wider">
                        Description
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVars.map((v, i) => (
                      <tr
                        key={v.name}
                        className={`border-b border-white/5 transition-colors duration-150 ${i % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]'} hover:bg-white/[0.04]`}
                      >
                        <td className="px-6 py-3">
                          <code className="text-sm font-mono text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded">
                            {v.name}
                          </code>
                        </td>
                        <td className="px-6 py-3">
                          <code className="text-sm font-mono text-white/50">
                            {v.default || '—'}
                          </code>
                        </td>
                        <td className="px-6 py-3 text-center">
                          {v.required ? (
                            <Badge variant="gradient" className="text-xs">
                              Required
                            </Badge>
                          ) : (
                            <span className="text-xs text-white/30">Optional</span>
                          )}
                        </td>
                        <td className="px-6 py-3 text-sm text-white/60 max-w-md">
                          {v.description}
                        </td>
                      </tr>
                    ))}
                    {filteredVars.length === 0 && (
                      <tr>
                        <td
                          colSpan={4}
                          className="px-6 py-8 text-center text-sm text-white/30"
                        >
                          No variables matching &ldquo;{search}&rdquo;
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
