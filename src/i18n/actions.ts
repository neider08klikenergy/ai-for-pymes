"use server";

import { cookies } from "next/headers";
import { COOKIE_IDIOMA, esIdioma } from "./config";

/** Guarda el idioma elegido en el selector (un año, en este navegador). */
export async function cambiarIdioma(idioma: string): Promise<void> {
  if (!esIdioma(idioma)) return;
  (await cookies()).set(COOKIE_IDIOMA, idioma, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
