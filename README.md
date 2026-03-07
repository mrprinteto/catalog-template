# catalog-template

## Variables de entorno

Copia `.env.example` a `.env` y completa tus credenciales de Notion.

Para la funcionalidad **Solicitar pedido**, puedes configurar:

- `N8N_PEDIDO_WEBHOOK_URL` (por defecto `https://n8n.mrprinteto.com/webhook-test/nuevo-pedido`)

## Acceso al catálogo

- El catálogo ahora solicita la clave **antes** de mostrar cualquier producto.
- Tras validar la clave se guarda una cookie de sesión (`catalog_access_key`) para permitir navegación y confirmar pedidos sin volver a pedirla.