'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useOrgStore } from '../../store/org';
import { X, KeyRound, AlertTriangle } from 'lucide-react';

interface CredentialRotationModalProps {
  connectionId: string;
  connectionName: string;
  onClose: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function CredentialRotationModal({ connectionId, connectionName, onClose }: CredentialRotationModalProps) {
  const currentOrgId = useOrgStore(state => state.currentOrgId);
  const queryClient = useQueryClient();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  const rotateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(
        `/orgs/${currentOrgId}/connections/${connectionId}/credentials/rotate`,
        { password: newPassword }
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections', currentOrgId] });
      onClose();
    },
    onError: (err: any) => {
      setError(err.response?.data?.message || err.message || 'Failed to rotate credentials');
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (newPassword.length < 4) {
      setError('Password is too short');
      return;
    }
    setError('');
    rotateMutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card w-full max-w-md rounded-xl shadow-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-primary" /> Rotate Credentials
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-destructive/10 text-destructive border border-destructive/20 p-3 rounded-md flex items-start gap-2 text-sm">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <p>
              You are about to rotate the password for <strong>{connectionName}</strong>. 
              Any executing queries will fail if the old password is no longer valid on the database server.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">New Password</label>
            <input 
              type="password" 
              className="w-full p-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Confirm New Password</label>
            <input 
              type="password" 
              className="w-full p-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className="text-sm text-destructive font-medium">{error}</p>}

          <div className="pt-4 flex justify-end space-x-3">
            <button 
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium hover:bg-muted rounded-md transition-colors"
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={!newPassword || !confirmPassword || rotateMutation.isPending}
              className="px-4 py-2 bg-destructive text-destructive-foreground text-sm font-medium rounded-md hover:bg-destructive/90 transition-colors disabled:opacity-50"
            >
              {rotateMutation.isPending ? 'Rotating...' : 'Rotate Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
