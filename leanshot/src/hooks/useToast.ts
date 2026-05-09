import { useStore } from '@/lib/store';

/** Thin wrapper around the store's toast slice with auto-dismiss. */
export function useToast(): (message: string, kind?: 'success' | 'error' | 'info') => void {
  return (message, kind = 'success') => {
    useStore.getState().showToast(message, kind);
    setTimeout(() => useStore.getState().dismissToast(), 2400);
  };
}
