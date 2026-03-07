import type { APIRoute } from 'astro';
import { validateCompanyKeyForCurrentCatalog } from '../../services/notion';

export const prerender = false;

const ACCESS_COOKIE_NAME = 'catalog_access_key';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8;

export const POST: APIRoute = async (context) => {
  try {
    const { request, cookies } = context;
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

    const protocol = new URL(request.url).protocol;

    cookies.set(ACCESS_COOKIE_NAME, key, {
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
