import { config } from '../config/filter';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  priceX10: number;
  priceX50: number;
  priceX100: number;
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
}

interface CompanyRecord {
  company: Company;
  key: string;
}

export interface CatalogData {
  company: Company | null;
  products: Product[];
}

interface CacheEntry {
  data: CatalogData;
  timestamp: number;
}

interface CompanyKeyCacheEntry {
  key: string;
  timestamp: number;
}

// In-memory LRU cache (simple implementation)
const cache = new Map<string, CacheEntry>();
const companyKeyCache = new Map<string, CompanyKeyCacheEntry>();

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
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
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

  return '';
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
    getTextPropertyValue(p.Slug) ||
    getTextPropertyValue(p.slug) ||
    getTextPropertyValue(p['Client Slug']) ||
    getTextPropertyValue(p['client-slug']) ||
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

  return {
    id: page.id,
    name,
    slug: slugify(slug),
    url,
    logo,
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
  const slugPropertyCandidates = ['Slug', 'slug', 'Client Slug', 'client-slug'];

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

  const cacheKey = `catalog-${config.companySlug}`;
  
  // Check cache
  const cached = cache.get(cacheKey);
  if (
    cached &&
    Date.now() - cached.timestamp < CACHE_TTL_MS &&
    cached.data.products.length > 0
  ) {
    return cached.data;
  }

  const company = await findCompanyBySlug(token, companiesDbId, config.companySlug);
  const companyIdVariants = Array.from(
    new Set([company.id, normalizeNotionId(company.id)])
  );

  const schemaRelationProperties = await getRelationPropertiesToCompaniesDb(
    token,
    dbId,
    companiesDbId
  );

  const relationPropertyCandidates = Array.from(
    new Set([
      ...schemaRelationProperties,
      'Empresa',
      'Empresas',
      'Company',
    ])
  );
  let productPages: any[] = [];

  for (const propertyName of relationPropertyCandidates) {
    for (const companyId of companyIdVariants) {
      try {
        const data = await queryDatabase(token, dbId, {
          filter: {
            property: propertyName,
            relation: { contains: companyId },
          },
        });

        const results = data.results ?? [];
        if (results.length > 0) {
          productPages = results;
          break;
        }
      } catch {
        // Continue trying next property candidate/id format.
      }
    }

    if (productPages.length > 0) {
      break;
    }
  }

  if (productPages.length === 0) {
    const allProducts = await queryAllDatabasePages(token, dbId, {});
    productPages = allProducts.filter((page: any) => {
      const relationIds = [
        ...getRelationIds(page.properties ?? {}, relationPropertyCandidates),
        ...getAllRelationIds(page.properties ?? {}),
      ];
      const normalizedRelationIds = relationIds.map(normalizeNotionId);
      return companyIdVariants.some((companyId) =>
        normalizedRelationIds.includes(normalizeNotionId(companyId))
      );
    });
  }

  const products = productPages.map((page: any): Product => {
    const p = page.properties;
    return {
      id: page.id,
      name: p.Name?.title?.[0]?.plain_text ?? '',
      category: p.Category?.select?.name ?? '',
      price: p.Price?.formula?.number ?? 0,
      priceX10: p.Price_x10?.formula?.number ?? 0,
      priceX50: p.Price_x50?.formula?.number ?? 0,
      priceX100: p.Price_x100?.formula?.number ?? 0,
      description: p.Description?.rich_text?.[0]?.plain_text ?? '',
      image: p.Image?.url ?? '',
      company,
    };
  });

  const catalogData: CatalogData = { company, products };

  // Store in cache only when products are available.
  // This avoids stale empty results persisting for 1 hour.
  if (catalogData.products.length > 0) {
    cache.set(cacheKey, {
      data: catalogData,
      timestamp: Date.now(),
    });
  }

  return catalogData;
}

export async function getFilteredProducts(): Promise<Product[]> {
  const { products } = await getCatalogData();
  return products;
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

  const cacheKey = `company-key-${config.companySlug}`;
  const cachedEntry = companyKeyCache.get(cacheKey);
  if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_TTL_MS) {
    if (!cachedEntry.key) return false;
    return safeCompareSecret(cachedEntry.key, normalizedInputKey);
  }

  const { key } = await getCompanyRecordBySlug(token, companiesDbId, config.companySlug);
  companyKeyCache.set(cacheKey, {
    key,
    timestamp: Date.now(),
  });

  if (!key) return false;

  return safeCompareSecret(key, normalizedInputKey);
}
