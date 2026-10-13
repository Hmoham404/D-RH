-- Read-only diagnostics for a shared database. No schema/data/permission changes.
-- Run via an authorized Supabase SQL connection. Table-to-application ownership
-- must be confirmed before grouping unrelated tables into named projects.
begin transaction read only;

select current_database() as database_name,
       pg_database_size(current_database()) as database_bytes,
       pg_size_pretty(pg_database_size(current_database())) as database_size;

select n.nspname as schema_name, c.relname as table_name,
       pg_table_size(c.oid) as table_and_toast_bytes,
       pg_indexes_size(c.oid) as index_bytes,
       pg_total_relation_size(c.oid) as total_bytes,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
       s.n_live_tup as estimated_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
where c.relkind in ('r', 'm')
  and n.nspname not in ('pg_catalog', 'information_schema')
  and n.nspname not like 'pg_toast%'
order by total_bytes desc;

-- Logical payload sizes by known RH feature within the shared JSON table.
-- These values are not physical disk sizes and exclude indexes and dead tuples.
select case
         when id = 'rh-pointage-analysis' then 'RH - pointage courant'
         when id like 'rh-pointage-history-%' then 'RH - historique pointage'
         when id = 'rh-bus-capacities' then 'RH - bus'
         when id = 'rh-homepage' then 'RH - accueil'
         else 'Autre identifiant - attribution a confirmer'
       end as logical_group,
       count(*) as records,
       sum(octet_length(payload::text)) as uncompressed_json_bytes
from public.hr_dashboard_store
group by 1 order by 3 desc;

commit;
