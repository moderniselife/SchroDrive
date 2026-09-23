'use client';

import { motion, useInView } from 'framer-motion';
import { useRef, useState } from 'react';
import { Copy, Check, ExternalLink, FileCode2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import GradientText from '@/components/ui/GradientText';

const dockerCommand = `docker run -d --name schrodrive \\
  -p 8978:8978 \\
  -e PROVIDERS=torbox,realdebrid \\
  ghcr.io/moderniselife/schrodrive:latest`;

export default function CTABanner() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(dockerCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = dockerCommand;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <section className="relative z-10 py-24 sm:py-32" ref={ref}>
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/30 via-blue-900/20 to-pink-900/10" />
      <div className="absolute inset-0 bg-[#030014]/50" />

      <div className="relative mx-auto max-w-4xl px-4 sm:px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-3xl font-bold text-white sm:text-4xl md:text-5xl mb-6">
            Ready to{' '}
            <GradientText>observe your content</GradientText>?
          </h2>

          {/* Docker command block */}
          <div className="relative mx-auto max-w-2xl mb-10">
            <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-xl overflow-hidden">
              {/* Code header */}
              <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <FileCode2 className="h-4 w-4 text-white/30" />
                  <span className="text-xs font-medium text-white/30">
                    terminal
                  </span>
                </div>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-white/40 transition-all hover:text-white/80 hover:bg-white/5 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-green-400" />
                      <span className="text-green-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy
                    </>
                  )}
                </button>
              </div>

              {/* Code content */}
              <pre className="p-5 text-left overflow-x-auto">
                <code className="text-sm font-mono leading-relaxed">
                  <span className="text-green-400">$</span>{' '}
                  <span className="text-blue-400">docker</span>{' '}
                  <span className="text-white/80">run</span>{' '}
                  <span className="text-yellow-400">-d</span>{' '}
                  <span className="text-yellow-400">--name</span>{' '}
                  <span className="text-pink-400">schrodrive</span>{' '}
                  <span className="text-white/30">\</span>
                  {'\n  '}
                  <span className="text-yellow-400">-p</span>{' '}
                  <span className="text-purple-400">8978:8978</span>{' '}
                  <span className="text-white/30">\</span>
                  {'\n  '}
                  <span className="text-yellow-400">-e</span>{' '}
                  <span className="text-cyan-400">PROVIDERS</span>
                  <span className="text-white/60">=</span>
                  <span className="text-pink-400">torbox,realdebrid</span>{' '}
                  <span className="text-white/30">\</span>
                  {'\n  '}
                  <span className="text-green-300">
                    ghcr.io/moderniselife/schrodrive:latest
                  </span>
                </code>
              </pre>
            </div>
          </div>

          {/* CTA buttons */}
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Button href="/docs" size="lg" variant="primary">
              Read the Docs
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button href="/docs/docker" size="lg" variant="secondary">
              <FileCode2 className="h-5 w-5" />
              Generate Docker Compose
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
