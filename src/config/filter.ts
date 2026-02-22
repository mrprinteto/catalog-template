/**
 * Configuracion del filtro de catalogo.
 * Modifica companySlug para cambiar que empresa se muestra.
 */
const envSource = ((import.meta as any).env ?? {}) as Record<string, string | undefined>;
const envCompanySlug = envSource.NOTION_COMPANY_SLUG;

export const config = {
  companySlug: envCompanySlug?.trim().toLowerCase() || '',
};
