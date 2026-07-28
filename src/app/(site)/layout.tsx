import SiteShell from '@/components/layout/SiteShell';

/** Layout for all public-facing pages — wraps them in the site chrome. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
