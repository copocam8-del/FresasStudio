-- =====================================================================
-- Fija search_path = '' en las funciones SECURITY INVOKER que no lo tenían.
--
-- Supabase Security Advisor las marcaba como "function_search_path_mutable".
-- Son triggers y helpers que corren con los permisos de quien llama, así que
-- el riesgo era bajo, pero un search_path mutable permite que un objeto con el
-- mismo nombre en otro esquema se resuelva en lugar del esperado.
--
-- Todas ya nombran cada objeto con su esquema (app., auth., pg_catalog.) y el
-- resto son funciones de pg_catalog (now(), current_user), que se resuelven
-- siempre, así que fijar search_path = '' no cambia su comportamiento.
--
-- El test meta de db/tests ahora exige search_path = '' en TODAS las funciones
-- de public y app, no solo en las SECURITY DEFINER.
-- =====================================================================

alter function app.set_updated_at()        set search_path = '';
alter function app.is_privileged_session() set search_path = '';
alter function app.validate_tenant()       set search_path = '';
alter function app.guard_membership()      set search_path = '';
alter function app.guard_role_permission() set search_path = '';
alter function app.guard_invitation_role() set search_path = '';
alter function app.prevent_mutation()      set search_path = '';
