'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { connectionApi, orgApi } from '@/lib/api';

const CONNECTORS = [
  { type: 'postgres',      label: 'PostgreSQL',    abbr: 'PG', color: 'text-sky-400 bg-sky-500/10',         defaultPort: 5432  },
  { type: 'mysql',         label: 'MySQL',         abbr: 'MY', color: 'text-blue-400 bg-blue-500/10',       defaultPort: 3306  },
  { type: 'mssql',         label: 'SQL Server',    abbr: 'MS', color: 'text-blue-300 bg-blue-600/10',       defaultPort: 1433  },
  { type: 'snowflake',     label: 'Snowflake',     abbr: 'SF', color: 'text-cyan-400 bg-cyan-500/10',       defaultPort: 443   },
  { type: 'bigquery',      label: 'BigQuery',      abbr: 'BQ', color: 'text-amber-400 bg-amber-500/10',     defaultPort: 443   },
  { type: 'redshift',      label: 'Redshift',      abbr: 'RS', color: 'text-red-400 bg-red-500/10',         defaultPort: 5439  },
  { type: 'mongodb',       label: 'MongoDB',       abbr: 'MG', color: 'text-green-400 bg-green-500/10',     defaultPort: 27017 },
  { type: 'elasticsearch', label: 'Elasticsearch', abbr: 'ES', color: 'text-yellow-400 bg-yellow-500/10',   defaultPort: 9200  },
  { type: 'databricks',    label: 'Databricks',    abbr: 'DB', color: 'text-orange-400 bg-orange-500/10',   defaultPort: 443   },
  { type: 'oracle',        label: 'Oracle',        abbr: 'OR', color: 'text-red-300 bg-red-400/10',         defaultPort: 1521  },
];

const inputCls = 'w-full px-3 py-2.5 bg-muted/50 border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40';

export default function NewConnectionPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [selected, setSelected] = useState(CONNECTORS[0]);
  const [form, setForm] = useState({
    name: '', host: '', port: 5432, databaseName: '',
    username: '', password: '', sslEnabled: false, description: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function handleConnectorSelect(c: typeof CONNECTORS[0]) {
    setSelected(c);
    setForm(f => ({ ...f, port: c.defaultPort }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { org } = await orgApi.get(slug);
      await connectionApi.create(org.id, { ...form, connectorType: selected.type });
      router.push(`/orgs/${slug}/connections`);
    } catch (err: any) {
      setError(err?.message || 'Failed to create connection');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 p-8 overflow-auto animate-fade-in">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">New Connection</h1>
          <p className="text-muted-foreground text-sm mt-1">Connect a datasource to your organization</p>
        </div>

        {/* Connector type */}
        <div className="bg-card border border-border rounded-2xl p-5"
          style={{ boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>
          <label className="block text-[13px] font-semibold text-foreground uppercase tracking-widest mb-4">
            Connector Type
          </label>
          <div className="grid grid-cols-5 gap-2">
            {CONNECTORS.map(c => (
              <button key={c.type} type="button" onClick={() => handleConnectorSelect(c)}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border text-sm transition-all ${
                  selected.type === c.type
                    ? 'border-primary/50 bg-primary/10 text-primary shadow-sm'
                    : 'border-border bg-muted/30 text-muted-foreground hover:border-primary/20 hover:bg-primary/5'
                }`}>
                <span className={`text-[11px] font-extrabold tracking-widest px-2 py-1 rounded-md ${c.color}`}>{c.abbr}</span>
                <span className="text-[11px] font-medium">{c.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}
          className="bg-card border border-border rounded-2xl p-6 space-y-5"
          style={{ boxShadow: '0 1px 4px rgba(0,0,0,.06)' }}>

          <h2 className="text-[13px] font-semibold text-foreground uppercase tracking-widest">
            {selected.label} Configuration
          </h2>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Connection Name</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder={`My ${selected.label}`} required className={inputCls} />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Description <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="What does this connection do?" className={inputCls} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Host</label>
              <input value={form.host} onChange={e => setForm({ ...form, host: e.target.value })}
                placeholder="localhost" required className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Port</label>
              <input type="number" value={form.port}
                onChange={e => setForm({ ...form, port: parseInt(e.target.value) })}
                required className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Database Name</label>
            <input value={form.databaseName} onChange={e => setForm({ ...form, databaseName: e.target.value })}
              placeholder="my_database" required className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Username</label>
              <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
                required className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Password</label>
              <input type="password" value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                required className={inputCls} />
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <input type="checkbox" id="ssl" checked={form.sslEnabled}
              onChange={e => setForm({ ...form, sslEnabled: e.target.checked })}
              className="w-4 h-4 accent-primary rounded" />
            <label htmlFor="ssl" className="text-sm text-foreground">Enable SSL</label>
          </div>

          {error && (
            <div className="px-4 py-3 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Link href={`/orgs/${slug}/connections`}
              className="flex-1 py-2.5 rounded-xl border border-border text-muted-foreground text-sm text-center hover:bg-muted/50 transition-colors font-medium">
              Cancel
            </Link>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
              {loading ? 'Creating…' : 'Create Connection'}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
