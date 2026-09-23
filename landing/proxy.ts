import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export default function proxy(request: NextRequest) {
  const host = request.headers.get('host') || '';
  // 308 www -> apex for SEO (avoid duplicate content on www.schrodrive.org)
  if (host === 'www.schrodrive.org') {
    const url = request.nextUrl.clone();
    url.host = 'schrodrive.org';
    url.protocol = 'https:';
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = {
  matcher: '/:path*',
};
