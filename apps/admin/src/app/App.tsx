import { lazy, useEffect } from 'react';
import { createBrowserRouter, Link, Navigate, RouterProvider } from 'react-router-dom';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Forbidden, GuestOnly, RequireAuth, RequirePermission } from '@/components/guards';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ForgotPasswordPage, LoginPage, ResetPasswordPage } from '@/features/auth/auth-pages';
import { ApiError } from '@/lib/api';
import { bootstrapSession } from '@/lib/session';
import { ThemeProvider } from '@/lib/theme';

// Each screen is its own chunk: staff often work on phones over mobile data.
const DashboardPage = lazy(() =>
  import('@/features/dashboard/dashboard-page').then((m) => ({ default: m.DashboardPage })),
);
const CategoriesPage = lazy(() =>
  import('@/features/categories/categories-page').then((m) => ({ default: m.CategoriesPage })),
);
const ProductsPage = lazy(() =>
  import('@/features/products/products-page').then((m) => ({ default: m.ProductsPage })),
);
const ProductFormPage = lazy(() =>
  import('@/features/products/product-form-page').then((m) => ({ default: m.ProductFormPage })),
);
const GiftBoxPage = lazy(() =>
  import('@/features/products/gift-box-page').then((m) => ({ default: m.GiftBoxPage })),
);
const ImportPage = lazy(() =>
  import('@/features/products/import-page').then((m) => ({ default: m.ImportPage })),
);
const InventoryPage = lazy(() =>
  import('@/features/inventory/inventory-page').then((m) => ({ default: m.InventoryPage })),
);
const ProductLedgerPage = lazy(() =>
  import('@/features/inventory/inventory-page').then((m) => ({ default: m.ProductLedgerPage })),
);
const OrdersPage = lazy(() =>
  import('@/features/orders/orders-page').then((m) => ({ default: m.OrdersPage })),
);
const OrderFormPage = lazy(() =>
  import('@/features/orders/order-form-page').then((m) => ({ default: m.OrderFormPage })),
);
const OrderDetailPage = lazy(() =>
  import('@/features/orders/order-detail-page').then((m) => ({ default: m.OrderDetailPage })),
);
const SettingsPage = lazy(() =>
  import('@/features/settings/settings-page').then((m) => ({ default: m.SettingsPage })),
);
const ShippingPage = lazy(() =>
  import('@/features/shipping/shipping-page').then((m) => ({ default: m.ShippingPage })),
);
const CustomersPage = lazy(() =>
  import('@/features/customers/customers-page').then((m) => ({ default: m.CustomersPage })),
);
const CustomerDetailPage = lazy(() =>
  import('@/features/customers/customer-detail-page').then((m) => ({ default: m.CustomerDetailPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // Retry only server/network failures, never 4xx.
      retry: (count, err) =>
        count < 2 && (!(err instanceof ApiError) || err.status === 0 || err.status >= 500),
    },
  },
  queryCache: new QueryCache({
    onError: (err) => {
      if (err instanceof ApiError && err.status === 403) toast.error(err.message);
    },
  }),
  mutationCache: new MutationCache(),
});

function NotFound() {
  return (
    <div className="flex flex-col items-center gap-3 py-20 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <Button asChild variant="outline">
        <Link to="/">Go to dashboard</Link>
      </Button>
    </div>
  );
}

const router = createBrowserRouter(
  [
    {
      element: <GuestOnly />,
      children: [
        { path: '/login', element: <LoginPage /> },
        { path: '/forgot-password', element: <ForgotPasswordPage /> },
      ],
    },
    { path: '/reset-password', element: <ResetPasswordPage /> },
    {
      element: <RequireAuth />,
      children: [
        {
          element: <AppShell />,
          children: [
            {
              index: true,
              element: (
                <RequirePermission anyOf={['dashboard:read']}>
                  <DashboardPage />
                </RequirePermission>
              ),
            },
            {
              path: 'orders',
              element: (
                <RequirePermission anyOf={['orders:read']}>
                  <OrdersPage />
                </RequirePermission>
              ),
            },
            {
              path: 'orders/new',
              element: (
                <RequirePermission anyOf={['orders:create']}>
                  <OrderFormPage />
                </RequirePermission>
              ),
            },
            {
              path: 'orders/:id',
              element: (
                <RequirePermission anyOf={['orders:read']}>
                  <OrderDetailPage />
                </RequirePermission>
              ),
            },
            {
              path: 'products',
              element: (
                <RequirePermission anyOf={['products:read']}>
                  <ProductsPage kind="single" />
                </RequirePermission>
              ),
            },
            {
              path: 'products/new',
              element: (
                <RequirePermission anyOf={['products:create']}>
                  <ProductFormPage />
                </RequirePermission>
              ),
            },
            {
              path: 'products/import',
              element: (
                <RequirePermission anyOf={['products:import', 'products:export']}>
                  <ImportPage />
                </RequirePermission>
              ),
            },
            {
              path: 'products/:id',
              element: (
                <RequirePermission anyOf={['products:read']}>
                  <ProductFormPage />
                </RequirePermission>
              ),
            },
            {
              path: 'gift-boxes',
              element: (
                <RequirePermission anyOf={['products:read']}>
                  <ProductsPage kind="combo" />
                </RequirePermission>
              ),
            },
            {
              path: 'gift-boxes/new',
              element: (
                <RequirePermission anyOf={['products:create']}>
                  <GiftBoxPage />
                </RequirePermission>
              ),
            },
            {
              path: 'gift-boxes/:id',
              element: (
                <RequirePermission anyOf={['products:read']}>
                  <GiftBoxPage />
                </RequirePermission>
              ),
            },
            {
              path: 'categories',
              element: (
                <RequirePermission anyOf={['categories:read']}>
                  <CategoriesPage />
                </RequirePermission>
              ),
            },
            {
              path: 'inventory',
              element: (
                <RequirePermission anyOf={['inventory:read']}>
                  <InventoryPage />
                </RequirePermission>
              ),
            },
            {
              path: 'inventory/products/:id',
              element: (
                <RequirePermission anyOf={['inventory:read']}>
                  <ProductLedgerPage />
                </RequirePermission>
              ),
            },
            {
              path: 'customers',
              element: (
                <RequirePermission anyOf={['customers:read']}>
                  <CustomersPage />
                </RequirePermission>
              ),
            },
            {
              path: 'customers/:id',
              element: (
                <RequirePermission anyOf={['customers:read']}>
                  <CustomerDetailPage />
                </RequirePermission>
              ),
            },
            {
              path: 'shipping',
              element: (
                <RequirePermission anyOf={['shipping:read']}>
                  <ShippingPage />
                </RequirePermission>
              ),
            },
            {
              path: 'settings',
              element: (
                <RequirePermission anyOf={['settings:read']}>
                  <SettingsPage />
                </RequirePermission>
              ),
            },
            { path: 'forbidden', element: <Forbidden /> },
            { path: '*', element: <NotFound /> },
          ],
        },
      ],
    },
    { path: '*', element: <Navigate to="/" replace /> },
  ],
  {
    future: {
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
      v7_partialHydration: true,
      v7_skipActionErrorRevalidation: true,
    },
  },
);

export function App() {
  useEffect(() => {
    void bootstrapSession();
  }, []);
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} future={{ v7_startTransition: true }} />
          <Toaster richColors closeButton position="top-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
