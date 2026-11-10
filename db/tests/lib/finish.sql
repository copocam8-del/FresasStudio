-- ---------------------------------------------------------------------
-- Resumen
-- ---------------------------------------------------------------------
\o
\pset tuples_only on
select format('%s tests · %s ok · %s fallidos',
              count(*), count(*) filter (where ok), count(*) filter (where not ok))
from tests.results;
select '  FALLÓ: ' || name from tests.results where not ok order by n;

do $$
begin
  if exists (select 1 from tests.results where not ok) then
    raise exception 'Hay tests fallidos';
  end if;
end $$;

rollback;
