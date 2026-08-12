import { useExport } from '@/utils/share/export';
import { useImport } from '@/composable/useImport';

export function useImportExport(options) {
  const exportApi = useExport();
  const importApi = useImport(options);

  return {
    ...exportApi,
    ...importApi,
  };
}
