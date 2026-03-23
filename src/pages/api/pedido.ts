import type { APIRoute } from 'astro';
import { config } from '../../config/filter';
import { validateCompanyHmacForCurrentCatalog } from '../../services/notion';

export const prerender = false;
const ACCESS_COOKIE_NAME = 'catalog_access_key';

type PresupuestoItem = {
  id: string;
  code: string;
  name: string;
  qty: number;
  unitPrice: number;
  baseUnitPrice: number;
  subtotal: number;
};

type PresupuestoPayload = {
  companyName: string;
  companySlug: string;
  companyId: string;
  clientEmail: string;
  items: PresupuestoItem[];
  subtotal: number;
  discount: number;
  total: number;
};

const FALLBACK_MESSAGE =
  'Este pedido debe ser solicitado por email. Escribemos a info@mrprinteto.com.';

function isValidPresupuesto(payload: any): payload is PresupuestoPayload {
  return (
    payload &&
    typeof payload === 'object' &&
    typeof payload.companyName === 'string' &&
    typeof payload.companySlug === 'string' &&
    typeof payload.companyId === 'string' &&
    typeof payload.clientEmail === 'string' &&
    Array.isArray(payload.items) &&
    payload.items.length > 0 &&
    typeof payload.subtotal === 'number' &&
    typeof payload.discount === 'number' &&
    typeof payload.total === 'number'
  );
}

function getWebhookUrl(): string {
  const env = (import.meta as any).env ?? {};
  return (
    env.N8N_PEDIDO_WEBHOOK_URL ||
    'https://n8n.mrprinteto.com/webhook/nuevo-pedido'
  );
}

export const POST: APIRoute = async (context) => {
  try {
    const { request } = context;
    const rawBody = await request.text();
    if (!rawBody) {
      return new Response(
        JSON.stringify({
          success: false,
          code: 'INVALID_PAYLOAD',
          message: FALLBACK_MESSAGE,
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
          message: FALLBACK_MESSAGE,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const cookieHmac = context.cookies.get(ACCESS_COOKIE_NAME)?.value?.trim() ?? '';
    const presupuesto = body?.presupuesto;

    if (!cookieHmac) {
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

    if (!isValidPresupuesto(presupuesto)) {
      return new Response(
        JSON.stringify({
          success: false,
          code: 'INVALID_PAYLOAD',
          message: FALLBACK_MESSAGE,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const cookieSecret = (import.meta as any).env?.COOKIE_SECRET ?? '';
    const isValidKey = await validateCompanyHmacForCurrentCatalog(cookieHmac, cookieSecret);
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

    const webhookResponse = await fetch(getWebhookUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        companySlug: config.companySlug,
        presupuesto,
        requestedAt: new Date().toISOString(),
      }),
    });

    if (!webhookResponse.ok) {
      return new Response(
        JSON.stringify({
          success: false,
          code: 'WEBHOOK_ERROR',
          message: FALLBACK_MESSAGE,
        }),
        {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error('Error procesando solicitud de pedido', err);
    return new Response(
      JSON.stringify({
        success: false,
        code: 'INTERNAL_ERROR',
        message: FALLBACK_MESSAGE,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
