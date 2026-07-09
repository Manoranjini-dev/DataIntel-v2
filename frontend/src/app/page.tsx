'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import {
  ArrowRight, Bot, CheckCircle2, Clock, Database, Layers,
  LayoutDashboard, MessageSquare, Shield, TrendingUp, Users, Zap,
} from 'lucide-react';
import { useAuthStore } from '@/lib/auth-store';
import { authApi } from '@/lib/api';
import { SignOutConfirmationModal } from '@/components/layout/SignOutConfirmationModal';

// ── SSR-safe 3D scene ─────────────────────────────────────────────
const DataNetworkScene = dynamic(
  () => import('@/components/three/DataNetworkScene'),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full h-full rounded-3xl"
        style={{ background: 'radial-gradient(ellipse at 60% 40%, rgba(217,122,30,0.08) 0%, #F0F1F3 100%)' }}
      />
    ),
  },
);

// ── Design tokens (landing-only, scoped inline) ───────────────────
const C = {
  bg:        '#F4F5F7',
  bgAlt:     '#EEEFF2',
  card:      '#FFFFFF',
  dark:      '#111117',
  darkCard:  '#1A1B21',
  orange:    '#D97A1E',
  orangeLt:  '#F5A623',
  text1:     '#111117',
  text2:     '#374151',
  text3:     '#6B7280',
  text4:     '#9CA3AF',
  border:    '#E5E7EB',
  borderDk:  'rgba(255,255,255,0.08)',
  orangeGrad:'linear-gradient(135deg, #D97A1E, #F5A623)',
  orangeGradH:'linear-gradient(135deg, #C96A10, #D97A1E, #F5A623, #fbbf24)',
};

// ── Static data ───────────────────────────────────────────────────
const features = [
  { icon: MessageSquare, title: 'Ask in plain English',      body: 'No SQL required. Ask natural questions and get precise data answers in seconds.' },
  { icon: Shield,        title: 'Approval-first safety',     body: 'Every generated query passes deterministic validation before it touches your database.' },
  { icon: LayoutDashboard, title: 'Instant visual answers',  body: 'Charts, metric cards, and AI-written summaries are generated automatically from results.' },
  { icon: Layers,        title: 'Cross-source Combos',       body: 'Query across multiple databases simultaneously with one natural-language prompt.' },
  { icon: Database,      title: 'Broad connector support',   body: 'PostgreSQL, MySQL, MSSQL, MongoDB, Snowflake, BigQuery, Redshift, Databricks.' },
  { icon: Bot,           title: 'AI-generated dashboards',   body: 'Describe what you want to see and let C1X build the entire dashboard layout for you.' },
];

const steps = [
  {
    n: '01', title: 'Connect a data source',
    body: 'Add credentials once. C1X maps your schema and builds context automatically.',
    note: 'Supports PostgreSQL, MySQL, MSSQL, MongoDB, Snowflake, BigQuery & more.',
  },
  {
    n: '02', title: 'Ask your business question',
    body: 'Type naturally — revenue trends, top customers, anomalies, or anything in between.',
    note: 'Understands date ranges, aggregations, joins, and complex business logic.',
  },
  {
    n: '03', title: 'Review & run',
    body: 'Inspect the generated SQL, adjust it if you like, then execute and get your answer.',
    note: 'Full transparency. Edit before running. Charts auto-generated from results.',
  },
];

const connectors = [
  'PostgreSQL', 'MySQL', 'MSSQL', 'MongoDB', 'Snowflake',
  'BigQuery', 'Redshift', 'Databricks', 'SQLite', 'Elasticsearch',
];

const stats = [
  { icon: Clock,     value: '< 30s',  label: 'Time to first insight' },
  { icon: Database,  value: '8+',     label: 'Database connectors'   },
  { icon: CheckCircle2, value: '100%', label: 'Query validation'     },
];

