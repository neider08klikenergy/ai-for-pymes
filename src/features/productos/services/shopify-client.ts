// Cliente de la Admin API de Shopify (GraphQL), solo para el servidor.
//
// Autenticación (desde 2026 Shopify ya no crea apps "custom" en el admin):
//  - Recomendada: el negocio crea la app en su Dev Dashboard (misma
//    organización que su tienda), le da el permiso read_products, la instala
//    y nos pasa Client ID + Client Secret. Con el *client credentials grant*
//    pedimos un token que dura 24 h y lo guardamos en memoria.
//  - Compatibilidad: un token de Admin API de una app custom anterior
//    (shpat_…) se usa tal cual.

import { createClient as svcClient } from "@supabase/supabase-js";
import { decryptCredentials } from "@/shared/lib/integration-secrets";
import {
  mapearProductoShopify,
  normalizarTienda,
  type NodoProductoShopify,
  type ProductoShopify,
} from "../lib/shopify";

export const SHOPIFY_API_VERSION = "2026-10";
const TIMEOUT_MS = 15_000;
const MAX_PAGINAS = 40; // 40 × 50 = 2.000 productos

export class ShopifyError extends Error {}

export interface ConfigShopify {
  tienda: string;
  clientId: string | null;
  clientSecret: string | null;
  accessToken: string | null;
}

type CredencialesShopify = {
  shopify_client_id?: unknown;
  shopify_client_secret?: unknown;
  shopify_access_token?: unknown;
};

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Configuración guardada del workspace, o null si no hay Shopify activo. */
export async function cargarConfigShopify(workspaceId: string): Promise<ConfigShopify | null> {
  const svc = svcClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await svc
    .from("integrations")
    .select("enabled, credentials, config")
    .eq("workspace_id", workspaceId)
    .eq("provider", "shopify")
    .maybeSingle();
  if (!data?.enabled) return null;

  const tienda = normalizarTienda(String((data.config as { shop_domain?: unknown } | null)?.shop_domain ?? ""));
  if (!tienda) return null;
  const c = (await decryptCredentials(data.credentials, workspaceId, "shopify")) as CredencialesShopify;
  return {
    tienda,
    clientId: texto(c.shopify_client_id),
    clientSecret: texto(c.shopify_client_secret),
    accessToken: texto(c.shopify_access_token),
  };
}

// Tokens del client credentials grant, por tienda + app (duran 24 h)
const tokens = new Map<string, { token: string; vence: number }>();

async function pedir(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new ShopifyError("No se pudo conectar con Shopify. Intenta de nuevo.");
  }
}

export async function tokenShopify(cfg: ConfigShopify): Promise<string> {
  if (cfg.accessToken) return cfg.accessToken;
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new ShopifyError("Faltan el Client ID y el Client Secret de la app de Shopify.");
  }
  const clave = `${cfg.tienda}:${cfg.clientId}`;
  const guardado = tokens.get(clave);
  if (guardado && guardado.vence > Date.now()) return guardado.token;

  const res = await pedir(`https://${cfg.tienda}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  });
  if (!res.ok) {
    throw new ShopifyError(
      res.status === 400 || res.status === 401
        ? "Shopify rechazó el Client ID o el Client Secret. Revisa que la app esté instalada en la tienda y sea de la misma organización."
        : `Shopify respondió ${res.status} al pedir el acceso.`,
    );
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new ShopifyError("Shopify no devolvió un token de acceso.");
  // Se renueva 5 minutos antes de que venza
  const segundos = Math.max((json.expires_in ?? 86_399) - 300, 60);
  tokens.set(clave, { token: json.access_token, vence: Date.now() + segundos * 1000 });
  return json.access_token;
}

async function graphql<T>(cfg: ConfigShopify, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const token = await tokenShopify(cfg);
  const res = await pedir(`https://${cfg.tienda}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) {
    tokens.delete(`${cfg.tienda}:${cfg.clientId}`);
    throw new ShopifyError("La app de Shopify no tiene permiso. Dale el permiso read_products y vuelve a instalarla.");
  }
  if (!res.ok) throw new ShopifyError(`Shopify respondió ${res.status}.`);
  const json = (await res.json()) as { data?: T; errors?: { message?: string }[] };
  if (json.errors?.length || !json.data) {
    const msg = json.errors?.[0]?.message ?? "respuesta vacía";
    console.error("[shopify] graphql:", msg);
    throw new ShopifyError(
      /access denied|scope/i.test(msg)
        ? "La app de Shopify no tiene el permiso read_products."
        : "Shopify no pudo responder la consulta.",
    );
  }
  return json.data;
}

/** Nombre de la tienda: prueba que la conexión funciona. */
export async function probarShopify(cfg: ConfigShopify): Promise<string> {
  const data = await graphql<{ shop: { name: string } }>(cfg, "query { shop { name } }");
  return data.shop.name;
}

const PRODUCTOS_QUERY = `
  query Productos($cursor: String) {
    products(first: 50, after: $cursor) {
      nodes {
        id
        handle
        title
        productType
        description
        status
        featuredMedia { preview { image { url } } }
        variants(first: 100) {
          nodes { id price sku selectedOptions { name value } }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/** Todos los productos de la tienda, ya en el formato del catálogo. */
export async function leerProductosShopify(cfg: ConfigShopify): Promise<ProductoShopify[]> {
  const productos: ProductoShopify[] = [];
  let cursor: string | null = null;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const data: {
      products: { nodes: NodoProductoShopify[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    } = await graphql(cfg, PRODUCTOS_QUERY, { cursor });
    productos.push(...data.products.nodes.map(mapearProductoShopify));
    if (!data.products.pageInfo.hasNextPage) return productos;
    cursor = data.products.pageInfo.endCursor;
  }
  throw new ShopifyError(`La tienda tiene más de ${MAX_PAGINAS * 50} productos; la importación no está lista para ese tamaño.`);
}
