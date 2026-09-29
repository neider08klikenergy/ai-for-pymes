"use client";

// Zona horaria del negocio para mostrar horas en el panel.
//
// Sin esto, las horas de los componentes cliente se formateaban en el
// servidor (Vercel corre en UTC) y el HTML llegaba con la hora UTC: un mensaje
// de las 7:24 p. m. en Bogotá aparecía como 00:24. Con la zona explícita el
// servidor y el navegador producen el mismo texto.

import { DEFAULT_TIMEZONE } from "./timezone";
import { createContext, useContext } from "react";

const ZonaHorariaContext = createContext<string>(DEFAULT_TIMEZONE);

export function ZonaHorariaProvider({
  zona,
  children,
}: {
  zona: string;
  children: React.ReactNode;
}) {
  return (
    <ZonaHorariaContext.Provider value={zona}>
      {children}
    </ZonaHorariaContext.Provider>
  );
}

export function useZonaHoraria(): string {
  return useContext(ZonaHorariaContext);
}