// ── Framer Motion helpers ─────────────────────────────────────────
const inView = {
  hidden: { opacity: 0, y: 28 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
};
const staggerChildren = {
  show: { transition: { staggerChildren: 0.09 } },
};

// ─────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { isAuthenticated, clearUser } = useAuthStore();
  const [scrolled, setScrolled] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const handleSignOut = async () => {
    try { await authApi.logout(); } catch { /* ignore network errors */ }
    clearUser();
    window.location.replace('/');
  };

  return (
    <div style={{ background: C.bg, color: C.text1, overflowX: 'hidden' }} className="min-h-screen">

      {/* ════════════════════════════════════════════════════════
          STICKY HEADER
      ════════════════════════════════════════════════════════ */}
      <header
        className="fixed top-0 inset-x-0 z-50 transition-all duration-300"
        style={{
          background:    scrolled ? 'rgba(244,245,247,0.88)' : 'transparent',
          backdropFilter: scrolled ? 'blur(14px) saturate(180%)' : 'none',
          borderBottom:  scrolled ? `1px solid ${C.border}` : '1px solid transparent',
          boxShadow:     scrolled ? '0 1px 24px rgba(0,0,0,0.06)' : 'none',
        }}
      >
        <div className="mx-auto max-w-7xl px-6 lg:px-10 flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <img src="/image.png" alt="C1X" style={{ height: 28, width: 'auto' }} />
            <span className="hidden sm:block text-[10px] font-semibold tracking-wide" style={{ color: C.text4 }}>
              DATA INTELLIGENCE
            </span>
          </div>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            <a
              href="#features"
              className="px-4 py-2 text-sm font-medium rounded-xl transition-colors"
              style={{ color: C.text3 }}
              onMouseEnter={e => (e.currentTarget.style.color = C.text1)}
              onMouseLeave={e => (e.currentTarget.style.color = C.text3)}
            >
              Features
            </a>
            <a
              href="#how-it-works"
              className="px-4 py-2 text-sm font-medium rounded-xl transition-colors"
              style={{ color: C.text3 }}
              onMouseEnter={e => (e.currentTarget.style.color = C.text1)}
              onMouseLeave={e => (e.currentTarget.style.color = C.text3)}
            >
              How it works
            </a>
            <div className="w-px h-5 mx-2" style={{ background: C.border }} />
            {isAuthenticated ? (
              <>
                <button
                  onClick={() => setShowSignOutConfirm(true)}
                  className="px-4 py-2 text-sm font-medium transition-colors"
                  style={{ color: C.text3 }}
                >
                  Sign out
                </button>
                <Link
                  href="/dashboards"
                  className="ml-1 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-px"
                  style={{ background: C.orangeGrad, boxShadow: '0 4px 16px -4px rgba(217,122,30,0.4)' }}
                >
                  Dashboard <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  className="px-4 py-2 text-sm font-medium transition-colors"
                  style={{ color: C.text3 }}
                >
                  Sign in
                </Link>
                <Link
                  href="/register"
                  className="ml-1 inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-px"
                  style={{ background: C.orangeGrad, boxShadow: '0 4px 16px -4px rgba(217,122,30,0.4)' }}
                >
                  Get started <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </>
            )}
          </nav>

          {/* Mobile CTA */}
          <div className="flex md:hidden">
            <Link
              href={isAuthenticated ? '/dashboards' : '/register'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white"
              style={{ background: C.orangeGrad }}
            >
              {isAuthenticated ? 'Dashboard' : 'Start free'}
            </Link>
          </div>
        </div>
      </header>

      {/* ════════════════════════════════════════════════════════
          HERO
      ════════════════════════════════════════════════════════ */}
      <section
        className="relative flex items-center"
        style={{ minHeight: '100vh', paddingTop: '5rem', paddingBottom: '4rem' }}
      >
        {/* Ambient gradients */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div style={{ position: 'absolute', top: '-12rem', left: '-12rem', width: '52rem', height: '52rem', borderRadius: '50%', background: 'radial-gradient(circle, rgba(217,122,30,0.07) 0%, transparent 68%)' }} />
          <div style={{ position: 'absolute', top: '30%', right: '-16rem', width: '42rem', height: '42rem', borderRadius: '50%', background: 'radial-gradient(circle, rgba(217,122,30,0.045) 0%, transparent 68%)' }} />
          <div style={{ position: 'absolute', bottom: '-8rem', left: '35%', width: '32rem', height: '32rem', borderRadius: '50%', background: 'radial-gradient(circle, rgba(156,163,175,0.09) 0%, transparent 68%)' }} />
        </div>

        <div className="relative mx-auto max-w-7xl px-6 lg:px-10 w-full">
          <div className="grid lg:grid-cols-[55%_45%] gap-10 lg:gap-6 items-center">

            {/* ── Left: copy ── */}
            <div className="lg:pr-6">
              {/* Badge */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="inline-flex items-center gap-2 mb-7 px-4 py-2 rounded-full"
                style={{ border: `1px solid rgba(217,122,30,0.3)`, background: 'rgba(217,122,30,0.07)' }}
              >
                <Zap className="w-3.5 h-3.5" style={{ color: C.orange }} />
                <span className="text-xs font-semibold" style={{ color: C.orange }}>
                  AI-powered data intelligence for every team
                </span>
              </motion.div>

              {/* Headline */}
              <motion.h1
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1], delay: 0.07 }}
                className="font-black tracking-tighter leading-[1.03] mb-6"
                style={{ fontSize: 'clamp(3rem, 6vw, 5.5rem)', color: C.text1 }}
              >
                Ask your data<br />
                <span
                  className="bg-clip-text text-transparent"
                  style={{ backgroundImage: C.orangeGradH }}
                >
                  anything.
                </span>
              </motion.h1>

              {/* Sub-copy */}
              <motion.p
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.14 }}
                className="text-lg leading-relaxed mb-10 max-w-lg"
                style={{ color: C.text3 }}
              >
                C1X translates plain-English questions into validated SQL, executes them safely,
                and returns charts and AI summaries your whole team can act on — in under 30 seconds.
              </motion.p>

              {/* CTAs */}
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
                className="flex flex-wrap gap-4 mb-10"
              >
                {isAuthenticated ? (
                  <Link
                    href="/dashboards"
                    className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:opacity-95"
                    style={{ background: C.orangeGrad, boxShadow: '0 10px 28px -6px rgba(217,122,30,0.42)' }}
                  >
                    Go to Dashboard <ArrowRight className="w-4 h-4" />
                  </Link>
                ) : (
                  <>
                    <Link
                      href="/register"
                      className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
                      style={{ background: C.orangeGrad, boxShadow: '0 10px 28px -6px rgba(217,122,30,0.42)' }}
                    >
                      Start for free <ArrowRight className="w-4 h-4" />
                    </Link>
                    <Link
                      href="/login"
                      className="inline-flex items-center gap-2 px-8 py-4 rounded-2xl text-sm font-semibold transition-all hover:-translate-y-0.5"
                      style={{
                        background: C.card, border: `1px solid ${C.border}`,
                        color: C.text2, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                      }}
                    >
                      Sign in to workspace
                    </Link>
                  </>
                )}
              </motion.div>

              {/* Trust row */}
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1], delay: 0.27 }}
                className="flex flex-wrap gap-5 text-sm"
                style={{ color: C.text4 }}
              >
                {['Human-in-the-loop approval', 'Deterministic query validation', 'Multi-database ready'].map(t => (
                  <span key={t} className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: C.orange }} />
                    {t}
                  </span>
                ))}
              </motion.div>
            </div>

            {/* ── Right: 3D scene + floating stat cards ── */}
            <div className="relative hidden lg:block" style={{ height: 610 }}>
              {/* 3D Canvas */}
              <div className="absolute inset-0 rounded-3xl overflow-hidden">
                <DataNetworkScene />
              </div>

              {/* Floating card: Revenue trend */}
              <motion.div
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.55, duration: 0.65 }}
                className="float-bob absolute top-12 -left-7 rounded-2xl p-4"
                style={{
                  background: C.card, border: `1px solid ${C.border}`,
                  boxShadow: '0 16px 48px -12px rgba(0,0,0,0.14)',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(217,122,30,0.1)' }}>
                    <TrendingUp className="w-4 h-4" style={{ color: C.orange }} />
                  </div>
                  <span className="text-xs font-medium" style={{ color: C.text3 }}>Revenue trend</span>
                </div>
                <p className="text-2xl font-black" style={{ color: C.text1 }}>+24.8%</p>
                <p className="text-[11px] mt-0.5" style={{ color: C.text4 }}>vs last quarter</p>
              </motion.div>

              {/* Floating card: Active users */}
              <motion.div
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.65, duration: 0.65 }}
                className="float-bob-slow absolute top-1/2 -translate-y-1/2 -right-8 rounded-2xl p-4"
                style={{
                  background: C.card, border: `1px solid ${C.border}`,
                  boxShadow: '0 16px 48px -12px rgba(0,0,0,0.14)',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(217,122,30,0.1)' }}>
                    <Users className="w-4 h-4" style={{ color: C.orange }} />
                  </div>
                  <span className="text-xs font-medium" style={{ color: C.text3 }}>Active users</span>
                </div>
                <p className="text-2xl font-black" style={{ color: C.text1 }}>2,847</p>
                <p className="text-[11px] mt-0.5" style={{ color: '#22C55E' }}>↑ 18 online now</p>
              </motion.div>

              {/* Floating card: SQL validated */}
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.75, duration: 0.65 }}
                className="float-bob-fast absolute bottom-16 -right-4 rounded-2xl p-4 max-w-[210px]"
                style={{
                  background: C.card, border: `1px solid ${C.border}`,
                  boxShadow: '0 16px 48px -12px rgba(0,0,0,0.14)',
                }}
              >
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#22C55E', display: 'inline-block' }} />
                  <span className="text-[11px] font-semibold" style={{ color: C.text2 }}>Query validated</span>
                </div>
                <p className="text-[11px] font-mono leading-relaxed" style={{ color: C.text4 }}>
                  SELECT product,<br />
                  {'  '}SUM(revenue) AS total<br />
                  FROM sales<br />
                  GROUP BY product
                </p>
              </motion.div>
            </div>

          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════
          STATS BAR
      ════════════════════════════════════════════════════════ */}
      <div style={{ background: C.card, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="grid grid-cols-3">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="px-4 py-8 text-center"
                style={{ borderRight: i < 2 ? `1px solid ${C.border}` : 'none' }}
              >
                <p
                  className="text-4xl font-black mb-1.5 bg-clip-text text-transparent"
                  style={{ backgroundImage: C.orangeGrad }}
                >
                  {s.value}
                </p>
                <p className="text-sm" style={{ color: C.text3 }}>{s.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════
          FEATURES
      ════════════════════════════════════════════════════════ */}
      <section id="features" className="py-24" style={{ background: C.bg }}>
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          {/* Section header */}
          <motion.div
            initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }}
            variants={inView}
            className="text-center mb-14"
          >
            <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: C.orange }}>
              CAPABILITIES
            </p>
            <h2 className="text-4xl font-black tracking-tight mb-4" style={{ color: C.text1 }}>
              Everything your data team needs
            </h2>
            <p className="text-lg max-w-xl mx-auto" style={{ color: C.text3 }}>
              One platform that turns data chaos into clarity — no engineering required.
            </p>
          </motion.div>

          {/* Feature grid */}
          <motion.div
            className="grid gap-5 md:grid-cols-2 lg:grid-cols-3"
            initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.1 }}
            variants={staggerChildren}
          >
            {features.map((f) => (
              <motion.div
                key={f.title}
                variants={inView}
                className="landing-feature-card group p-7 rounded-2xl cursor-default"
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                }}
                whileHover={{ y: -5 }}
                transition={{ duration: 0.2 }}
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center mb-5 transition-transform duration-300 group-hover:scale-110"
                  style={{ background: 'rgba(217,122,30,0.08)' }}
                >
                  <f.icon className="w-5 h-5" style={{ color: C.orange }} />
                </div>
                <h3 className="text-base font-bold mb-2" style={{ color: C.text1 }}>{f.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: C.text3 }}>{f.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════
          HOW IT WORKS
      ════════════════════════════════════════════════════════ */}
      <section id="how-it-works" className="py-24" style={{ background: C.card }}>
        <div className="mx-auto max-w-7xl px-6 lg:px-10">
          <div className="grid gap-16 lg:grid-cols-2 items-start">

            {/* Steps */}
            <div>
              <motion.div
                initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.3 }}
                variants={inView}
              >
                <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: C.orange }}>
                  HOW IT WORKS
                </p>
                <h2 className="text-4xl font-black tracking-tight mb-4" style={{ color: C.text1 }}>
                  Three steps to your answer
                </h2>
                <p className="mb-12" style={{ color: C.text3 }}>
                  From natural language to trusted insight in under 30 seconds.
                </p>
              </motion.div>

              <div className="space-y-2 relative">
                {/* Connector line */}
                <div
                  className="absolute top-5 bottom-5"
                  style={{ left: '1.2rem', width: 1, background: `linear-gradient(to bottom, ${C.orange}, rgba(217,122,30,0.1))` }}
                />

                {steps.map((s, i) => (
                  <motion.div
                    key={s.n}
                    initial={{ opacity: 0, x: -24 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, amount: 0.4 }}
                    transition={{ duration: 0.55, delay: i * 0.12 }}
                    className="flex gap-5 pb-8"
                  >
                    {/* Step badge */}
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-black shrink-0 z-10"
                      style={{
                        background: i === 0 ? C.orangeGrad : C.bg,
                        color:      i === 0 ? '#FFFFFF' : C.orange,
                        border:     i === 0 ? 'none' : `2px solid rgba(217,122,30,0.28)`,
                        boxShadow:  i === 0 ? '0 4px 18px -4px rgba(217,122,30,0.55)' : 'none',
                      }}
                    >
                      {s.n}
                    </div>
                    <div className="pt-1">
                      <p className="text-base font-bold mb-1.5" style={{ color: C.text1 }}>{s.title}</p>
                      <p className="text-sm leading-relaxed mb-2" style={{ color: C.text3 }}>{s.body}</p>
                      <p className="text-xs" style={{ color: C.text4 }}>{s.note}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Chat/query mockup */}
            <motion.div
              initial={{ opacity: 0, x: 28 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-3xl overflow-hidden sticky top-20"
              style={{ border: `1px solid ${C.border}`, boxShadow: '0 28px 72px -18px rgba(0,0,0,0.13)' }}
            >
              {/* Window chrome */}
              <div
                className="flex items-center gap-2 px-5 py-4"
                style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}
              >
                <span className="w-3 h-3 rounded-full" style={{ background: '#EF4444' }} />
                <span className="w-3 h-3 rounded-full" style={{ background: '#F59E0B' }} />
                <span className="w-3 h-3 rounded-full" style={{ background: '#22C55E' }} />
                <div
                  className="flex-1 mx-4 h-6 rounded-lg flex items-center justify-center text-xs"
                  style={{ background: C.border, color: C.text4 }}
                >
                  C1X — Ask your data anything
                </div>
              </div>

              {/* Chat body */}
              <div className="p-6 space-y-5" style={{ background: '#FAFAFA', minHeight: 380 }}>
                {/* User bubble */}
                <div className="flex justify-end">
                  <div
                    className="px-4 py-3 rounded-2xl rounded-tr-sm text-sm font-medium text-white max-w-xs leading-relaxed"
                    style={{ background: C.orangeGrad }}
                  >
                    What were our top 5 products by revenue last month?
                  </div>
                </div>

                {/* C1X response */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                      style={{ background: C.orangeGrad }}
                    >
                      C
                    </div>
                    <span className="text-xs font-semibold" style={{ color: C.text2 }}>C1X · just now</span>
                  </div>

                  {/* SQL block */}
                  <div
                    className="rounded-xl p-4 mb-3 text-[11px] font-mono leading-[1.7]"
                    style={{ background: C.dark }}
                  >
                    <span style={{ color: '#6B7280' }}>-- Auto-generated SQL</span><br />
                    <span style={{ color: '#60A5FA' }}>SELECT</span>
                    <span style={{ color: '#E5E7EB' }}> product_name,</span><br />
                    <span style={{ color: '#E5E7EB' }}>{'  '}</span>
                    <span style={{ color: '#34D399' }}>SUM</span>
                    <span style={{ color: '#E5E7EB' }}>(revenue) </span>
                    <span style={{ color: '#60A5FA' }}>AS</span>
                    <span style={{ color: '#E5E7EB' }}> total_rev</span><br />
                    <span style={{ color: '#60A5FA' }}>FROM</span>
                    <span style={{ color: '#E5E7EB' }}> sales</span><br />
                    <span style={{ color: '#60A5FA' }}>WHERE</span>
                    <span style={{ color: '#E5E7EB' }}> month = </span>
                    <span style={{ color: '#FCD34D' }}>{"'2024-06'"}</span><br />
                    <span style={{ color: '#60A5FA' }}>GROUP BY</span>
                    <span style={{ color: '#E5E7EB' }}> product_name</span><br />
                    <span style={{ color: '#60A5FA' }}>ORDER BY</span>
                    <span style={{ color: '#E5E7EB' }}> total_rev </span>
                    <span style={{ color: '#60A5FA' }}>DESC</span>
                    <span style={{ color: '#60A5FA' }}> LIMIT</span>
                    <span style={{ color: '#E5E7EB' }}> 5</span>
                  </div>

                  {/* Inline chart */}
                  <div
                    className="rounded-xl p-4"
                    style={{ background: C.card, border: `1px solid ${C.border}` }}
                  >
                    <p className="text-xs font-semibold mb-3" style={{ color: C.text2 }}>
                      Top 5 Products · June 2024
                    </p>
                    {[
                      { name: 'Pro Plan',   pct: 92, val: '$48.2K' },
                      { name: 'Enterprise', pct: 71, val: '$37.1K' },
                      { name: 'Starter',    pct: 45, val: '$23.5K' },
                      { name: 'Add-ons',    pct: 28, val: '$14.7K' },
                      { name: 'One-time',   pct: 16, val: '$8.3K'  },
                    ].map(row => (
                      <div key={row.name} className="flex items-center gap-2 mb-2 last:mb-0">
                        <span className="text-[10px] w-16 shrink-0" style={{ color: C.text3 }}>{row.name}</span>
                        <div className="flex-1 h-2 rounded-full" style={{ background: C.bg }}>
                          <div
                            className="h-2 rounded-full"
                            style={{ width: `${row.pct}%`, background: C.orangeGrad }}
                          />
                        </div>
                        <span className="text-[10px] font-bold w-12 text-right" style={{ color: C.text1 }}>
                          {row.val}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════
          CONNECTORS MARQUEE
      ════════════════════════════════════════════════════════ */}
      <section
        className="py-14 overflow-hidden"
        style={{ background: C.bg, borderTop: `1px solid ${C.border}` }}
      >
        <div className="text-center mb-7">
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: C.text4 }}>
            Works with your stack
          </p>
        </div>

        {/* Marquee row */}
        <div className="relative overflow-hidden">
          {/* Left fade */}
          <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-20 z-10"
            style={{ background: `linear-gradient(to right, ${C.bg}, transparent)` }} />
          {/* Right fade */}
          <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-20 z-10"
            style={{ background: `linear-gradient(to left, ${C.bg}, transparent)` }} />

          <div className="flex animate-marquee gap-4 w-max px-4">
            {[...connectors, ...connectors].map((c, i) => (
              <div
                key={`${c}-${i}`}
                className="px-5 py-2.5 rounded-full text-sm font-medium whitespace-nowrap"
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  color: C.text2,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                }}
              >
                {c}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════
          DARK CTA SECTION
      ════════════════════════════════════════════════════════ */}
      <section className="py-28 relative overflow-hidden" style={{ background: C.dark }}>
        {/* Background glow */}
        <div className="pointer-events-none absolute inset-0">
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: '60rem', height: '40rem', borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(217,122,30,0.12) 0%, transparent 65%)' }} />
        </div>

        <div className="relative mx-auto max-w-4xl px-6 lg:px-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <p className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: C.orange }}>
              GET STARTED TODAY
            </p>
            <h2
              className="font-black tracking-tight mb-5 bg-clip-text text-transparent"
              style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', backgroundImage: C.orangeGradH, lineHeight: 1.1 }}
            >
              Ready to ask your first question?
            </h2>
            <p className="text-lg mb-10 max-w-lg mx-auto" style={{ color: '#9CA3AF' }}>
              Connect your database, ask in plain English, and get a verified answer in seconds.
            </p>

            {/* Connector badges in dark */}
            <div className="flex flex-wrap justify-center gap-2 mb-10">
              {connectors.slice(0, 6).map(c => (
                <span
                  key={c}
                  className="px-3 py-1.5 rounded-full text-xs font-medium"
                  style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.borderDk}`, color: '#9CA3AF' }}
                >
                  {c}
                </span>
              ))}
            </div>

            {/* CTA buttons */}
            <div className="flex flex-wrap items-center justify-center gap-4">
              {isAuthenticated ? (
                <Link
                  href="/dashboards"
                  className="inline-flex items-center gap-2 px-9 py-4 rounded-2xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
                  style={{ background: C.orangeGrad, boxShadow: '0 10px 36px -6px rgba(217,122,30,0.6)' }}
                >
                  <Zap className="w-4 h-4" />
                  Go to Dashboard
                </Link>
              ) : (
                <>
                  <Link
                    href="/register"
                    className="inline-flex items-center gap-2 px-9 py-4 rounded-2xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
                    style={{ background: C.orangeGrad, boxShadow: '0 10px 36px -6px rgba(217,122,30,0.6)' }}
                  >
                    <Zap className="w-4 h-4" />
                    Create your workspace
                  </Link>
                  <Link
                    href="/login"
                    className="px-9 py-4 rounded-2xl text-sm font-semibold transition-all hover:text-white"
                    style={{ border: '1px solid rgba(255,255,255,0.14)', color: '#9CA3AF' }}
                  >
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════════════════════ */}
      <footer
        className="py-8"
        style={{ background: C.dark, borderTop: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div
          className="mx-auto max-w-7xl px-6 lg:px-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs"
          style={{ color: '#4B5563' }}
        >
          <div className="flex items-center gap-2">
            <img
              src="/image.png"
              alt="C1X"
              style={{ height: 16, width: 'auto', opacity: 0.45 }}
            />
            <span>· Data Intelligence Platform</span>
          </div>
          <span>© {new Date().getFullYear()} C1X. All rights reserved.</span>
        </div>
      </footer>

      <SignOutConfirmationModal
        isOpen={showSignOutConfirm}
        onClose={() => setShowSignOutConfirm(false)}
        onConfirm={handleSignOut}
      />
    </div>
  );
}
