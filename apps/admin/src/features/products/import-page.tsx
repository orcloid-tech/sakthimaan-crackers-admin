import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileDown,
  FileSpreadsheet,
  Upload,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type { ImportReport } from '@sakthimaan/shared';
import { PageHeader, Section, Spinner } from '@/components/common';
import { Can } from '@/components/guards';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError, errorMessage } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { runImport } from '../catalog/api';
import { PriceListDialog } from './price-list-dialog';
import { useQueryClient } from '@tanstack/react-query';

export function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [createMissing, setCreateMissing] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState<'check' | 'apply' | null>(null);
  const [dragging, setDragging] = useState(false);
  const [priceList, setPriceList] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!/\.(csv|xlsx)$/i.test(f.name)) {
      toast.error('Choose a .xlsx or .csv file');
      return;
    }
    setFile(f);
    setReport(null);
  };

  const run = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(dryRun ? 'check' : 'apply');
    try {
      const r = await runImport(file, { dryRun, createMissingCategories: createMissing, updateExisting });
      setReport(r);
      if (r.applied) {
        toast.success(`Imported: ${r.toCreate} new, ${r.toUpdate} updated`);
        void qc.invalidateQueries();
      }
    } catch (err) {
      // 422: the file has errors, the report is in the details
      if (err instanceof ApiError && err.status === 422 && err.details)
        setReport(err.details as ImportReport);
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const template = (format: 'csv' | 'xlsx') =>
    toast.promise(
      downloadFile('/products/import/template', { format }, `product-import-template.${format}`),
      {
        loading: 'Preparing template…',
        success: 'Template downloaded',
        error: (err: unknown) => errorMessage(err),
      },
    );
  const exportAll = (format: 'csv' | 'xlsx') =>
    toast.promise(downloadFile('/products/export', { format }, `products.${format}`), {
      loading: 'Preparing export…',
      success: 'Export downloaded',
      error: (err: unknown) => errorMessage(err),
    });

  const canApply =
    !!report && report.dryRun && report.errors.length === 0 && report.toCreate + report.toUpdate > 0;

  return (
    <>
      <PageHeader
        back={
          <Link
            to="/products"
            className="text-muted-foreground hover:text-foreground mb-1 inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="size-4" aria-hidden /> Products
          </Link>
        }
        title="Import & export"
        description="Add or update many products from Excel. Check the file first: nothing is saved until every row is correct."
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem] lg:items-start">
        <div className="grid min-w-0 gap-4">
          <Can
            allOf={['products:import']}
            fallback={
              <p className="text-muted-foreground text-sm">You can export but not import products.</p>
            }
          >
            <Section
              title="1. Choose the file"
              description="Use the template. Existing SKUs are updated; new SKUs are added."
            >
              <button
                type="button"
                onClick={() => input.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  pick(e.dataTransfer.files[0]);
                }}
                className={cn(
                  'hover:border-primary focus-visible:ring-ring/50 flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-sm transition outline-none focus-visible:ring-2',
                  dragging && 'border-primary bg-primary/5',
                )}
              >
                <FileSpreadsheet className="text-muted-foreground size-8" aria-hidden />
                {file ? (
                  <span className="font-medium">{file.name}</span>
                ) : (
                  <span>
                    <span className="font-medium">Choose a file</span> or drop it here (.xlsx or .csv, max 2
                    MB)
                  </span>
                )}
              </button>
              <input
                ref={input}
                type="file"
                accept=".xlsx,.csv"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  pick(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <span>
                    <span className="font-medium">Update existing products</span>
                    <span className="text-muted-foreground block text-xs">Rows with a known SKU</span>
                  </span>
                  <Switch
                    checked={updateExisting}
                    onCheckedChange={(v) => {
                      setUpdateExisting(v);
                      setReport(null);
                    }}
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <span>
                    <span className="font-medium">Create missing categories</span>
                    <span className="text-muted-foreground block text-xs">
                      Otherwise unknown names are errors
                    </span>
                  </span>
                  <Switch
                    checked={createMissing}
                    onCheckedChange={(v) => {
                      setCreateMissing(v);
                      setReport(null);
                    }}
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => void run(true)} disabled={!file || busy !== null}>
                  {busy === 'check' ? <Spinner /> : <CheckCircle2 />} 2. Check file
                </Button>
                <Button
                  variant={canApply ? 'default' : 'outline'}
                  onClick={() => void run(false)}
                  disabled={!canApply || busy !== null}
                >
                  {busy === 'apply' ? <Spinner /> : <Upload />} 3. Import now
                </Button>
              </div>
            </Section>
          </Can>

          {report ? <ReportView report={report} /> : null}
        </div>

        <aside className="grid gap-4">
          <Can allOf={['products:import']}>
            <Section title="Template" description="Excel version has drop-downs and an Instructions tab.">
              <div className="grid gap-2">
                <Button variant="outline" onClick={() => void template('xlsx')}>
                  <Download /> Excel template
                </Button>
                <Button variant="outline" onClick={() => void template('csv')}>
                  <Download /> CSV template
                </Button>
              </div>
            </Section>
          </Can>
          <Can allOf={['products:export']}>
            <Section
              title="Export"
              description="Same columns as the template, so you can edit in Excel and import back."
            >
              <div className="grid gap-2">
                <Button variant="outline" onClick={() => void exportAll('xlsx')}>
                  <Download /> All products (Excel)
                </Button>
                <Button variant="outline" onClick={() => void exportAll('csv')}>
                  <Download /> All products (CSV)
                </Button>
                <Button variant="outline" onClick={() => setPriceList(true)}>
                  <FileDown /> Price list PDF
                </Button>
              </div>
            </Section>
          </Can>
        </aside>
      </div>
      {priceList ? <PriceListDialog onClose={() => setPriceList(false)} /> : null}
    </>
  );
}

