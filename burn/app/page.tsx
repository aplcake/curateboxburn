import dynamic from 'next/dynamic';

// ssr: false prevents hydration mismatches from wagmi/wallet hooks
// and stops Three.js from attempting to run server-side
const BurnExperience = dynamic(
  () => import('@/components/BurnExperience').then(m => m.BurnExperience),
  { ssr: false },
);

export default function Home() {
  return <BurnExperience />;
}
