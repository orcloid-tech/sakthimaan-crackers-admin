import { Suspense, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  MoreHorizontal,
  Package,
  Sun,
  UserRound,
  Warehouse,
} from 'lucide-react';
import type { Permission } from '@sakthimaan/shared';
import { ROLE_LABELS } from '@sakthimaan/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useAuth } from '@/hooks/use-auth';
import { authCall } from '@/lib/api';
import { clearSession } from '@/lib/session';
import { BrandMark, useBranding } from '@/lib/branding';
import { useTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { TableSkeleton } from '../common';
import { GlobalSearch } from './global-search';
import { NAV } from './nav';

/**
 * Store name and logo from Settings; neutral "Store admin" until they are entered.
 * `compact` (phone header): the logo alone when there is one, so search and the menus fit.
 */
function Brand({ compact = false }: { compact?: boolean }) {
  const brand = useBranding().data;
  return (
    <Link to="/" className="flex min-h-11 min-w-0 items-center gap-2 px-2 py-1 font-semibold">
      <BrandMark logoUrl={brand?.logoUrl} />
      <span className={cn('min-w-0 leading-tight', compact && brand?.logoUrl && 'max-sm:sr-only')}>
        <span className="block truncate">{brand?.storeName ?? 'Store admin'}</span>
        <span className="text-muted-foreground block text-xs font-normal">Admin</span>
      </span>
    </Link>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { canAny } = useAuth();
  return (
    <nav aria-label="Main" className="flex flex-col gap-4 px-2">
      {NAV.map((group, gi) => {
        const items = group.items.filter((i) => canAny(...i.anyOf));
        if (items.length === 0) return null;
        return (
          <div key={group.label ?? gi}>
            {group.label ? (
              <p className="text-muted-foreground px-2 pb-1 text-xs font-medium tracking-wide uppercase">
                {group.label}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  {item.soon ? (
                    <span
                      className="text-muted-foreground/70 flex cursor-not-allowed items-center gap-2.5 rounded-lg px-2 py-2 text-sm"
                      aria-disabled="true"
                    >
                      <item.icon className="size-4" aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      <Badge variant="outline" className="text-[10px]">
                        Soon
                      </Badge>
                    </span>
                  ) : (
                    <NavLink
                      to={item.to}
                      end={item.to === '/' || item.to === '/products'}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm transition-colors max-lg:min-h-11',
                          'hover:bg-sidebar-accent focus-visible:ring-ring/50 outline-none focus-visible:ring-2',
                          isActive && 'bg-sidebar-accent text-sidebar-primary font-medium',
                        )
                      }
                    >
                      <item.icon className="size-4" aria-hidden />
                      {item.label}
                    </NavLink>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function UserMenu() {
  const { user } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  if (!user) return null;
  const signOut = async () => {
    await authCall('/auth/logout').catch(() => undefined);
    clearSession();
    navigate('/login', { replace: true });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2" aria-label="Account menu">
          <span className="bg-muted grid size-7 place-items-center rounded-full">
            <UserRound className="size-4" aria-hidden />
          </span>
          <span className="hidden text-left text-sm leading-tight sm:block">
            {user.name}
            <span className="text-muted-foreground block text-xs">{ROLE_LABELS[user.role]}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <p className="font-medium">{user.name}</p>
          <p className="text-muted-foreground truncate text-xs">{user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-muted-foreground text-xs">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          <DropdownMenuRadioItem value="light">
            <Sun className="size-4" aria-hidden /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="size-4" aria-hidden /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor className="size-4" aria-hidden /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="size-4" aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const TABS: { label: string; to: string; icon: typeof Package; perm: Permission; match: string[] }[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard, perm: 'dashboard:read', match: [] },
  { label: 'Orders', to: '/orders', icon: ClipboardList, perm: 'orders:read', match: ['/orders'] },
  {
    label: 'Products',
    to: '/products',
    icon: Package,
    perm: 'products:read',
    match: ['/products', '/gift-boxes', '/categories'],
  },
  { label: 'Inventory', to: '/inventory', icon: Warehouse, perm: 'inventory:read', match: ['/inventory'] },
];

/**
 * Phone tab bar. Shown on top-level list screens only: detail and form screens have their own
 * sticky Save / action bar at the bottom and a back link instead.
 */
function useShowTabBar() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/reports')) return true;
  if (pathname === '/settings') return false;
  return pathname.split('/').filter(Boolean).length <= 1;
}

function BottomTabs({ onMore }: { onMore: () => void }) {
  const { canAny } = useAuth();
  const { pathname } = useLocation();
  const tabs = TABS.filter((t) => canAny(t.perm));
  const isActive = (t: (typeof TABS)[number]) =>
    t.to === '/' ? pathname === '/' : t.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
  const cell =
    'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium outline-none focus-visible:bg-muted';
  return (
    <nav
      aria-label="Quick"
      className="bg-background/95 fixed inset-x-0 bottom-0 z-30 flex border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {tabs.map((t) => (
        <Link
          key={t.to}
          to={t.to}
          data-slot="tab-bar-item"
          className={cn(cell, isActive(t) ? 'text-primary' : 'text-muted-foreground')}
          aria-current={isActive(t) ? 'page' : undefined}
        >
          <t.icon className="size-5" aria-hidden />
          {t.label}
        </Link>
      ))}
      <button type="button" onClick={onMore} className={cn(cell, 'text-muted-foreground')}>
        <MoreHorizontal className="size-5" aria-hidden />
        More
      </button>
    </nav>
  );
}

function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
      aria-label={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {resolved === 'dark' ? <Sun /> : <Moon />}
    </Button>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const tabBar = useShowTabBar();
  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="bg-primary text-primary-foreground sr-only z-50 rounded px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <aside className="bg-sidebar sticky top-0 hidden h-svh flex-col gap-4 overflow-y-auto border-r py-4 lg:flex">
        <Brand />
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="bg-background/90 sticky top-0 z-30 flex min-h-14 items-center gap-1 border-b pt-[env(safe-area-inset-top)] pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(0.5rem,env(safe-area-inset-left))] backdrop-blur sm:gap-2 sm:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="bg-sidebar w-72 gap-4 overflow-y-auto p-0 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Menu</SheetTitle>
                <SheetDescription>Main navigation</SheetDescription>
              </SheetHeader>
              <Brand />
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="min-w-0 lg:hidden">
            <Brand compact />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
            <GlobalSearch />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className={cn(
            'mx-auto w-full max-w-7xl flex-1 px-[max(0.75rem,env(safe-area-inset-left))] py-3 outline-none sm:p-6',
            tabBar && 'max-md:pb-[calc(4.5rem+env(safe-area-inset-bottom))]',
          )}
        >
          {/* Pages load lazily: keep the shell and show a light placeholder meanwhile. */}
          <Suspense fallback={<TableSkeleton />}>
            <Outlet />
          </Suspense>
        </main>
        {tabBar ? <BottomTabs onMore={() => setMobileOpen(true)} /> : null}
      </div>
    </div>
  );
}