function ReportView({ report }: { report: ImportReport }) {
  const ok = report.errors.length === 0;
  return (
    <Section title={report.applied ? 'Import complete' : 'Check result'}>
      <div
        role="status"
        className={cn(
          'mb-4 flex items-start gap-2 rounded-lg border p-3 text-sm',
          report.applied
            ? 'border-emerald-600/30 bg-emerald-600/5'
            : ok
              ? 'border-emerald-600/30 bg-emerald-600/5'
              : 'border-destructive/30 bg-destructive/5',
        )}
      >
        {ok ? (
          <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" aria-hidden />
        ) : (
          <XCircle className="text-destructive mt-0.5 size-4" aria-hidden />
        )}
        <span>
          {report.applied
            ? `Saved ${plural(report.toCreate, 'new product')} and ${plural(report.toUpdate, 'update')}.`
            : ok
              ? `Ready: ${plural(report.toCreate, 'new product')}, ${plural(report.toUpdate, 'update')}, ${report.unchanged} unchanged. Press "Import now".`
              : `${plural(report.errors.length, 'problem')} found. Fix them in the file and check again. Nothing was saved.`}
        </span>
      </div>

      <dl className="mb-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
        {[
          ['Rows', report.totalRows],
          ['New', report.toCreate],
          ['Updates', report.toUpdate],
          ['Unchanged', report.unchanged],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border p-2">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      {report.categoriesToCreate.length > 0 ? (
        <p className="mb-4 text-sm">
          New categories:{' '}
          {report.categoriesToCreate.map((c) => (
            <Badge key={c} variant="outline" className="mr-1">
              {c}
            </Badge>
          ))}
        </p>
      ) : null}

      {report.errors.length > 0 ? <IssueTable title="Errors" issues={report.errors} kind="error" /> : null}
      {report.warnings.length > 0 ? (
        <IssueTable title="Warnings" issues={report.warnings} kind="warning" />
      ) : null}
    </Section>
  );
}

function IssueTable({
  title,
  issues,
  kind,
}: {
  title: string;
  issues: ImportReport['errors'];
  kind: 'error' | 'warning';
}) {
  return (
    <div className="mb-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
        {kind === 'error' ? (
          <XCircle className="text-destructive size-4" aria-hidden />
        ) : (
          <AlertTriangle className="size-4 text-amber-600" aria-hidden />
        )}
        {title} ({issues.length})
      </h3>
      <div className="max-h-80 overflow-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Row</TableHead>
              <TableHead className="w-40">Column</TableHead>
              <TableHead>Problem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issues.map((i, idx) => (
              <TableRow key={`${i.row}-${i.column ?? ''}-${idx}`}>
                <TableCell className="tabular-nums">{i.row}</TableCell>
                <TableCell className="font-mono text-xs">{i.column ?? '—'}</TableCell>
                <TableCell>{i.message}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
