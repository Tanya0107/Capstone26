/** Teacher shell: route guard (NFR4) plus the dense teacher chrome (Step 4.1). */
import AppShell from "@/components/shared/AppShell";
import ProtectedRoute from "@/components/shared/ProtectedRoute";

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute role="teacher">
      <AppShell role="teacher">{children}</AppShell>
    </ProtectedRoute>
  );
}
