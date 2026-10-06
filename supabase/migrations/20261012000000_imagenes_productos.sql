-- ============================================================
-- Migration: 20261012000000_imagenes_productos
-- Fotos de productos subidas desde el panel (Productos → editar producto).
--
-- productos.imagenes sigue siendo una lista de URLs: puede mezclar fotos de
-- este bucket con enlaces externos (pegados a mano o importados de Shopify,
-- que no se copian).
--
-- Bucket PÚBLICO a propósito: son fotos de catálogo (las mismas de la web del
-- negocio), el panel las muestra sin firmar URLs y en la fase 2 el proveedor
-- de WhatsApp las descarga para enviárselas al cliente.
-- Ruta: {workspace_id}/{archivo}. Solo admin y manager de ese workspace
-- pueden subir o borrar.
--
-- Si el INSERT en storage.buckets falla por permisos, crea el bucket en el
-- dashboard (Storage → New bucket) con estos datos y vuelve a correr esto.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'productos-imagenes',
  'productos-imagenes',
  true,
  5242880, -- 5 MB (el panel reduce las fotos antes de subirlas)
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- El primer segmento de la ruta es el workspace; se compara como texto para
-- que una ruta mal formada no rompa la política con un error de cast.
DROP POLICY IF EXISTS "productos_imagenes_insert" ON storage.objects;
CREATE POLICY "productos_imagenes_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'productos-imagenes'
  AND EXISTS (
    SELECT 1 FROM public.memberships m
     WHERE m.user_id = auth.uid() AND m.is_active
       AND m.role IN ('admin', 'manager')
       AND m.workspace_id::text = split_part(name, '/', 1)
  )
);

DROP POLICY IF EXISTS "productos_imagenes_delete" ON storage.objects;
CREATE POLICY "productos_imagenes_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'productos-imagenes'
  AND EXISTS (
    SELECT 1 FROM public.memberships m
     WHERE m.user_id = auth.uid() AND m.is_active
       AND m.role IN ('admin', 'manager')
       AND m.workspace_id::text = split_part(name, '/', 1)
  )
);

-- Lectura: el bucket es público (URL directa). Esta política solo hace falta
-- para listar o borrar desde el cliente del usuario.
DROP POLICY IF EXISTS "productos_imagenes_select" ON storage.objects;
CREATE POLICY "productos_imagenes_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'productos-imagenes'
  AND EXISTS (
    SELECT 1 FROM public.memberships m
     WHERE m.user_id = auth.uid() AND m.is_active
       AND m.workspace_id::text = split_part(name, '/', 1)
  )
);

-- ============================================================
-- End of migration: 20261012000000_imagenes_productos
-- ============================================================
