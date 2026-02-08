/**
 * Configuracion del filtro de productos.
 * Modifica clientFilter para cambiar que productos se muestran.
 */
const DEFAULT_CLIENT = 'CrossSaiyan';
const envClient = import.meta.env.NOTION_CLIENT;

export const config = {
  clientFilter: envClient?.trim() || DEFAULT_CLIENT,
};
