import Link from 'next/link';
import {
  ArrowRight, Bot, CheckCircle2, Database, Layers,
  LayoutDashboard, MessageSquare, Shield, Zap,
} from 'lucide-react';

// ── Static data ──────────────────────────────────────────────────
const features = [
  {
    icon: MessageSquare,
    title: 'Ask in plain English',
    body: 'No SQL required. Ask natural questions and get precise data answers in seconds.',
  },
  {
    icon: Shield,
    title: 'Approval-first safety',
    body: 'Every generated query passes deterministic validation before it ever touches your database.',
  },
  {
    icon: LayoutDashboard,
    title: 'Instant visual answers',
    body: 'Charts, metric cards, and AI-written summaries are generated automatically from results.',
  },
  {
    icon: Layers,
    title: 'Cross-source Combos',
    body: 'Query across multiple databases simultaneously with one natural-language prompt.',
  },
  {
    icon: Database,
    title: 'Broad connector support',
    body: 'PostgreSQL, MySQL, MSSQL, MongoDB, Snowflake, BigQuery, Redshift, and more.',
  },
  {
    icon: Bot,
    title: 'AI-generated dashboards',
    body: 'Describe what you want to see and let C1X build the entire dashboard layout for you.',
  },
];

const steps = [
  {
    n: '01',
    title: 'Connect a data source',
    body: 'Add credentials once. C1X maps your schema and builds context automatically.',
  },
  {
    n: '02',
    title: 'Ask your business question',
    body: 'Type naturally — revenue trends, top customers, anomalies, or anything in between.',
  },
  {
    n: '03',
    title: 'Review & run',
    body: 'Inspect the generated SQL, adjust it if you like, then execute and get your answer.',
  },
];

const connectors = ['PostgreSQL', 'MySQL', 'MSSQL', 'MongoDB', 'Snowflake', 'BigQuery', 'Redshift', 'Databricks'];

