'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, useSpring, useTransform } from 'framer-motion';
import { Star, GitFork, CircleDot } from 'lucide-react';

interface GitHubData {
  stars: number;
  forks: number;
  openIssues: number;
  fetchedAt: number;
}

const CACHE_KEY = 'schrodrive-github-stats';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour
const REPO_URL = 'https://api.github.com/repos/moderniselife/SchroDrive';

function getCachedData(): GitHubData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data: GitHubData = JSON.parse(raw);
    if (Date.now() - data.fetchedAt < CACHE_TTL) {
      return data;
    }
  } catch {
    // Corrupted cache — ignore
  }
  return null;
}

function setCachedData(data: GitHubData) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // Storage full — ignore
  }
}

function AnimatedNumber({ value }: { value: number }) {
  const spring = useSpring(0, { stiffness: 50, damping: 20 });
  const display = useTransform(spring, (v) => Math.round(v).toLocaleString());
  const [displayValue, setDisplayValue] = useState('0');

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  useEffect(() => {
    const unsubscribe = display.on('change', (v) => setDisplayValue(v));
    return unsubscribe;
  }, [display]);

  return <span>{displayValue}</span>;
}

function useGitHubStats() {
  const [data, setData] = useState<GitHubData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    // Check cache first
    const cached = getCachedData();
    if (cached) {
      setData(cached);
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch(REPO_URL);
      if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
      const json = await res.json();
      const freshData: GitHubData = {
        stars: json.stargazers_count ?? 0,
        forks: json.forks_count ?? 0,
        openIssues: json.open_issues_count ?? 0,
        fetchedAt: Date.now(),
      };
      setCachedData(freshData);
      setData(freshData);
    } catch {
      // Fallback to stale cache if available
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) setData(JSON.parse(raw));
      } catch {
        // No data available
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { data, isLoading };
}

/** Compact inline stat display — ideal for hero sections */
export default function GitHubStats({ className = '' }: { className?: string }) {
  const { data, isLoading } = useGitHubStats();

  if (isLoading || !data) return null;

  return (
    <motion.div
      className={`inline-flex items-center gap-4 text-sm text-white/50 ${className}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.8 }}
    >
      <span className="flex items-center gap-1.5">
        <Star className="h-3.5 w-3.5 text-yellow-400" />
        <AnimatedNumber value={data.stars} />
      </span>
      <span className="flex items-center gap-1.5">
        <GitFork className="h-3.5 w-3.5 text-blue-400" />
        <AnimatedNumber value={data.forks} />
      </span>
      <span className="flex items-center gap-1.5">
        <CircleDot className="h-3.5 w-3.5 text-green-400" />
        <AnimatedNumber value={data.openIssues} />
      </span>
    </motion.div>
  );
}

/** Larger standalone stat bar — for feature sections or about pages */
export function GitHubStatsBar({ className = '' }: { className?: string }) {
  const { data, isLoading } = useGitHubStats();

  if (isLoading || !data) return null;

  const stats = [
    { icon: Star, label: 'Stars', value: data.stars, colour: 'text-yellow-400' },
    { icon: GitFork, label: 'Forks', value: data.forks, colour: 'text-blue-400' },
    { icon: CircleDot, label: 'Open Issues', value: data.openIssues, colour: 'text-green-400' },
  ];

  return (
    <motion.div
      className={`flex items-center justify-center gap-8 rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10 px-8 py-4 ${className}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.5 }}
    >
      {stats.map((stat) => (
        <div key={stat.label} className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-2">
            <stat.icon className={`h-5 w-5 ${stat.colour}`} />
            <span className="text-2xl font-bold text-white">
              <AnimatedNumber value={stat.value} />
            </span>
          </div>
          <span className="text-xs text-white/40 font-medium uppercase tracking-wider">
            {stat.label}
          </span>
        </div>
      ))}
    </motion.div>
  );
}
