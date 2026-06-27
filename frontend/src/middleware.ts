import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that don't require authentication. Invitation activation and the
// password-reset flow must be reachable without a session — an invited user
// has no session yet when they click the link in their email.
const PUBLIC_ROUTES = ['/login', '/register', '/activate', '/forgot-password', '/reset-password'];

// Auth routes that an already-authenticated user should be bounced away from.
// (Activation / reset are intentionally excluded so the links still work.)
const AUTH_ROUTES = ['/login', '/register'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionToken = request.cookies.get('c1x_session')?.value;

  const isPublicRoute = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));
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
