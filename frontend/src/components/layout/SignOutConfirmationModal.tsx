'use client';

import { LogOut } from 'lucide-react';

interface SignOutConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function SignOutConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
}: SignOutConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card w-full max-w-sm rounded-2xl shadow-2xl border border-border overflow-hidden p-6 text-foreground animate-in zoom-in-95 duration-200">
        <div className="flex items-center gap-3.5 mb-4">
          <div className="w-10 h-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
            <LogOut className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold leading-none">Sign Out</h3>
            <p className="text-xs text-muted-foreground mt-1">Please confirm your action</p>
          </div>
        </div>

        <p className="text-sm text-foreground my-4 font-medium">
          Are you sure you want to sign out?
        </p>

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium rounded-xl border border-border bg-background hover:bg-muted transition-colors text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium rounded-xl bg-destructive text-destructive-foreground hover:opacity-90 transition-opacity shadow-sm"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
