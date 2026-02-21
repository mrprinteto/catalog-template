/**
 * Configuracion del filtro de catalogo.
 * Modifica companySlug para cambiar que empresa se muestra.
 */
const DEFAULT_COMPANY = 'crosssaiyan';
const envCompanySlug = import.meta.env.NOTION_COMPANY_SLUG;

export const config = {
  companySlug: envCompanySlug?.trim().toLowerCase() || DEFAULT_COMPANY,
};
