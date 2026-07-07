import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that don't require authentication. Invitation activation and the
// password-reset flow must be reachable without a session — an invited user
// has no session yet when they click the link in their email.
//
// The SSO endpoints must also be public: a user has no session when they start
// an OIDC flow, and the IdP redirects back to the callback *before* any session
// cookie exists. These live under `/api/auth/sso/*`, which the `matcher` below
// already excludes — this entry is a belt-and-suspenders guard so the SSO flow
// stays reachable even if the `api` exclusion is ever removed from the matcher.
const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/activate',
  '/forgot-password',
  '/reset-password',
  '/api/auth/sso',
  // Publicly embeddable dashboards (token-gated by the backend).
  '/embed',
];

// Auth routes that an already-authenticated user should be bounced away from.
// (Activation / reset are intentionally excluded so the links still work.)
const AUTH_ROUTES = ['/login', '/register'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionToken = request.cookies.get('c1x_session')?.value;

  const isPublicRoute = pathname === '/' || PUBLIC_ROUTES.some((r) => pathname.startsWith(r));
  const isAuthRoute = AUTH_ROUTES.some((r) => pathname.startsWith(r));

  // If an authenticated user hits login/register, send them straight to the
  // Dashboard. There is no organization selection step.
  if (sessionToken && isAuthRoute) {
    return NextResponse.redirect(new URL('/dashboards', request.url));
  }

  // If unauthenticated user hits a protected route → redirect to login
  if (!sessionToken && !isPublicRoute) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - api routes
     * - static files (images)
     */
    '/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
