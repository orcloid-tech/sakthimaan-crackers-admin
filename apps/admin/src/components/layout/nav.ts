import type { LucideIcon } from 'lucide-react';
import {
  Boxes,
  ClipboardList,
  FileSpreadsheet,
  Gift,
  LayoutDashboard,
  Package,
  Settings,
  Tags,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react';
import type { Permission } from '@sakthimaan/shared';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Shown only if the user has ANY of these. */
  anyOf: Permission[];
  /** Not built yet: shown greyed out so the roadmap is visible. */
  soon?: boolean;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: null,
    items: [{ label: 'Dashboard', to: '/', icon: LayoutDashboard, anyOf: ['dashboard:read'] }],
  },
  {
    label: 'Sales',
    items: [
      { label: 'Orders & enquiries', to: '/orders', icon: ClipboardList, anyOf: ['orders:read'], soon: true },
      { label: 'Customers', to: '/customers', icon: Users, anyOf: ['customers:read'], soon: true },
      { label: 'Dispatch', to: '/dispatch', icon: Truck, anyOf: ['orders:dispatch'], soon: true },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { label: 'Products', to: '/products', icon: Package, anyOf: ['products:read'] },
      { label: 'Gift boxes', to: '/gift-boxes', icon: Gift, anyOf: ['products:read'] },
      { label: 'Categories', to: '/categories', icon: Tags, anyOf: ['categories:read'] },
      {
        label: 'Import / export',
        to: '/products/import',
        icon: FileSpreadsheet,
        anyOf: ['products:import', 'products:export'],
      },
    ],
  },
  {
    label: 'Stock',
    items: [{ label: 'Inventory', to: '/inventory', icon: Warehouse, anyOf: ['inventory:read'] }],
  },
  {
    label: 'Admin',
    items: [
      { label: 'Settings', to: '/settings', icon: Settings, anyOf: ['settings:read'], soon: true },
      { label: 'Audit log', to: '/audit', icon: Boxes, anyOf: ['audit:read'], soon: true },
    ],
  },
];
