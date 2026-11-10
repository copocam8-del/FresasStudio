-- Vacía el catálogo y los horarios que carga el seed, para tests que arman los suyos.
-- Corre dentro de la transacción del test (se descarta al final).
:as_super
delete from public.schedule_blocks;
delete from public.working_hours;
delete from public.professional_services;
delete from public.professionals;
delete from public.services;
delete from public.service_categories;
