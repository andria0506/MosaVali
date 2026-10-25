import { Nav } from '../components/landing/Nav';
import { Hero } from '../components/landing/Hero';
import { Problem } from '../components/landing/Problem';
import { Features } from '../components/landing/Features';
import { HowItWorks } from '../components/landing/HowItWorks';
import { Banks } from '../components/landing/Banks';
import { Security } from '../components/landing/Security';
import { FinalCta } from '../components/landing/FinalCta';

export default function Landing() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Problem />
        <Features />
        <HowItWorks />
        <Banks />
        <Security />
      </main>
      <FinalCta />
    </>
  );
}
