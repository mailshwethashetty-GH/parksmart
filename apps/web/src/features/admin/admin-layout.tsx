import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { cn } from '@/lib/utils';

/** Admin sub-navigation. Later milestones add Rounds, Collation, Analytics and Audit. */
export function AdminLayout() {
  const { t } = useTranslation();
  const links = [
    { to: '/admin', label: t('admin.overview'), end: true },
    { to: '/admin/collation', label: t('admin.collation') },
    { to: '/admin/rounds', label: t('admin.rounds') },
    { to: '/admin/site', label: t('admin.site') },
    { to: '/admin/policy', label: t('admin.policy') },
  ];
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label={t('nav.admin')} className="flex gap-1">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              cn(
                'rounded-md px-3 py-1.5 text-sm',
                isActive ? 'bg-secondary font-medium' : 'hover:bg-secondary',
              )
            }
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
