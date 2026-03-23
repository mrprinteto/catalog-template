import { config } from '../config/filter';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export interface Product {
  id: string;
  code: string;
  name: string;
  customized: boolean;
  price: number;
  priceX25: number;
  priceX100: number;
  pricex250: number;
  description: string;
  image: string;
  company?: Company | null;
}

export interface Company {
  id: string;
  name: string;
  slug: string;
  url: string;
  logo: string;
  email: string;
}

interface CompanyRecord {
  company: Company;
  key: string;
}

export interface CatalogData {
  company: Company | null;
  products: Product[];
}

function safeCompareSecret(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let mismatch = left.length === right.length ? 0 : 1;

  for (let i = 0; i < maxLength; i++) {
    const leftCode = left.charCodeAt(i) || 0;
    const rightCode = right.charCodeAt(i) || 0;
    mismatch |= leftCode ^ rightCode;
  }

  return mismatch === 0;
}

/** Convierte un ID de 32 hex a formato UUID con guiones. */
function toUUID(id: string): string {
  const raw = id.replace(/-/g, '');
  if (raw.length !== 32) {
    throw new Error(`Database ID invalido: "${id}"`);
  }
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

/** Retry logic con exponential backoff */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const t0 = performance.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s: Notion puede tardar 6-8s en cold start

      console.log(`[notion] attempt=${attempt + 1} start — ${url}`);
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      const elapsed = (performance.now() - t0).toFixed(0);
      console.log(`[notion] attempt=${attempt + 1} status=${response.status} ${elapsed}ms — ${url}`);

      clearTimeout(timeoutId);
      
      if (response.ok) {
        return response;
      }
      
      // Retry on 429 (rate limit) or 5xx
      if (response.status === 429 || response.status >= 500) {
        const backoff = Math.pow(2, attempt) * 1000; // exponential backoff
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      
      return response;
    } catch (err) {
      const elapsed = (performance.now() - t0).toFixed(0);
      console.log(`[notion] attempt=${attempt + 1} ERROR ${elapsed}ms ${err instanceof Error ? err.message : err} — ${url}`);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        const backoff = Math.pow(2, attempt) * 1000;
        await new Promise(resolve => setTimeout(resolve, backoff));
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-');
}

function normalizeNotionId(id: string): string {
  return id.replace(/-/g, '').toLowerCase();
}

function getTextPropertyValue(property: any): string {
  if (!property) return '';

  if (property.title) return property.title[0]?.plain_text ?? '';
  if (property.rich_text) return property.rich_text[0]?.plain_text ?? '';
  if (property.select) return property.select?.name ?? '';
  if (property.formula?.string) return property.formula.string;
  if (property.url) return property.url;
  if (property.email) return property.email;

  return '';
}

function getStringPropertyValue(property: any): string {
  const text = getTextPropertyValue(property).trim();
  if (text) return text;

  const uniqueIdNumber = property?.unique_id?.number;
  if (typeof uniqueIdNumber === 'number') {
    const uniqueIdPrefix = property?.unique_id?.prefix;
    if (typeof uniqueIdPrefix === 'string' && uniqueIdPrefix.trim()) {
      return `${uniqueIdPrefix.trim()}-${uniqueIdNumber}`;
    }
    return String(uniqueIdNumber);
  }

  if (typeof property?.number === 'number') return String(property.number);
  if (typeof property?.formula?.number === 'number') return String(property.formula.number);
  if (typeof property?.rollup?.number === 'number') return String(property.rollup.number);

  return '';
}

function getPropertyByCandidates(properties: any, candidates: string[]): any {
  if (!properties) return undefined;

  for (const candidate of candidates) {
    if (properties[candidate]) return properties[candidate];
  }

  const normalizedCandidates = candidates.map((candidate) =>
    candidate
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  );

  for (const [key, value] of Object.entries(properties)) {
    const normalizedKey = key
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    if (normalizedCandidates.includes(normalizedKey)) {
      return value;
    }
  }

  return undefined;
}

function getNumberPropertyValue(property: any): number {
  if (!property) return 0;

  if (typeof property.number === 'number') return property.number;
  if (typeof property.formula?.number === 'number') return property.formula.number;
  if (typeof property.rollup?.number === 'number') return property.rollup.number;

  const parsedFromString = Number(property.formula?.string);
  if (!Number.isNaN(parsedFromString)) return parsedFromString;

  return 0;
}

function getImagePropertyValue(property: any): string {
  if (!property) return '';

  if (property.url) return property.url;

  const firstFile = property.files?.[0];
  if (!firstFile) return '';

  return firstFile.file?.url ?? firstFile.external?.url ?? '';
}

function getRelationIds(properties: any, propertyNames: string[]): string[] {
  const ids: string[] = [];

  for (const propertyName of propertyNames) {
    const relationValues = properties[propertyName]?.relation;
    if (Array.isArray(relationValues) && relationValues.length > 0) {
      ids.push(...relationValues.map((item: any) => item.id).filter(Boolean));
    }
  }

  return ids;
}

function getAllRelationIds(properties: any): string[] {
  const ids: string[] = [];

  for (const property of Object.values(properties ?? {}) as any[]) {
    if (property?.type === 'relation' && Array.isArray(property.relation)) {
      ids.push(...property.relation.map((item: any) => item.id).filter(Boolean));
    }
  }

  return ids;
}

async function queryDatabase(
  token: string,
  dbId: string,
  payload: Record<string, unknown>
): Promise<any> {
  const res = await fetchWithRetry(
    `${NOTION_API}/databases/${toUUID(dbId)}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API ${res.status}: ${body}`);
  }

  return res.json();
}

