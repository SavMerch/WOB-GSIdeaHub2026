-- Removes ONLY the rows created by seed-demo.sql (request ids de000000-…),
-- along with their comments, reactions and links (via ON DELETE CASCADE).
delete from public.contributions where client_request_id::text like 'de000000-%';
delete from public.roadmap_items where client_request_id::text like 'de000000-%';
