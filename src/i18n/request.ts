import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { COOKIE_IDIOMA, IDIOMA_POR_DEFECTO, esIdioma } from "./config";

// next-intl sin rutas por idioma: el idioma sale de la cookie que guarda el
// selector. Sin cookie, español.
export default getRequestConfig(async () => {
  const guardado = (await cookies()).get(COOKIE_IDIOMA)?.value;
  const locale = esIdioma(guardado) ? guardado : IDIOMA_POR_DEFECTO;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
