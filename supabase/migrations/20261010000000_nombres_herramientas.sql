-- ============================================================
-- Migration: 20261010000000_nombres_herramientas
-- Dos herramientas se mostraban como "Consultar disponibilidad" en
-- Settings → Tools: check_availability (horarios libres del calendario de
-- HighLevel) y consultar_disponibilidad (productos de una sede ese día).
-- Solo cambia el nombre y la descripción visibles. Idempotente.
-- ============================================================

UPDATE public.tools
   SET name = 'Horarios libres (HighLevel)',
       description = 'Consulta los horarios libres del calendario de HighLevel para agendar citas'
 WHERE key = 'check_availability';

UPDATE public.tools
   SET name = 'Disponibilidad de productos',
       description = 'Qué productos hay en una sede para una fecha: menú del día con cantidades, agotados, siempre disponibles y por encargo'
 WHERE key = 'consultar_disponibilidad';
