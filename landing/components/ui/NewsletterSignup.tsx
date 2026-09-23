'use client';

import { useState, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Check, Loader2 } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import GradientText from '@/components/ui/GradientText';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STORAGE_KEY = 'schrodrive-newsletter-emails';

export default function NewsletterSignup({ className = '' }: { className?: string }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }

    if (!EMAIL_REGEX.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }

    setIsSubmitting(true);

    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Store in localStorage as demo
    try {
      const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!existing.includes(email)) {
        existing.push(email);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
      }
    } catch {
      // Storage unavailable — that's fine
    }

    setIsSubmitting(false);
    setIsSuccess(true);
  };

  return (
    <GlassCard
      className={`p-8 md:p-10 ${className}`}
      hoverEffect={false}
      gradientBorder
    >
      <AnimatePresence mode="wait">
        {isSuccess ? (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex flex-col items-center text-center py-4"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15 }}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30 mb-4"
            >
              <Check className="h-8 w-8 text-green-400" />
            </motion.div>
            <h3 className="text-xl font-bold text-white mb-2">
              Wavefunction collapsed!
            </h3>
            <p className="text-white/50 text-sm max-w-sm">
              You&apos;re now entangled with SchröDrive updates. We&apos;ll notify you of
              major releases and features.
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="text-center mb-6">
              <GradientText as="h3" className="text-2xl font-bold mb-2">
                Stay in superposition
              </GradientText>
              <p className="text-white/50 text-sm">
                Get notified of major releases and updates.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-white/30" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (error) setError('');
                  }}
                  placeholder="engineer@example.com"
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-10 py-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/25 transition-all"
                  disabled={isSubmitting}
                  aria-label="Email address"
                />
              </div>
              <motion.button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-3 text-sm font-medium text-white hover:from-purple-500 hover:to-blue-500 shadow-lg shadow-purple-500/25 transition-all disabled:opacity-70 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Collapsing…
                  </>
                ) : (
                  'Subscribe'
                )}
              </motion.button>
            </form>

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 text-xs text-red-400"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <p className="mt-4 text-center text-xs text-white/25">
              We respect your privacy. Unsubscribe any time.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}
