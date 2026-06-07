'use client';

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { chatApi } from '../../lib/api';
import { useOrgStore } from '../../store/org';
import { X, Check } from 'lucide-react';

interface ChatPromotionModalProps {
  chatId: string;
  messageId: string;
  onClose: () => void;
  onSuccess: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ChatPromotionModal({ chatId, messageId, onClose, onSuccess }: ChatPromotionModalProps) {
  const currentOrgId = useOrgStore(state => state.currentOrgId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // Example API call to a specific promotion endpoint on the chat controller
  // In a real app this would map to ChatController.promoteToCard
  const promoteMutation = useMutation({
    mutationFn: async () => {
      // We assume an endpoint like POST /orgs/:orgId/chats/:chatId/messages/:messageId/promote
      // But based on the backend routes it could be POST /orgs/:orgId/chats/:chatId/promote
      // with body { messageId, title, description }
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/orgs/${currentOrgId}/chats/${chatId}/promote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'App-Current-Org': currentOrgId!,
          'Authorization': `Bearer ${localStorage.getItem('auth-storage') ? JSON.parse(localStorage.getItem('auth-storage')!).state.token : ''}`
        },
        body: JSON.stringify({ messageId, title, description }),
      });
      if (!res.ok) throw new Error('Promotion failed');
      return res.json();
    },
    onSuccess: () => {
      onSuccess();
      onClose();
    }
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card w-full max-w-md rounded-xl shadow-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-lg font-semibold">Save as Analytics Card</h2>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Promote this AI-generated answer into a reusable Analytics Card in your library. It can then be added to Dashboards.
          </p>

          <div className="space-y-2">
            <label className="text-sm font-medium">Card Title</label>
            <input 
              type="text" 
              className="w-full p-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g. Monthly Revenue by Region"
              value={title}
              onChange={e => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description (Optional)</label>
            <textarea 
              className="w-full p-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary min-h-[80px]"
              placeholder="What does this card show?"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
        </div>

        <div className="p-4 border-t border-border bg-muted/20 flex justify-end space-x-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium hover:bg-muted rounded-md transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={() => promoteMutation.mutate()}
            disabled={!title || promoteMutation.isPending}
            className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {promoteMutation.isPending ? (
              <span>Saving...</span>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Save to Library</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
