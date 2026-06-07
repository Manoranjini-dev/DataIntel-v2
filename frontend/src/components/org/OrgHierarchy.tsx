'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { useOrgStore } from '../../store/org';
import { Network, ChevronRight, ChevronDown, Building2 } from 'lucide-react';

interface OrgNode {
  id: string;
  name: string;
  slug: string;
  path: string;
}

export function OrgHierarchy() {
  const currentOrgId = useOrgStore(state => state.currentOrgId);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set([currentOrgId || '']));

  // Fetch children of the current org
  const { data: childrenData, isLoading: isLoadingChildren } = useQuery({
    queryKey: ['orgs', currentOrgId, 'children'],
    queryFn: async () => {
      const res = await apiClient.get(`/orgs/${currentOrgId}/children`);
      return res.data;
    },
    enabled: !!currentOrgId,
  });

  // Fetch ancestors of the current org
  const { data: ancestorsData, isLoading: isLoadingAncestors } = useQuery({
    queryKey: ['orgs', currentOrgId, 'ancestors'],
    queryFn: async () => {
      const res = await apiClient.get(`/orgs/${currentOrgId}/ancestors`);
      return res.data;
    },
    enabled: !!currentOrgId,
  });

  const toggleNode = (id: string) => {
    const next = new Set(expandedNodes);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setExpandedNodes(next);
  };

  if (isLoadingChildren || isLoadingAncestors) {
    return <div className="p-8 text-center text-muted-foreground">Loading hierarchy...</div>;
  }

  const ancestors: OrgNode[] = ancestorsData?.ancestors || [];
  const children: OrgNode[] = childrenData?.children || [];

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm max-w-3xl">
      <div className="p-6 border-b border-border flex items-center space-x-3">
        <div className="p-2 bg-primary/10 text-primary rounded-md">
          <Network className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Organization Hierarchy</h2>
          <p className="text-sm text-muted-foreground">Manage nested sub-organizations and visibility</p>
        </div>
      </div>

      <div className="p-6">
        <div className="space-y-1 font-mono text-sm">
          {/* Ancestors */}
          {ancestors.map((org, _index) => (
            <div key={org.id} className="flex items-center space-x-2 text-muted-foreground" style={{ paddingLeft: `${_index * 1.5}rem` }}>
              <Building2 className="w-4 h-4" />
              <span>{org.name}</span>
            </div>
          ))}

          {/* Current Org */}
          <div className="flex items-center space-x-2 py-2 text-foreground font-semibold bg-muted/30 rounded px-2" style={{ marginLeft: `${ancestors.length * 1.5}rem` }}>
            <button onClick={() => toggleNode(currentOrgId!)} className="hover:bg-muted p-1 rounded">
              {expandedNodes.has(currentOrgId!) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            <Building2 className="w-4 h-4 text-primary" />
            <span>Current Organization</span>
          </div>

          {/* Children */}
          {expandedNodes.has(currentOrgId!) && children.length > 0 && (
            <div className="mt-2 space-y-1">
              {children.map((child) => (
                <div key={child.id} className="flex items-center space-x-2 text-muted-foreground hover:text-foreground transition-colors py-1 px-2 hover:bg-muted/30 rounded" style={{ marginLeft: `${(ancestors.length + 1) * 1.5 + 1.5}rem` }}>
                  <Building2 className="w-4 h-4" />
                  <span>{child.name}</span>
                  <span className="text-xs border border-border px-1.5 py-0.5 rounded ml-2 bg-background">{child.slug}</span>
                </div>
              ))}
            </div>
          )}
          {expandedNodes.has(currentOrgId!) && children.length === 0 && (
            <div className="text-muted-foreground italic" style={{ marginLeft: `${(ancestors.length + 1) * 1.5 + 1.5}rem` }}>
              No sub-organizations found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
