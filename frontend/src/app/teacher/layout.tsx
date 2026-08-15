/** Teacher shell: route guard now (NFR4), nav lands in Phase 4, Step 4.1. */
import ProtectedRoute from "@/components/shared/ProtectedRoute";

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute role="teacher">
      <section>{children}</section>
    </ProtectedRoute>
  );
}
