'use client';

import dynamic from 'next/dynamic';

const BurnExperience = dynamic(
  () => import('@/components/BurnExperience').then(m => m.BurnExperience),
  { ssr: false },
);

export default function Home() {
  return <BurnExperience />;
}
