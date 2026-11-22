import { homePathForRole } from '@parksmart/shared';
import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { useMe } from '@/lib/auth';
import { LoginPage } from './login';
import { AdminHome, EmployeeHome, GateHome } from './placeholders';
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
        children: [{ index: true, element: <EmployeeHome /> }],
      },
      {
        path: '/admin',
        element: <RequireRole group="/admin" />,
        children: [{ index: true, element: <AdminHome /> }],
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
