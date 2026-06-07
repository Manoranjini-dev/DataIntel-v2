'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useOrgStore } from '../../store/org';
import { Check, X, Clock, Database, User, ShieldAlert } from 'lucide-react';

export function QueryApprovalList() {
  const currentOrgId = useOrgStore(state => state.currentOrgId);
  const queryClient = useQueryClient();
  const [rejectReason, setRejectReason] = useState<{ [id: string]: string }>({});
  const [showRejectInput, setShowRejectInput] = useState<{ [id: string]: boolean }>({});

  const { data: approvalsData, isLoading } = useQuery({
    queryKey: ['query-approvals', currentOrgId],
    queryFn: async () => {
      const res = await apiClient.get(`/orgs/${currentOrgId}/query-approvals/pending`);
      return res.data?.approvals || [];
    },
    enabled: !!currentOrgId,
  });

  const approveMutation = useMutation({
    mutationFn: async (approvalId: string) => {
      await apiClient.post(`/orgs/${currentOrgId}/query-approvals/${approvalId}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['query-approvals', currentOrgId] });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ approvalId, reason }: { approvalId: string, reason?: string }) => {
      await apiClient.post(`/orgs/${currentOrgId}/query-approvals/${approvalId}/reject`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['query-approvals', currentOrgId] });
    }
  });

  if (isLoading) return <div className="p-8">Loading pending approvals...</div>;

  const approvals = approvalsData || [];

  if (approvals.length === 0) {
    return (
      <div className="p-12 text-center bg-card border border-border rounded-lg shadow-sm">
        <ShieldAlert className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
        <h3 className="text-lg font-medium">No Pending Approvals</h3>
        <p className="text-muted-foreground mt-1">All query execution requests have been resolved.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {approvals.map((approval: any) => (
        <div key={approval.id} className="bg-card border border-border rounded-lg shadow-sm overflow-hidden">
          <div className="p-4 border-b border-border bg-muted/20 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-sm font-medium text-amber-600 bg-amber-500/10 px-2.5 py-1 rounded-md">
                <Clock className="w-4 h-4" /> Pending Review
              </div>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Database className="w-4 h-4" /> {approval.connection_name || 'Datasource'}
              </div>
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <User className="w-4 h-4" /> {approval.requester_name || approval.requester_id}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(approval.created_at).toLocaleString()}
            </div>
          </div>

          <div className="p-4 space-y-4">
            <div>
              <h4 className="text-sm font-semibold mb-1 text-muted-foreground uppercase tracking-wider">Original Prompt</h4>
              <p className="text-sm">{approval.prompt}</p>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-1 text-muted-foreground uppercase tracking-wider">Generated Query</h4>
              <div className="bg-muted/50 p-3 rounded-md font-mono text-sm overflow-x-auto whitespace-pre-wrap border border-border/50">
                {approval.generated_query}
              </div>
            </div>

            {showRejectInput[approval.id] ? (
              <div className="pt-2">
                <label className="text-sm font-medium mb-1 block">Reason for Rejection</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={rejectReason[approval.id] || ''}
                    onChange={(e) => setRejectReason({ ...rejectReason, [approval.id]: e.target.value })}
                    className="flex-1 p-2 bg-background border border-border rounded-md text-sm"
                    placeholder="Why is this query being rejected?"
                    autoFocus
                  />
                  <button
                    onClick={() => rejectMutation.mutate({ approvalId: approval.id, reason: rejectReason[approval.id] })}
                    className="px-4 py-2 bg-destructive text-destructive-foreground rounded-md text-sm font-medium hover:bg-destructive/90"
                  >
                    Confirm Reject
                  </button>
                  <button
                    onClick={() => setShowRejectInput({ ...showRejectInput, [approval.id]: false })}
                    className="px-4 py-2 bg-muted rounded-md text-sm font-medium hover:bg-muted/80"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => approveMutation.mutate(approval.id)}
                  disabled={approveMutation.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md text-sm font-medium hover:bg-emerald-700 transition-colors"
                >
                  <Check className="w-4 h-4" /> {approveMutation.isPending ? 'Approving...' : 'Approve Execution'}
                </button>
                <button
                  onClick={() => setShowRejectInput({ ...showRejectInput, [approval.id]: true })}
                  className="flex items-center gap-2 px-4 py-2 bg-destructive/10 text-destructive rounded-md text-sm font-medium hover:bg-destructive/20 transition-colors"
                >
                  <X className="w-4 h-4" /> Reject
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
