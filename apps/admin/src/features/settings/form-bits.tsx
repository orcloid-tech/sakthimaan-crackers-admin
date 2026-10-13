import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { SettingsSection } from '@sakthimaan/shared';
import { Spinner } from '@/components/common';
import { Button } from '@/components/ui/button';
import { ApiError, errorMessage } from '@/lib/api';
import { useSettingsMutations, type SettingsUpdateBody } from './api';

/** Optional text: empty → undefined (the API clears it). */
export const opt = (v: string) => (v.trim() ? v.trim() : undefined);

/**
 * Saves one settings section with the version that was loaded, and maps the API's
 * field errors ("company.address.pincode") back to that section's fields.
 */
export function useSaveSection(section: SettingsSection) {
  const { update } = useSettingsMutations();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = async (
    version: number,
    payload: NonNullable<SettingsUpdateBody[typeof section]>,
    okText = 'Saved',
  ) => {
    setErrors({});
    try {
      await update.mutateAsync({ version, [section]: payload });
      toast.success(okText);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) {
        const prefix = `${section}.`;
        setErrors(
          Object.fromEntries(
            err.issues.map((i) => [
              i.path.startsWith(prefix) ? i.path.slice(prefix.length) : i.path,
              i.message,
            ]),
          ),
        );
        toast.error('Check the highlighted fields');
      } else if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        toast.error(err.message, { duration: 8000 });
      } else toast.error(errorMessage(err));
      return false;
    }
  };
  return { save, errors, setErrors, saving: update.isPending };
}

/** Save button row; sticks to the bottom of the screen on phones so it's always reachable. */
export function SaveBar({
  saving,
  disabled,
  children,
  note,
}: {
  saving: boolean;
  disabled?: boolean;
  children?: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-0 z-10 -mx-3 mt-4 flex items-center justify-end gap-3 border-t px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
      {note ? <p className="text-muted-foreground mr-auto text-xs">{note}</p> : null}
      {children}
      <Button type="submit" disabled={saving || disabled}>
        {saving ? <Spinner /> : null} Save changes
      </Button>
    </div>
  );
}

export function ReadOnlyNote({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="bg-muted text-muted-foreground mb-4 rounded-lg px-3 py-2 text-sm">
      You can view these settings. Only a Super Admin can change them.
    </p>
  );
}
