import AdminGate from '@/components/admin/AdminGate';

/**
 * Back-office layout. No public site chrome — admin pages render their own UI.
 * Access is gated to CMS-capable users by <AdminGate>.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
