import type { Metadata } from 'next';
import DocsSidebar from '@/components/docs/DocsSidebar';

export const metadata: Metadata = {
  title: 'Documentation — SchröDrive',
  description:
    'Complete setup guide, configuration reference, and integration documentation for SchröDrive — the ultimate media automation orchestrator.',
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#030014]">
      {/* Top gradient accent */}
      <div className="fixed top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/50 to-transparent z-50" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="flex gap-8">
          {/* Sidebar */}
          <DocsSidebar />

          {/* Main content */}
          <main className="flex-1 min-w-0">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
