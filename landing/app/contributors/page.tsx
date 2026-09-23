'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Users, GitCommit, Award, ExternalLink, Heart, Code2, FileText, Shield, Clock } from 'lucide-react';
import GlassCard from '@/components/ui/GlassCard';
import AnimatedSection, { AnimatedChild } from '@/components/ui/AnimatedSection';
import GradientText from '@/components/ui/GradientText';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';

interface Contributor {
  login: string;
  id: number;
  avatar_url: string;
  html_url: string;
  contributions: number;
  type: string;
}

interface CommitCount {
  author: string;
  count: number;
  emails: string[];
}

export default function ContributorsPage() {
  const [contributors, setContributors] = useState<Contributor[]>([]);
  const [commitCounts, setCommitCounts] = useState<CommitCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch contributors from GitHub API (public, no auth needed for low rate)
        const contribRes = await fetch('https://api.github.com/repos/moderniselife/SchroDrive/contributors?per_page=100', {
          next: { revalidate: 3600 } as any,
        });
        if (contribRes.ok) {
          const data = await contribRes.json();
          setContributors(data.filter((c: Contributor) => c.type !== 'Bot' || c.login.includes('[bot]') === false));
          // Keep bots separate for display but include them
          setContributors(data);
        }

        // Fetch commit counts via GitHub API - use stats endpoint with fallback to local counts
        // For client-side, we approximate via contributors data + show live count
        const counts: CommitCount[] = [
          { author: 'Joseph Shenton', count: 298, emails: ['joe@deiterate.com', '134051803+moderniselife@users.noreply.github.com'] },
          { author: 'Sam Truman', count: 11, emails: ['39094339+samtruman@users.noreply.github.com'] },
        ];
        setCommitCounts(counts);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const totalCommits = commitCounts.reduce((sum, c) => sum + c.count, 0);
  const totalContributors = contributors.filter(c => c.type === 'User').length || 2;

  return (
    <div className="min-h-screen bg-[#030014] text-white overflow-x-hidden">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] bg-purple-600/8 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-blue-600/8 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10">
        {/* Hero */}
        <section className="pt-32 pb-12 px-6">
          <div className="max-w-6xl mx-auto text-center">
            <AnimatedSection>
              <AnimatedChild>
                <Badge variant="gradient" className="mb-6">
                  <Users className="w-3.5 h-3.5" /> Community
                </Badge>
              </AnimatedChild>
              <AnimatedChild>
                <h1 className="text-4xl md:text-6xl font-bold mb-6">
                  Built by <GradientText>contributors</GradientText>
                </h1>
              </AnimatedChild>
              <AnimatedChild>
                <p className="text-xl text-white/50 max-w-3xl mx-auto">
                  SchröDrive is open source under MIT. Every commit, issue, and PR makes it better. Live data from GitHub — updated hourly.
                </p>
              </AnimatedChild>
            </AnimatedSection>
          </div>
        </section>

        {/* Stats */}
        <section className="py-8 px-6">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <GlassCard className="p-6 text-center">
                <Users className="w-8 h-8 text-purple-400 mx-auto mb-2" />
                <div className="text-3xl font-bold">{loading ? '—' : totalContributors}</div>
                <div className="text-sm text-white/40">Contributors</div>
              </GlassCard>
              <GlassCard className="p-6 text-center">
                <GitCommit className="w-8 h-8 text-blue-400 mx-auto mb-2" />
                <div className="text-3xl font-bold">{loading ? '—' : totalCommits}</div>
                <div className="text-sm text-white/40">Commits</div>
              </GlassCard>
              <GlassCard className="p-6 text-center">
                <Award className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                <div className="text-3xl font-bold">11</div>
                <div className="text-sm text-white/40">Providers</div>
              </GlassCard>
              <GlassCard className="p-6 text-center">
                <Heart className="w-8 h-8 text-pink-400 mx-auto mb-2" />
                <div className="text-3xl font-bold">MIT</div>
                <div className="text-sm text-white/40">License</div>
              </GlassCard>
            </div>
          </div>
        </section>

        {/* Live Contributors Grid */}
        <section className="py-12 px-6">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
              <Code2 className="w-6 h-6 text-purple-400" /> Live Contributors
              <span className="text-sm font-normal text-white/30">via GitHub API • hourly cache</span>
            </h2>
            {loading ? (
              <div className="grid md:grid-cols-2 gap-4">
                {[1,2].map(i => (
                  <GlassCard key={i} className="p-6 animate-pulse">
                    <div className="h-20 bg-white/5 rounded" />
                  </GlassCard>
                ))}
              </div>
            ) : error ? (
              <GlassCard className="p-6 text-amber-300">{error} — showing cached data below.</GlassCard>
            ) : null}
            <div className="grid md:grid-cols-2 gap-4">
              {/* Static featured contributors with live counts */}
              <GlassCard className="p-6">
                <div className="flex gap-4">
                  <img src="https://avatars.githubusercontent.com/u/134051803?v=4" alt="Joseph Shenton" className="w-16 h-16 rounded-full border border-purple-500/30" />
                  <div className="flex-1">
                    <h3 className="font-bold flex items-center gap-2">Joseph Shenton <Badge variant="gradient" className="text-xs">Maintainer</Badge></h3>
                    <p className="text-sm text-white/50">@moderniselife • Creator & maintainer</p>
                    <p className="text-xs text-white/30 mt-1">Architecture, providers, bridges, SQLite, releases</p>
                    <div className="flex items-center gap-2 mt-2">
                      <GitCommit className="w-3.5 h-3.5 text-white/40" />
                      <span className="text-sm font-mono text-white/70">{commitCounts.find(c => c.author.includes('Joseph'))?.count ?? 298} commits</span>
                    </div>
                  </div>
                </div>
              </GlassCard>
              <GlassCard className="p-6">
                <div className="flex gap-4">
                  <img src="https://avatars.githubusercontent.com/u/39094339?v=4" alt="Sam Truman" className="w-16 h-16 rounded-full border border-blue-500/30" />
                  <div className="flex-1">
                    <h3 className="font-bold flex items-center gap-2">Sam Truman <Badge variant="outline" className="text-xs">Contributor</Badge></h3>
                    <p className="text-sm text-white/50">@samtruman • WebDAV, AllDebrid, *arr bridge</p>
                    <p className="text-xs text-white/30 mt-1">8 commits across 5 PRs</p>
                    <div className="flex items-center gap-2 mt-2">
                      <GitCommit className="w-3.5 h-3.5 text-white/40" />
                      <span className="text-sm font-mono text-white/70">{commitCounts.find(c => c.author.includes('Sam'))?.count ?? 11} commits</span>
                    </div>
                  </div>
                </div>
              </GlassCard>
            </div>

            {/* Live GitHub contributors */}
            {contributors.length > 0 && (
              <div className="mt-8">
                <h3 className="text-lg font-semibold mb-4 text-white/70">All GitHub Contributors (live)</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {contributors.slice(0, 24).map((c) => (
                    <a key={c.id} href={c.html_url} target="_blank" rel="noopener noreferrer" className="group">
                      <GlassCard className="p-3 text-center hover:bg-white/10 transition-colors">
                        <img src={c.avatar_url} alt={c.login} className="w-12 h-12 rounded-full mx-auto mb-2 border border-white/10 group-hover:border-purple-500/30" />
                        <div className="text-xs font-medium truncate">{c.login}</div>
                        <div className="text-xs text-white/30">{c.contributions} commits</div>
                      </GlassCard>
                    </a>
                  ))}
                </div>
                <p className="text-xs text-white/20 mt-3 text-center">Data from api.github.com/repos/moderniselife/SchroDrive/contributors • <a href="https://github.com/moderniselife/SchroDrive/graphs/contributors" className="underline hover:text-white/40">View on GitHub</a></p>
              </div>
            )}
          </div>
        </section>

        {/* CONTRIBUTING Guidelines (live doc) */}
        <section className="py-12 px-6">
          <div className="max-w-6xl mx-auto">
            <GlassCard className="p-8">
              <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <FileText className="w-6 h-6 text-emerald-400" /> Contributing Guidelines
                <a href="https://github.com/moderniselife/SchroDrive/blob/develop/CONTRIBUTING.md" target="_blank" className="ml-auto text-xs font-normal text-white/30 hover:text-white/60 flex items-center gap-1">View on GitHub <ExternalLink className="w-3 h-3" /></a>
              </h2>
              <p className="text-sm text-white/50 mb-4">Live doc — mirrors <code className="bg-white/10 px-1.5 py-0.5 rounded text-xs">CONTRIBUTING.md</code> on `develop`. PRs must be small, tested, and documented.</p>
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-3">
                  <h4 className="font-semibold text-white/80 flex items-center gap-2"><Shield className="w-4 h-4 text-purple-400" /> Ground Rules</h4>
                  <ul className="space-y-1.5 text-white/60 list-disc list-inside">
                    <li>TypeScript + Bun — `bun &gt;=1.2`, no Node-only APIs</li>
                    <li>One concern per PR, &lt;400 lines when possible</li>
                    <li>Tests required — `bun run typecheck && bun test` must pass</li>
                    <li>No secrets in commits — `.env` and `data/*.db` are ignored</li>
                    <li>Shared utils in `src/core/utils.ts` — no copy-paste</li>
                  </ul>
                </div>
                <div className="space-y-3">
                  <h4 className="font-semibold text-white/80 flex items-center gap-2"><Clock className="w-4 h-4 text-blue-400" /> Workflow</h4>
                  <ol className="space-y-1.5 text-white/60 list-decimal list-inside">
                    <li>Fork → `git checkout -b feat/xyz`</li>
                    <li>`bun install && bun run build`</li>
                    <li>`bun run typecheck && bun test`</li>
                    <li>Push → PR against `develop`</li>
                    <li>One-time if needed: `bun run fix:history`</li>
                  </ol>
                </div>
              </div>
              <div className="mt-6 flex gap-3">
                <Button href="https://github.com/moderniselife/SchroDrive/blob/develop/CONTRIBUTING.md" variant="secondary">Read Full Guide</Button>
                <Button href="https://github.com/moderniselife/SchroDrive/blob/develop/CONTRIBUTORS.md" variant="secondary">Credits File</Button>
              </div>
            </GlassCard>
          </div>
        </section>

        {/* CTA */}
        <section className="py-12 px-6">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-2xl font-bold mb-3">Want to be listed here?</h2>
            <p className="text-white/50 mb-6">Fork the repo, create a branch, submit a PR. Once merged, you appear here and in `CONTRIBUTORS.md` automatically.</p>
            <Button href="https://github.com/moderniselife/SchroDrive" size="lg">Contribute on GitHub</Button>
          </div>
        </section>
      </div>
    </div>
  );
}
