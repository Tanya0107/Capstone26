/** Student shell: route guard (NFR4) plus the spacious student chrome (Step 4.1). */
import AppShell from "@/components/shared/AppShell";
import ProtectedRoute from "@/components/shared/ProtectedRoute";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute role="student">
      <AppShell role="student">{children}</AppShell>
    </ProtectedRoute>
  );
}
