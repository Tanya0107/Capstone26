/** Teacher shell: nav (Create / Review / Analytics) + route guard (NFR4). */
export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  // TODO Phase 4: wrap with <ProtectedRoute role="teacher">
  return <section>{children}</section>;
}
