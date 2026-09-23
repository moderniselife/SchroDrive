'use client';

import { useState, useCallback, type ReactNode } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface CodeBlockProps {
  children: string;
  language?: string;
  filename?: string;
  className?: string;
  showLineNumbers?: boolean;
  copyable?: boolean;
}

export default function CodeBlock({
  children,
  language = 'bash',
  filename,
  className = '',
  showLineNumbers = false,
  copyable = true,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(children.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = children.trim();
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [children]);

  const lines = children.trim().split('\n');

  return (
    <div
      className={`relative group rounded-xl overflow-hidden border border-white/10 bg-[#0a0a1a] ${className}`}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.03] border-b border-white/10">
        <div className="flex items-center gap-2">
          {/* Traffic lights */}
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-red-500/60" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
            <div className="w-3 h-3 rounded-full bg-green-500/60" />
          </div>
          {filename && (
            <span className="ml-3 text-sm text-white/40 font-mono">{filename}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/30 font-mono uppercase">{language}</span>
          {copyable && (
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/5 transition-all duration-200"
              aria-label="Copy code"
            >
              <AnimatePresence mode="wait">
                {copied ? (
                  <motion.div
                    key="check"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                  >
                    <Check className="w-4 h-4 text-green-400" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="copy"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                  >
                    <Copy className="w-4 h-4" />
                  </motion.div>
                )}
              </AnimatePresence>
            </button>
          )}
        </div>
      </div>

      {/* Code content */}
      <div className="overflow-x-auto">
        <pre className="p-4 text-sm font-mono leading-relaxed">
          <code>
            {lines.map((line, i) => (
              <div key={i} className="flex">
                {showLineNumbers && (
                  <span className="select-none text-white/20 w-8 flex-shrink-0 text-right mr-4">
                    {i + 1}
                  </span>
                )}
                <span className="text-white/80">{renderLine(line)}</span>
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

/** Simple syntax colouring for common patterns */
function renderLine(line: string): ReactNode {
  // Comment lines
  if (line.trimStart().startsWith('#') || line.trimStart().startsWith('//')) {
    return <span className="text-white/30 italic">{line}</span>;
  }

  // YAML key: value
  if (/^\s*[\w_.-]+:/.test(line)) {
    const colonIndex = line.indexOf(':');
    const key = line.slice(0, colonIndex);
    const rest = line.slice(colonIndex);
    return (
      <>
        <span className="text-purple-400">{key}</span>
        <span className="text-white/50">{rest}</span>
      </>
    );
  }

  // Environment variables (KEY=VALUE)
  if (/^\s*[A-Z_]+=/.test(line)) {
    const eqIndex = line.indexOf('=');
    const key = line.slice(0, eqIndex);
    const rest = line.slice(eqIndex);
    return (
      <>
        <span className="text-blue-400">{key}</span>
        <span className="text-white/50">{rest}</span>
      </>
    );
  }

  // Command lines starting with $
  if (line.trimStart().startsWith('$')) {
    return <span className="text-green-400">{line}</span>;
  }

  return line;
}

/** Inline code component for use in documentation */
export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 rounded-md bg-white/10 text-purple-300 text-sm font-mono border border-white/10">
      {children}
    </code>
  );
}
