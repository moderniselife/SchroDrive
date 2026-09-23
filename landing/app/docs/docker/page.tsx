import DockerGenerator from '@/components/docs/DockerGenerator';
import GradientText from '@/components/ui/GradientText';
import Badge from '@/components/ui/Badge';
import { ArrowLeft, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Docker Compose Generator — SchröDrive',
  description:
    'Build a custom docker-compose.yml tailored to your SchröDrive setup. Configure providers, integrations, services, and paths interactively.',
};

export default function DockerGeneratorPage() {
  return (
    <div className="space-y-8">
      {/* Back link */}
      <a
        href="/docs"
        className="inline-flex items-center gap-2 text-sm text-white/40 hover:text-white/70 transition-colors duration-200"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Documentation
      </a>

      {/* Header */}
      <div>
        <Badge variant="gradient" className="mb-4">
          <Sparkles className="w-3.5 h-3.5" />
          Interactive Tool
        </Badge>
        <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
          Docker Compose{' '}
          <GradientText as="span">Generator</GradientText>
        </h1>
        <p className="text-lg text-white/50 max-w-2xl">
          Build a custom{' '}
          <code className="text-sm bg-white/10 px-2 py-0.5 rounded text-purple-300 font-mono">
            docker-compose.yml
          </code>{' '}
          tailored to your setup. Toggle providers, integrations, and services — then
          copy or download the generated configuration.
        </p>
      </div>

      {/* Generator */}
      <DockerGenerator />
    </div>
  );
}
