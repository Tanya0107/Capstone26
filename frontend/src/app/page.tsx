/** Root: redirect by auth state -> /login, /teacher/dashboard, /student/dashboard. */
import EmulatorCheck from "@/components/shared/EmulatorCheck";

export default function Home() {
  // TODO Phase 2, Step 2.4: role-based redirect via useAuth.
  return (
    <main className="p-8">
      Math Enrichment Platform — skeleton
      <EmulatorCheck />
    </main>
  );
}
