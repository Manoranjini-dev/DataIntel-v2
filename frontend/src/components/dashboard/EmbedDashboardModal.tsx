'use client';

// ──────────────────────────────────────────────
// Embed Dashboard modal (DB2-03)
// Enable/disable embedding for a published dashboard and copy the generated
// iframe / JavaScript snippet. Access is token-gated + publish-gated server-side.
// ──────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check, Code2, Globe, ShieldAlert } from 'lucide-react';
import { dashboardApi } from '@/lib/api';

interface EmbedDashboardModalProps {
  dashId: string;
  dashName: string;
  isPublished: boolean;
  initialEnabled: boolean;
  initialToken: string | null;
  onClose: () => void;
  onChange?: (state: { embed_enabled: boolean; embed_token: string | null }) => void;
}

export function EmbedDashboardModal({
  dashId, dashName, isPublished, initialEnabled, initialToken, onClose, onChange,
}: EmbedDashboardModalProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [token, setToken] = useState<string | null>(initialToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'iframe' | 'js' | null>(null);
  const [responsive, setResponsive] = useState(true);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const embedUrl = token ? `${origin}/embed/${token}` : '';
  const safeName = dashName.replace(/"/g, '&quot;');

  const iframeCode = useMemo(() => {
    if (!embedUrl) return '';
    if (responsive) {
      return `<div style="position:relative;width:100%;padding-top:62.5%;">
  <iframe src="${embedUrl}" title="${safeName}"
    style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;"
    allowfullscreen loading="lazy"></iframe>
</div>`;
    }
    return `<iframe src="${embedUrl}" title="${safeName}" width="100%" height="800" style="border:0;" allowfullscreen loading="lazy"></iframe>`;
  }, [embedUrl, responsive, safeName]);

  const jsCode = useMemo(() => {
    if (!token || !embedUrl) return '';
    return `<div id="c1x-dash-${token}"></div>
<script>
(function(){
  var mount=document.getElementById("c1x-dash-${token}");
  var f=document.createElement("iframe");
  f.src="${embedUrl}";
  f.title="${safeName}";
  f.loading="lazy";
  f.setAttribute("allowfullscreen","");
  f.style.cssText="width:100%;height:800px;border:0;";
  mount.appendChild(f);
})();
</script>`;
  }, [token, embedUrl, safeName]);

  async function toggle(next: boolean) {
    setBusy(true); setError('');
    try {
      const res = await dashboardApi.setEmbed(dashId, next);
      setEnabled(res.embed_enabled);
      setToken(res.embed_token);
      onChange?.(res);
    } catch (e: any) {
      setError(e?.structured?.message || e?.message || 'Failed to update embedding');
    } finally {
      setBusy(false);
    }
  }

  function copy(kind: 'iframe' | 'js', text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Embed dashboard</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-auto">
          {!isPublished && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Only <b>published</b> dashboards can be embedded. Publish this dashboard first — embed links stay in sync with the published version and stop working if you unpublish.</span>
            </div>
          )}

          <label className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-border">
            <span className="flex items-center gap-2 text-sm text-foreground">
              <Globe className="w-4 h-4 text-muted-foreground" /> Enable embedding
            </span>
            <input
              type="checkbox"
              checked={enabled}
              disabled={!isPublished || busy}
              onChange={(e) => toggle(e.target.checked)}
              className="w-4 h-4 accent-primary disabled:opacity-40"
            />
          </label>

          {error && <p className="text-xs text-destructive">{error}</p>}

          {enabled && token && (
            <>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={responsive} onChange={(e) => setResponsive(e.target.checked)} className="w-3.5 h-3.5 accent-primary" />
                Responsive (auto-fit width)
              </label>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">iframe embed code</p>
                  <button onClick={() => copy('iframe', iframeCode)} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-border hover:bg-muted text-foreground">
                    {copied === 'iframe' ? <><Check className="w-3 h-3 text-success" />Copied</> : <><Copy className="w-3 h-3" />Copy</>}
                  </button>
                </div>
                <pre className="text-[11px] bg-muted/50 border border-border rounded-xl p-3 overflow-auto whitespace-pre-wrap break-all text-foreground">{iframeCode}</pre>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">JavaScript embed snippet</p>
                  <button onClick={() => copy('js', jsCode)} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-border hover:bg-muted text-foreground">
                    {copied === 'js' ? <><Check className="w-3 h-3 text-success" />Copied</> : <><Copy className="w-3 h-3" />Copy</>}
                  </button>
                </div>
                <pre className="text-[11px] bg-muted/50 border border-border rounded-xl p-3 overflow-auto whitespace-pre-wrap break-all text-foreground">{jsCode}</pre>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Anyone with this code can view the published dashboard. Disable embedding above to revoke access immediately.
              </p>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
