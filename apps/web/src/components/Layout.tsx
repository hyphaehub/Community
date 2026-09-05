import { PLAN_LIMITS } from '@hyphaehub/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { signOut } from '../lib/auth';
import { setActiveOrg } from '../lib/org';
import { Icon } from './icons';
import { Logo } from './Logo';
import { Badge, cn } from './ui';

const baseNav = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/batches', label: 'Batches', icon: 'batches' },
  { to: '/strains', label: 'Strains', icon: 'strains' },
  { to: '/inventory', label: 'Inventory', icon: 'inventory' },
  { to: '/costs', label: 'Costs', icon: 'costs' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
] as const;

const jarsItem = { to: '/jars', label: 'Jars', icon: 'inventory', end: false } as const;
const calendarItem = { to: '/calendar', label: 'Calendar', icon: 'calendar', end: false } as const;

type NavItem = { to: string; label: string; icon: string; end?: boolean };

const SITE_URL = import.meta.env.VITE_SITE_URL ?? 'https://hyphaehub.io';

export function Layout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me });

  function switchOrg(id: string) {
    if (id === me?.activeWorkspaceId) return;
    setActiveOrg(id);
    qc.clear();
    navigate('/');
  }

  // Feature-flagged items slot into the base nav: Jars between Dashboard and
  // Batches, Calendar right after Batches.
  let nav: NavItem[] = [...baseNav];
  const insertAfter = (to: string, item: NavItem) => {
    const i = nav.findIndex((n) => n.to === to);
    const at = i < 0 ? nav.length : i + 1;
    nav = [...nav.slice(0, at), item, ...nav.slice(at)];
  };
  if (me?.features?.jars) insertAfter('/', jarsItem);
  if (me?.features?.forecast !== false) insertAfter('/batches', calendarItem);
  if (me?.features?.costs === false) nav = nav.filter((n) => n.to !== '/costs');

  return (
    <div className="flex min-h-screen bg-spore">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-mycelium bg-parchment p-4 md:flex">
        <div className="px-2 py-3">
          <Logo />
        </div>
        <nav className="mt-4 flex flex-1 flex-col gap-1">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item ? item.end : false}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-hyphae-100 text-hyphae-800' : 'text-ink/70 hover:bg-spore',
                )
              }
            >
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
          {me?.isSuperAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                cn(
                  'mt-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive ? 'bg-flush/15 text-flush' : 'text-flush/80 hover:bg-spore',
                )
              }
            >
              <Icon name="settings" /> Platform Admin
            </NavLink>
          )}
        </nav>
        {me && (
          <div className="rounded-xl border border-mycelium bg-white/70 p-3">
            {me.organizations.length > 1 ? (
              <select
                aria-label="Active organization"
                value={me.activeWorkspaceId}
                onChange={(e) => switchOrg(e.target.value)}
                className="w-full rounded-md border border-mycelium bg-white px-2 py-1 text-sm font-medium text-substrate"
              >
                {me.organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {o.role.toLowerCase()}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center justify-between">
                <div className="truncate text-sm font-medium text-substrate">{me.workspace.name}</div>
                <Badge color={me.plan === 'FREE' ? 'neutral' : 'green'}>
                  {PLAN_LIMITS[me.plan].label}
                </Badge>
              </div>
            )}
            <div className="mt-1 truncate text-xs text-ink/50">{me.user.email}</div>
            <a
              href={SITE_URL}
              className="mt-3 flex items-center gap-2 text-xs font-medium text-ink/60 hover:text-hyphae-700"
            >
              <Icon name="dashboard" size={14} /> Back to site
            </a>
            <button
              type="button"
              onClick={() => signOut().then(() => navigate('/login'))}
              className="mt-2 flex items-center gap-2 text-xs font-medium text-ink/60 hover:text-flush"
            >
              <Icon name="logout" size={14} /> Sign out
            </button>
            <a
              data-built-by="Dothmen Tech"
              href="https://www.dothmen.com"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 block border-t border-mycelium pt-2 text-[11px] text-ink/40 hover:text-hyphae-700"
            >
              Built by Dothmen Tech
            </a>
          </div>
        )}
      </aside>

      <main className="flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
