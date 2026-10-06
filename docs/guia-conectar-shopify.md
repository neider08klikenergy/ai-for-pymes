# Cómo conectar tu tienda Shopify

> Guía para el negocio. Con esto, el asistente puede usar los productos y precios de tu tienda Shopify. Lo hace **el dueño de la tienda**, una sola vez, en unos 10 minutos.

## Qué permiso nos das

Solo **lectura de productos** (`read_products`): nombre, descripción, fotos, variantes y precios.
No podemos ver pedidos, clientes ni pagos, ni cambiar nada en tu tienda.

## Pasos

1. Entra a **[dev.shopify.com](https://dev.shopify.com/dashboard)** con la **misma cuenta dueña de tu tienda**.
   > Importante: la app tiene que quedar en la misma organización que la tienda. Si la crea otra persona desde su propia cuenta, Shopify no da acceso.
2. Crea una app nueva. El nombre es libre, por ejemplo: *Catálogo para el asistente*.
3. Entra a **Versions**, crea una versión, agrega el permiso **`read_products`** y publícala (**Release**).
4. En **Home**, **instala la app** en tu tienda.
5. En **Settings** de la app, copia el **Client ID** y el **Client Secret**.
6. Envíanos esos dos datos y el dominio de tu tienda que termina en **.myshopify.com** (por ejemplo, `mitienda.myshopify.com`). Lo ves en el admin de Shopify, en Configuración → Dominios.
   > El Client Secret es como una contraseña: compártelo solo por un canal privado.

## Qué pasa después

- Cargamos los datos en **Settings → Integraciones → Shopify** y probamos la conexión.
- En **Productos → Importar desde Shopify** se traen tus productos al catálogo del asistente.
- Puedes **editar en el panel** cualquier producto importado (nombre, precio, disponibilidad). Al volver a importar, **no se pisa lo que editaste**.
- Los productos con **precio $0** en Shopify se importan **inactivos**, para que el asistente nunca cotice $0. Actívalos en el panel cuando tengan precio.
- La **disponibilidad del día por sede** (vitrina, agotados, cantidades) se maneja en **Productos → Menú del día**, no en Shopify.

## Si quieres desconectarla

Desinstala la app desde el admin de Shopify (Configuración → Apps). El acceso se corta de inmediato y los productos que ya están en el catálogo se quedan.
