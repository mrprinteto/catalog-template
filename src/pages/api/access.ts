import type { APIRoute } from 'astro';
import { validateCompanyKeyForCurrentCatalog, signAccessCookie } from '../../services/notion';

export const prerender = false;

const ACCESS_COOKIE_NAME = 'catalog_access_key';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8;

// ---------------------------------------------------------------------------
// Rate limiting en memoria: máximo 5 intentos fallidos por IP en 15 minutos.
// En despliegues multi-instancia esto no es compartido entre procesos, pero
// es suficiente para frenar ataques de fuerza bruta sobre una sola instancia.
// ---------------------------------------------------------------------------
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutos

interface RateRecord { count: number; resetAt: number; }
const rateLimitStore = new Map<string, RateRecord>();

function getClientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

function checkRateLimit(ip: string): { allowed: boolean } {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now > record.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }

  if (record.count >= MAX_ATTEMPTS) {
    return { allowed: false };
  }

  record.count++;
  return { allowed: true };
}

function resetRateLimit(ip: string): void {
  rateLimitStore.delete(ip);
}

// ---------------------------------------------------------------------------

export const POST: APIRoute = async (context) => {
  try {
    const { request, cookies } = context;

    const ip = getClientIp(request);
    if (!checkRateLimit(ip).allowed) {
      return new Response(
        JSON.stringify({
          success: false,
          code: 'RATE_LIMITED',
          message: 'Demasiados intentos fallidos. Espera 15 minutos.',
        }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '900' },
        }
      );
    }

    const rawBody = await request.text();

    if (!rawBody) {
      return new Response(
        JSON.stringify({
          success: false,
          code: 'INVALID_PAYLOAD',
          message: 'Solicitud inválida.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    let body: any = null;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({
          success: false,
          code: 'INVALID_PAYLOAD',
          message: 'Solicitud inválida.',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const key = typeof body?.key === 'string' ? body.key.trim() : '';
    if (!key) {
      return new Response(
        JSON.stringify({
          success: false,
          code: 'INVALID_KEY',
          message: 'Debes introducir una clave.',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const isValidKey = await validateCompanyKeyForCurrentCatalog(key);
    if (!isValidKey) {
      return new Response(
        JSON.stringify({
          success: false,
          code: 'INVALID_KEY',
          message: 'Clave incorrecta.',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Login correcto: limpiar el contador de intentos de esta IP.
    resetRateLimit(ip);

    const cookieSecret = (import.meta as any).env?.COOKIE_SECRET ?? '';
    if (!cookieSecret) {
      console.error('COOKIE_SECRET no está definido en .env');
    }

    // Almacenar el HMAC de la clave, nunca la clave en texto plano.
    const cookieValue = cookieSecret
      ? await signAccessCookie(key, cookieSecret)
      : key; // fallback sin secreto (solo para desarrollo sin .env)

    const protocol = new URL(request.url).protocol;

    cookies.set(ACCESS_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      sameSite: 'strict',
      secure: protocol === 'https:',
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
    });

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error('Error validando acceso al catálogo', err);
    return new Response(
      JSON.stringify({
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'No se pudo validar el acceso.',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
