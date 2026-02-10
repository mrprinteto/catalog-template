import { config } from '../config/filter';

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

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
}

/** Convierte un ID de 32 hex a formato UUID con guiones. */
function toUUID(id: string): string {
  const raw = id.replace(/-/g, '');
  if (raw.length !== 32) {
    throw new Error(`Database ID invalido: "${id}"`);
  }
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

export async function getFilteredProducts(): Promise<Product[]> {
  const token = import.meta.env.NOTION_TOKEN;
  const dbId = import.meta.env.NOTION_DATABASE_ID;

  if (!token || !dbId) {
    throw new Error(
      'Faltan NOTION_TOKEN o NOTION_DATABASE_ID en .env'
    );
  }

  const res = await fetch(`${NOTION_API}/databases/${toUUID(dbId)}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
      body: JSON.stringify({
        filter: {
          property: 'Client',
          multi_select: { contains: config.clientFilter },
        },
      }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API ${res.status}: ${body}`);
  }

  const data = (await res.json()) as any;

  return data.results.map((page: any): Product => {
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
    };
  });
}
