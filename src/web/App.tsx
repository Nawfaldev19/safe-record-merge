import { Navigate, Route, Routes } from 'react-router';
import { ErrorState } from './components/ui';
import { LoginPage } from './features/auth/LoginPage';
import { WorkspaceRoute } from './features/auth/session';
import { DuplicatesPage } from './features/duplicates/DuplicatesPage';
import { LandingPage } from './features/landing/LandingPage';
import { MemberPage } from './features/member/MemberPage';
import { MergePage } from './features/merge/MergePage';
import { MergesPage } from './features/merge/MergesPage';
import { RosterPage } from './features/roster/RosterPage';
import { AppShell } from './features/shell/AppShell';

function NotFoundPage() {
  return (
    <main className="page page--narrow">
      <ErrorState title="Page not found" message="There is nothing at this address." />
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/w/:workspaceId"
        element={<WorkspaceRoute shell={(content) => <AppShell>{content}</AppShell>} />}
      >
        <Route index element={<Navigate to="roster" replace />} />
        <Route path="roster" element={<RosterPage />} />
        <Route path="members/:memberId" element={<MemberPage />} />
        <Route path="duplicates" element={<DuplicatesPage />} />
        <Route path="merge/:leftId/:rightId" element={<MergePage />} />
        <Route path="merges" element={<MergesPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