// ── Page ─────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[hsl(30_5%_11%)] text-[hsl(38_8%_96%)] overflow-x-hidden">

      {/* Ambient background blobs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-[#D97A1E]/10 blur-[120px]" />
        <div className="absolute top-1/3 -right-32 w-[500px] h-[500px] rounded-full bg-[#F5A623]/8 blur-[100px]" />
        <div className="absolute bottom-0 left-1/2 w-[400px] h-[400px] rounded-full bg-[hsl(200_40%_51%)]/6 blur-[80px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-6 lg:px-10">

        {/* ── Header ─────────────────────────────────────────── */}
        <header className="flex items-center justify-between py-5">
          <div className="flex items-center gap-3">
            <img src="/image.png" alt="C1X Logo" style={{ height: 32, width: 'auto', objectFit: 'contain' }} />
            <p className="text-[11px] text-[hsl(35_4%_55%)] pt-0.5">SQL Intelligence Platform</p>
          </div>

          <nav className="flex items-center gap-3">
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium text-[hsl(38_8%_80%)] hover:text-white transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
            >
              Get started
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </nav>
        </header>

        {/* ── Hero ───────────────────────────────────────────── */}
        <section className="mt-24 pb-20 text-center max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full border border-[#D97A1E]/30 bg-[#D97A1E]/10 text-xs font-semibold text-[#F5A623]">
            <Zap className="w-3.5 h-3.5" />
            AI-powered SQL intelligence for every team
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-white leading-[1.08]">
            Turn questions into<br />
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: 'linear-gradient(135deg, #D97A1E, #F5A623, #fbbf24)' }}
            >
              data answers
            </span>
          </h1>

          <p className="mt-6 text-lg text-[hsl(38_8%_70%)] max-w-2xl mx-auto leading-relaxed">
            C1X translates plain-English questions into validated SQL, executes them safely,
            and returns charts and AI-written insights your whole team can act on.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
            >
              Start for free
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/login"
              className="px-7 py-3.5 rounded-xl text-sm font-semibold border border-[hsl(30_4%_28%)] bg-[hsl(30_5%_14%)] text-[hsl(38_8%_80%)] hover:border-[#D97A1E]/40 hover:text-white transition-all"
            >
              Sign in to workspace
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-sm text-[hsl(35_4%_55%)]">
            {['Human-in-the-loop approval', 'Deterministic query validation', 'Multi-database ready'].map(t => (
              <span key={t} className="inline-flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#D97A1E]" />
                {t}
              </span>
            ))}
          </div>
        </section>

        {/* ── Features ───────────────────────────────────────── */}
        <section className="pb-20">
          <p className="text-center text-xs font-bold uppercase tracking-widest text-[hsl(35_4%_50%)] mb-3">
            What C1X does
          </p>
          <h2 className="text-center text-3xl font-bold text-white mb-10">
            Everything your data team needs
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map(f => (
              <div
                key={f.title}
                className="p-6 rounded-2xl border border-[hsl(30_4%_20%)] bg-[hsl(30_5%_13%)] hover:border-[#D97A1E]/30 hover:bg-[hsl(30_5%_14%)] transition-all group"
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: 'rgba(217,122,30,0.12)' }}
                >
                  <f.icon className="w-5 h-5 text-[#D97A1E]" />
                </div>
                <h3 className="text-sm font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-[hsl(35_4%_55%)] leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ───────────────────────────────────── */}
        <section className="pb-20">
          <div className="rounded-2xl border border-[hsl(30_4%_20%)] bg-[hsl(30_5%_13%)] p-8 lg:p-12">
            <div className="grid gap-10 lg:grid-cols-2 items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-[hsl(35_4%_50%)] mb-3">How it works</p>
                <h2 className="text-3xl font-bold text-white mb-4">
                  Three steps to your answer
                </h2>
                <p className="text-[hsl(38_8%_70%)] leading-relaxed mb-6">
                  Designed for speed and safety — from natural-language question to trusted insight
                  in under 30 seconds.
                </p>

                <div className="flex flex-wrap gap-2">
                  {connectors.map(c => (
                    <span
                      key={c}
                      className="text-xs px-3 py-1.5 rounded-full border border-[hsl(30_4%_22%)] text-[hsl(35_4%_55%)] bg-[hsl(30_5%_14%)]"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                {steps.map((s, i) => (
                  <div
                    key={s.n}
                    className="flex gap-4 p-5 rounded-xl border border-[hsl(30_4%_20%)] bg-[hsl(30_5%_12%)]"
                  >
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5"
                      style={{ background: i === 0 ? 'linear-gradient(135deg,#D97A1E,#F5A623)' : 'rgba(217,122,30,0.15)' }}
                    >
                      <span className={i === 0 ? 'text-white' : 'text-[#D97A1E]'}>{s.n}</span>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white mb-1">{s.title}</p>
                      <p className="text-sm text-[hsl(35_4%_55%)] leading-relaxed">{s.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── CTA banner ─────────────────────────────────────── */}
        <section className="pb-24">
          <div
            className="rounded-2xl p-10 text-center"
            style={{ background: 'linear-gradient(135deg, rgba(217,122,30,0.15), rgba(245,166,35,0.10), rgba(80,160,180,0.08))', border: '1px solid rgba(217,122,30,0.25)' }}
          >
            <h2 className="text-3xl font-bold text-white mb-3">
              Ready to ask your first question?
            </h2>
            <p className="text-[hsl(38_8%_70%)] mb-8 max-w-lg mx-auto">
              Connect your database, type a question in plain English, and get a verified answer in seconds.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/register"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl text-sm font-bold text-white hover:opacity-90 transition-opacity"
                style={{ background: 'linear-gradient(135deg, #D97A1E, #F5A623)' }}
              >
                <Zap className="w-4 h-4" />
                Create your workspace
              </Link>
              <Link
                href="/login"
                className="px-7 py-3.5 rounded-xl text-sm font-semibold border border-[hsl(30_4%_28%)] bg-[hsl(30_5%_14%)] text-[hsl(38_8%_80%)] hover:text-white transition-colors"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>

        {/* ── Footer ─────────────────────────────────────────── */}
        <footer className="border-t border-[hsl(30_4%_18%)] py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[hsl(35_4%_45%)]">
          <div className="flex items-center gap-2.5">
            <img src="/image.png" alt="C1X Logo" style={{ height: 18, width: 'auto', objectFit: 'contain' }} />
            <span className="ml-1">· SQL Intelligence Platform</span>
          </div>
          <span>© {new Date().getFullYear()} C1X. All rights reserved.</span>
        </footer>

      </div>
    </main>
  );
}
