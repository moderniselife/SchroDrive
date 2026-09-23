'use client';

import dynamic from 'next/dynamic';
import HeroSection from '@/components/hero/HeroSection';
import LogoCloud from '@/components/sections/LogoCloud';
import FeaturesGrid from '@/components/sections/FeaturesGrid';
import ArchitectureFlow from '@/components/sections/ArchitectureFlow';
import StackSection from '@/components/sections/StackSection';
import StatsCounter from '@/components/sections/StatsCounter';
import CTABanner from '@/components/sections/CTABanner';

// Dynamic import for Three.js to avoid SSR issues
const ParticleScene = dynamic(
  () => import('@/components/hero/ParticleScene'),
  { ssr: false }
);

export default function Home() {
  return (
    <main className="relative min-h-screen bg-[#030014] text-white overflow-hidden">
      {/* Three.js particle background — absolute, behind everything */}
      <ParticleScene />

      {/* Hero section — overlays the particle scene */}
      <HeroSection />

      {/* Content sections */}
      <LogoCloud />
      <FeaturesGrid />
      <ArchitectureFlow />
      <StackSection />
      <StatsCounter />
      <CTABanner />
    </main>
  );
}
