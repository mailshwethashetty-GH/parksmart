import { homePathForRole } from '@parksmart/shared';
import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { AdminLayout } from '@/features/admin/admin-layout';
import { BookPage } from '@/features/booking/book-page';
import { EmployeeHomePage } from '@/features/booking/home-page';
import { RecurringPage } from '@/features/booking/recurring-page';
import { CurrentPolicyPage } from '@/features/policy/current-policy-page';
import { PolicyPage } from '@/features/policy/policy-page';
import { CollationPage } from '@/features/rounds/collation-page';
import { AuditPage } from '@/features/rounds/audit-page';
import { RoundReviewPage } from '@/features/rounds/round-review-page';
import { RoundsPage } from '@/features/rounds/rounds-page';
import { SitePage } from '@/features/site/site-page';
import { useMe } from '@/lib/auth';
import { LoginPage } from './login';
import { AdminHome, GateHome } from './placeholders';
import { RequireRole } from './require-role';

function RootRedirect() {
  const me = useMe();
  if (me.isPending) return null;
  return <Navigate to={me.data ? homePathForRole(me.data.role) : '/login'} replace />;
}

export const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <AppShell />,
    children: [
      {
        path: '/app',
        element: <RequireRole group="/app" />,
        children: [
          { index: true, element: <EmployeeHomePage /> },
          { path: 'book', element: <BookPage /> },
          { path: 'recurring', element: <RecurringPage /> },
          { path: 'policy', element: <CurrentPolicyPage /> },
        ],
      },
      {
        path: '/admin',
        element: <RequireRole group="/admin" />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { index: true, element: <AdminHome /> },
              { path: 'site', element: <SitePage /> },
              { path: 'policy', element: <PolicyPage /> },
              { path: 'collation', element: <CollationPage /> },
              { path: 'rounds', element: <RoundsPage /> },
              { path: 'rounds/:id', element: <RoundReviewPage /> },
              { path: 'audit', element: <AuditPage /> },
            ],
          },
        ],
      },
      {
        path: '/gate',
        element: <RequireRole group="/gate" />,
        children: [{ index: true, element: <GateHome /> }],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
