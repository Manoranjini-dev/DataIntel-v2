'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert, Check } from 'lucide-react';
import { ssoAdminApi, type AdminSsoProvider, type UpsertSsoProvider } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/** Which config fields each provider exposes (label + config key). */
const CONFIG_FIELDS: Record<string, { key: string; label: string; placeholder?: string }[]> = {
  google: [
    { key: 'clientId', label: 'Client ID', placeholder: 'xxxx.apps.googleusercontent.com' },
    { key: 'hostedDomain', label: 'Hosted domain (optional)', placeholder: 'company.com' },
  ],
  entra: [
    { key: 'clientId', label: 'Application (client) ID' },
    { key: 'tenantId', label: 'Directory (tenant) ID', placeholder: 'common or a tenant GUID' },
  ],
  ldap: [
    { key: 'url', label: 'Server URL', placeholder: 'ldaps://dc.corp.com:636' },
    { key: 'baseDN', label: 'Base DN', placeholder: 'DC=corp,DC=com' },
    { key: 'bindDN', label: 'Bind DN (service account)', placeholder: 'CN=svc,OU=svc,DC=corp,DC=com' },
    { key: 'userFilter', label: 'User filter', placeholder: '(sAMAccountName={{username}})' },
    { key: 'upnSuffix', label: 'UPN suffix (direct-bind fallback)', placeholder: 'corp.com' },
  ],
};

const SECRET_LABEL: Record<string, string> = {
  google: 'Client secret',
  entra: 'Client secret',
  ldap: 'Bind password',
};

const input = 'w-full px-3 py-2 bg-muted/50 border border-border rounded-lg text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

function ProviderCard({ p, onSaved }: { p: AdminSsoProvider; onSaved: (msg: string) => void }) {
  const [enabled, setEnabled] = useState(p.enabled);
  const [config, setConfig] = useState<Record<string, any>>(p.config || {});
  const [secret, setSecret] = useState('');
  const [autoProvision, setAutoProvision] = useState(p.autoProvision);
  const [domains, setDomains] = useState((p.allowedDomains || []).join(', '));
  const [defaultRole, setDefaultRole] = useState(p.defaultRole);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setError('');
    try {
      const body: UpsertSsoProvider = {
        enabled,
        config,
        autoProvision,
        allowedDomains: domains.split(',').map((d) => d.trim()).filter(Boolean),
        defaultRole,
      };
      if (secret) body.secret = secret;
      await ssoAdminApi.upsert(p.provider, body);
      setSecret('');
      onSaved(`${p.displayName || p.provider} saved`);
    } catch (err: any) {
      setError(err?.structured?.message || err?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">{p.displayName || p.provider}</h3>
          <p className="text-xs text-muted-foreground">Provider: {p.provider}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {CONFIG_FIELDS[p.provider]?.map((f) => (
          <div key={f.key}>
            <label className="block text-xs font-medium text-foreground mb-1">{f.label}</label>
            <input
              className={input}
              value={config[f.key] ?? ''}
              placeholder={f.placeholder}
              onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}
            />
          </div>
        ))}
        <div>
          <label className="block text-xs font-medium text-foreground mb-1">
            {SECRET_LABEL[p.provider]} {p.hasSecret && <span className="text-emerald-400">(configured)</span>}
          </label>
          <input
            className={input}
            type="password"
            value={secret}
            placeholder={p.hasSecret ? '•••••••• (leave blank to keep)' : 'Enter secret'}
            onChange={(e) => setSecret(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-border">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={autoProvision} onChange={(e) => setAutoProvision(e.target.checked)} />
          Auto-provision new users
        </label>
        <div>
          <label className="block text-xs font-medium text-foreground mb-1">Allowed email domains</label>
          <input className={input} value={domains} placeholder="corp.com, sub.corp.com" onChange={(e) => setDomains(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-foreground mb-1">Default role</label>
          <select className={input} value={defaultRole} onChange={(e) => setDefaultRole(e.target.value as any)}>
            <option value="VIEWER">Viewer</option>
            <option value="ANALYST">Analyst</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="py-2 px-5 text-white font-semibold rounded-xl text-sm disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

export default function SsoAdminPage() {
  const { user } = useAuthStore();
  const [providers, setProviders] = useState<AdminSsoProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    ssoAdminApi.list().then((r) => setProviders(r.providers)).finally(() => setLoading(false));
  }, [user?.role]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  if (user && user.role !== 'ADMIN') {
    return (
      <div className="max-w-3xl mx-auto p-8 text-center">
        <ShieldAlert className="w-10 h-10 mx-auto text-destructive mb-3" />
        <h1 className="text-lg font-semibold text-foreground">Admins only</h1>
        <p className="text-sm text-muted-foreground">You do not have permission to configure SSO.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Single Sign-On</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure identity providers for your organization. Username/password login always remains available.
        </p>
      </div>

      {toast && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
          <Check className="w-4 h-4" /> {toast}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        providers.map((p) => <ProviderCard key={p.provider} p={p} onSaved={showToast} />)
      )}
    </div>
  );
}
