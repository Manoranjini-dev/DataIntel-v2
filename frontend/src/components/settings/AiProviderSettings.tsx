'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useOrgStore } from '../../store/org';
import { Save, Key, Cpu, Trash2, CheckCircle2 } from 'lucide-react';

export function AiProviderSettings() {
  const currentOrgId = useOrgStore(state => state.currentOrgId);
  const queryClient = useQueryClient();

  const [providerName, setProviderName] = useState('openrouter');
  const [modelName, setModelName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');

  const { data: configData, isLoading } = useQuery({
    queryKey: ['org-ai-config', currentOrgId],
    queryFn: async () => {
      const res = await apiClient.get(`/orgs/\${currentOrgId}/settings/ai-provider`);
      return res.data?.config;
    },
    enabled: !!currentOrgId,
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      await apiClient.put(`/orgs/\${currentOrgId}/settings/ai-provider`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-ai-config', currentOrgId] });
      setApiKey(''); // clear key from input after saving
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiClient.delete(`/orgs/\${currentOrgId}/settings/ai-provider`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-ai-config', currentOrgId] });
      setProviderName('openrouter');
      setModelName('');
      setApiBaseUrl('');
      setApiKey('');
    }
  });

  // Populate form on load
  React.useEffect(() => {
    if (configData) {
      setProviderName(configData.providerName);
      setModelName(configData.modelName || '');
      setApiBaseUrl(configData.apiBaseUrl || '');
    }
  }, [configData]);

  if (isLoading) return <div className="p-4">Loading settings...</div>;

  return (
    <div className="max-w-2xl bg-card border border-border rounded-lg shadow-sm">
      <div className="p-6 border-b border-border">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Cpu className="w-5 h-5 text-primary" /> 
          AI Provider Settings
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure a custom LLM provider for this organization. If not set, the platform&apos;s default provider will be used.
        </p>
      </div>

      <div className="p-6 space-y-6">
        {configData?.hasApiKey && (
          <div className="flex items-center gap-2 text-sm text-emerald-600 bg-success/10 p-3 rounded-md border border-success/20">
            <CheckCircle2 className="w-4 h-4" />
            Custom provider is currently active for this organization.
          </div>
        )}

        <div className="space-y-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium">Provider Name</label>
            <select 
              value={providerName}
              onChange={e => setProviderName(e.target.value)}
              className="w-full p-2 bg-background border border-border rounded-md focus:ring-2 focus:ring-primary outline-none"
            >
              <option value="openrouter">OpenRouter</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="cerebras">Cerebras</option>
            </select>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">Default Model Name</label>
            <input 
              type="text" 
              placeholder="e.g. gpt-4o or meta-llama/llama-3-70b-instruct"
              value={modelName}
              onChange={e => setModelName(e.target.value)}
              className="w-full p-2 bg-background border border-border rounded-md focus:ring-2 focus:ring-primary outline-none"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium">API Base URL (Optional)</label>
            <input 
              type="text" 
              placeholder="e.g. https://api.openai.com/v1"
              value={apiBaseUrl}
              onChange={e => setApiBaseUrl(e.target.value)}
              className="w-full p-2 bg-background border border-border rounded-md focus:ring-2 focus:ring-primary outline-none"
            />
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium flex items-center gap-1">
              <Key className="w-4 h-4" /> API Key {configData?.hasApiKey && <span className="text-muted-foreground font-normal">(Leave blank to keep existing key)</span>}
            </label>
            <input 
              type="password" 
              placeholder={configData?.hasApiKey ? "••••••••••••••••" : "Enter your API key"}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              className="w-full p-2 bg-background border border-border rounded-md focus:ring-2 focus:ring-primary outline-none font-mono"
            />
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-border bg-muted/20 flex justify-between">
        {configData ? (
          <button 
            onClick={() => deleteMutation.mutate()}
            className="flex items-center gap-2 px-4 py-2 text-destructive hover:bg-destructive/10 rounded-md transition-colors font-medium text-sm"
          >
            <Trash2 className="w-4 h-4" /> Revert to Default
          </button>
        ) : <div />}

        <button 
          onClick={() => saveMutation.mutate({ providerName, modelName, apiKey: apiKey || undefined, apiBaseUrl })}
          disabled={(!configData && !apiKey) || saveMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors font-medium text-sm disabled:opacity-50"
        >
          <Save className="w-4 h-4" /> {saveMutation.isPending ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
}