async function getDatabaseSchema(token: string, dbId: string): Promise<any> {
  const res = await fetchWithRetry(
    `${NOTION_API}/databases/${toUUID(dbId)}`,
    {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
      },
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API ${res.status}: ${body}`);
  }

  return res.json();
}

async function getRelationPropertiesToCompaniesDb(
  token: string,
  productsDbId: string,
  companiesDbId: string
): Promise<string[]> {
  try {
    const schema = await getDatabaseSchema(token, productsDbId);
    const properties = schema.properties ?? {};
    const normalizedCompaniesDbId = normalizeNotionId(companiesDbId);

    return Object.entries(properties)
      .filter(([, property]: [string, any]) => {
        if (property?.type !== 'relation') return false;
        const targetDbId = property?.relation?.database_id;
        if (!targetDbId) return false;

        return normalizeNotionId(targetDbId) === normalizedCompaniesDbId;
      })
      .map(([propertyName]) => propertyName);
  } catch {
    return [];
  }
}

async function queryAllDatabasePages(
  token: string,
  dbId: string,
  payload: Record<string, unknown>
): Promise<any[]> {
  const allResults: any[] = [];
  let hasMore = true;
  let nextCursor: string | undefined;

  while (hasMore) {
    const data = await queryDatabase(token, dbId, {
      page_size: 100,
      ...payload,
      ...(nextCursor ? { start_cursor: nextCursor } : {}),
    });

    allResults.push(...(data.results ?? []));
    hasMore = Boolean(data.has_more);
    nextCursor = data.next_cursor ?? undefined;
  }

  return allResults;
}

function parseCompany(page: any): Company {
  const p = page.properties ?? {};

  const name =
    getTextPropertyValue(p.Name) ||
    getTextPropertyValue(p.Nombre) ||
    getTextPropertyValue(p.Company) ||
    'Empresa';

  const slug =
    getTextPropertyValue(p.slug) ||
    getTextPropertyValue(p.Slug) ||
    slugify(name);

  const url =
    getTextPropertyValue(p.URL) ||
    getTextPropertyValue(p.Url) ||
    getTextPropertyValue(p.Website) ||
    '';

  const logo =
    getImagePropertyValue(p.Logo) ||
    getImagePropertyValue(p.logo) ||
    getImagePropertyValue(p.Image) ||
    getImagePropertyValue(p.Imagen) ||
    '';

  const emailProperty = getPropertyByCandidates(p, [
    'Email',
    'email',
    'Correo',
    'Correo electrónico',
    'Correo electronico',
    'E-mail',
  ]);
  const email = getTextPropertyValue(emailProperty);

  return {
    id: page.id,
    name,
    slug: slugify(slug),
    url,
    logo,
    email,
  };
}

function parseCompanyKey(page: any): string {
  const p = page.properties ?? {};

  return (
    getTextPropertyValue(p.Clave) ||
    getTextPropertyValue(p.clave) ||
    getTextPropertyValue(p.Key) ||
    getTextPropertyValue(p.Password) ||
    ''
  ).trim();
}

async function findCompanyPageBySlug(
  token: string,
  companiesDbId: string,
  companySlug: string
): Promise<any> {
  const slugPropertyCandidates = ['slug', 'Slug'];

  for (const propertyName of slugPropertyCandidates) {
    try {
      const data = await queryDatabase(token, companiesDbId, {
        filter: {
          property: propertyName,
          rich_text: { equals: companySlug },
        },
      });

      if (Array.isArray(data.results) && data.results.length > 0) {
        return data.results[0];
      }
    } catch {
      // Continue trying next property candidate.
    }
  }

  const fallbackResults = await queryAllDatabasePages(token, companiesDbId, {});
  const normalizedCompanySlug = slugify(companySlug);

  const match = fallbackResults.find((page: any) => {
    const company = parseCompany(page);
    return (
      slugify(company.slug) === normalizedCompanySlug ||
      slugify(company.name) === normalizedCompanySlug
    );
  });

  if (!match) {
    throw new Error(
      `No se encontro la empresa "${companySlug}" en NOTION_COMPANIES_DATABASE_ID`
    );
  }

  return match;
}

async function findCompanyBySlug(
  token: string,
  companiesDbId: string,
  companySlug: string
): Promise<Company> {
  const page = await findCompanyPageBySlug(token, companiesDbId, companySlug);
  return parseCompany(page);
}

async function getCompanyRecordBySlug(
  token: string,
  companiesDbId: string,
  companySlug: string
): Promise<CompanyRecord> {
  const page = await findCompanyPageBySlug(token, companiesDbId, companySlug);
  return {
    company: parseCompany(page),
    key: parseCompanyKey(page),
  };
}

/**
 * Busca los product pages de Notion para una empresa dada.
 * Lanza todas las combinaciones (propertyName × companyId) en paralelo mediante
 * Promise.allSettled para evitar queries secuenciales innecesarias.
 *
 * No se llama a getDatabaseSchema: en producción tarda 3-4s y los candidatos
 * hardcodeados ya cubren los nombres de propiedad conocidos.
 */
async function fetchProductPagesForCompany(
  token: string,
  dbId: string,
  company: Company
): Promise<any[]> {
  // Notion devuelve IDs en formato UUID con guiones — usamos company.id directamente.
  const companyId = company.id;
  const relationProperty = 'Catalogo-empresas';

  // Query directa: una sola combinación conocida, sin variantes ni candidatos.
  const data = await queryDatabase(token, dbId, {
    filter: {
      property: relationProperty,
      relation: { contains: companyId },
    },
  });

  const pages = data.results ?? [];
  if (pages.length > 0) return pages;

  // Fallback: full scan si la query filtrada no devuelve resultados.
  const allProducts = await queryAllDatabasePages(token, dbId, {});
  const normalizedCompanyId = normalizeNotionId(companyId);
  return allProducts.filter((page: any) => {
    const relationIds = [
      ...getRelationIds(page.properties ?? {}, [relationProperty]),
      ...getAllRelationIds(page.properties ?? {}),
    ];
    return relationIds.map(normalizeNotionId).includes(normalizedCompanyId);
  });
}

function parseProductPages(pages: any[], company: Company): Product[] {
  return pages.map((page: any): Product => {
    const p = page.properties;
    const codeProperty = getPropertyByCandidates(p, ['Code', 'CODE', 'Código', 'Codigo']);

    return {
      id: page.id,
      code: getStringPropertyValue(codeProperty),
      name: p.Name?.title?.[0]?.plain_text ?? '',
      customized: p.Customized?.checkbox ?? p.customized?.checkbox ?? false,
      price: getNumberPropertyValue(p.Price),
      priceX25: getNumberPropertyValue(p.Price_x25),
      priceX100: getNumberPropertyValue(p.Price_x100),
      pricex250: getNumberPropertyValue(p.Price_x250),
      description: p.Description?.rich_text?.[0]?.plain_text ?? '',
      image: p.Image?.url ?? '',
      company,
    };
  });
}

export async function getCatalogData(): Promise<CatalogData> {
  const env = (import.meta as any).env ?? {};
  const token = env.NOTION_TOKEN;
  const dbId = env.NOTION_DATABASE_ID;
  const companiesDbId = env.NOTION_COMPANIES_DATABASE_ID;

  if (!token || !dbId || !companiesDbId) {
    throw new Error(
      'Faltan NOTION_TOKEN, NOTION_DATABASE_ID o NOTION_COMPANIES_DATABASE_ID en .env'
    );
  }

  if (!config.companySlug) {
    throw new Error('Falta NOTION_COMPANY_SLUG en .env');
  }

  const company = await findCompanyBySlug(token, companiesDbId, config.companySlug);
  const productPages = await fetchProductPagesForCompany(token, dbId, company);

  return { company, products: parseProductPages(productPages, company) };
}

/**
 * Variante de getCatalogData que acepta un objeto Company ya resuelto para
 * evitar una llamada extra a Notion cuando la empresa ya fue cargada previamente.
 *
 * @param schemaRelationProperties - Si se pasa, omite la llamada a getDatabaseSchema
 *   (útil cuando ya se ha obtenido en paralelo en la ronda anterior).
 */
export async function getCatalogDataWithCompany(company: Company): Promise<CatalogData> {
  const env = (import.meta as any).env ?? {};
  const token = env.NOTION_TOKEN;
  const dbId = env.NOTION_DATABASE_ID;
  const companiesDbId = env.NOTION_COMPANIES_DATABASE_ID;

  if (!token || !dbId || !companiesDbId) {
    throw new Error(
      'Faltan NOTION_TOKEN, NOTION_DATABASE_ID o NOTION_COMPANIES_DATABASE_ID en .env'
    );
  }

  const productPages = await fetchProductPagesForCompany(token, dbId, company);

  return { company, products: parseProductPages(productPages, company) };
}

/**
 * Devuelve los nombres de propiedades de relación en la DB de productos que
 * apuntan a la DB de empresas. Se puede llamar en paralelo con otras operaciones
 * para pre-cargar el schema antes de buscar productos.
 */
export async function getProductsRelationProperties(): Promise<string[]> {
  const env = (import.meta as any).env ?? {};
  const token = env.NOTION_TOKEN;
  const dbId = env.NOTION_DATABASE_ID;
  const companiesDbId = env.NOTION_COMPANIES_DATABASE_ID;

  if (!token || !dbId || !companiesDbId) return [];

  return getRelationPropertiesToCompaniesDb(token, dbId, companiesDbId);
}

export async function getFilteredProducts(): Promise<Product[]> {
  const { products } = await getCatalogData();
  return products;
}

export async function getCompanyForCurrentCatalog(): Promise<Company> {
  const env = (import.meta as any).env ?? {};
  const token = env.NOTION_TOKEN;
  const companiesDbId = env.NOTION_COMPANIES_DATABASE_ID;

  if (!token || !companiesDbId) {
    throw new Error('Faltan NOTION_TOKEN o NOTION_COMPANIES_DATABASE_ID en .env');
  }

  if (!config.companySlug) {
    throw new Error('Falta NOTION_COMPANY_SLUG en .env');
  }

  return findCompanyBySlug(token, companiesDbId, config.companySlug);
}

/**
 * Firma la clave en texto plano con un secreto del servidor usando HMAC-SHA256.
 * El resultado es lo que se almacena en la cookie — nunca la clave directamente.
 * Usa la Web Crypto API (disponible sin dependencias en Node 18+, Vercel, Cloudflare).
 */
export async function signAccessCookie(rawKey: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(rawKey)
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Valida el HMAC almacenado en la cookie contra la clave real de Notion.
 * No expone la clave en texto plano tras el momento del login.
 */
/**
 * Obtiene la empresa y valida el HMAC de la cookie en una única llamada a Notion.
 * Sustituye el par validateCompanyHmacForCurrentCatalog + getCompanyForCurrentCatalog
 * para evitar dos queries idénticas en paralelo que Notion degrada o serializa.
 */
export async function resolveCompanyAccess(
  cookieHmac: string,
  secret: string
): Promise<{ company: Company; isValid: boolean }> {
  const env = (import.meta as any).env ?? {};
  const token = env.NOTION_TOKEN;
  const companiesDbId = env.NOTION_COMPANIES_DATABASE_ID;

  if (!token || !companiesDbId || !config.companySlug) {
    return { company: {} as Company, isValid: false };
  }

  const { company, key } = await getCompanyRecordBySlug(token, companiesDbId, config.companySlug);

  if (!cookieHmac || !secret || !key) {
    return { company, isValid: false };
  }

  const expectedHmac = await signAccessCookie(key, secret);
  const isValid = safeCompareSecret(expectedHmac, cookieHmac);

  return { company, isValid };
}

export async function validateCompanyHmacForCurrentCatalog(
  cookieHmac: string,
  secret: string
): Promise<boolean> {
  if (!cookieHmac || !secret) return false;

  const env = (import.meta as any).env ?? {};
  const token = env.NOTION_TOKEN;
  const companiesDbId = env.NOTION_COMPANIES_DATABASE_ID;

  if (!token || !companiesDbId || !config.companySlug) return false;

  const { key } = await getCompanyRecordBySlug(token, companiesDbId, config.companySlug);
  if (!key) return false;

  const expectedHmac = await signAccessCookie(key, secret);
  return safeCompareSecret(expectedHmac, cookieHmac);
}

export async function validateCompanyKeyForCurrentCatalog(inputKey: string): Promise<boolean> {
  const env = (import.meta as any).env ?? {};
  const token = env.NOTION_TOKEN;
  const companiesDbId = env.NOTION_COMPANIES_DATABASE_ID;
  const normalizedInputKey = inputKey.trim();

  if (!normalizedInputKey) {
    return false;
  }

  if (!token || !companiesDbId) {
    throw new Error('Faltan NOTION_TOKEN o NOTION_COMPANIES_DATABASE_ID en .env');
  }

  const { key } = await getCompanyRecordBySlug(token, companiesDbId, config.companySlug);

  if (!key) return false;

  return safeCompareSecret(key, normalizedInputKey);
}

// ---------------------------------------------------------------------------
// Warm-up de conexión con Notion
//
// La DB de productos tarda 6–8s en la primera query tras un periodo de
// inactividad (cold start de conexión TCP/TLS con los servidores de Notion).
// Este módulo lanza una query barata (page_size=1) al arrancar el proceso y
// cada 4 minutos para mantener la conexión caliente.
//
// En servidores persistentes (astro start / Node) el intervalo se mantiene
// activo durante toda la vida del proceso.
// En entornos serverless (Vercel Edge/Lambda) cada invocación carga el módulo
// de nuevo, por lo que la query inicial calienta la conexión para esa misma
// invocación sin overhead para las siguientes requests del mismo proceso.
// ---------------------------------------------------------------------------

const WARMUP_INTERVAL_MS = 4 * 60 * 1000; // 4 minutos

async function warmUpNotionConnection(): Promise<void> {
  const env = (import.meta as any).env ?? {};
  const token = env.NOTION_TOKEN;
  const dbId = env.NOTION_DATABASE_ID;

  if (!token || !dbId) return;

  try {
    await fetch(`${NOTION_API}/databases/${toUUID(dbId)}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page_size: 1 }),
      signal: AbortSignal.timeout(10000),
    });
    console.log('[notion] warm-up OK');
  } catch {
    // Silencioso: el warm-up es best-effort, nunca debe bloquear nada.
  }
}

// Ejecutar inmediatamente al cargar el módulo y luego cada 4 minutos.
warmUpNotionConnection();
setInterval(warmUpNotionConnection, WARMUP_INTERVAL_MS);
