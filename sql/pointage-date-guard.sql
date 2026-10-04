-- Exécuter dans Supabase > SQL Editor après déploiement du code version 9.
-- Les dates existantes ne sont pas inversées par cette migration.
-- Les nouvelles écritures de pointage doivent conserver le contrat source MDY.
begin;

create or replace function public.hr_validate_pointage_dates(part jsonb)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  punch jsonb;
  encoding text;
  source_text text;
  pieces text[];
  expected_date date;
  serial_date date;
  source_year integer;
begin
  if coalesce(part->>'dateNormalizationVersion', '') !~ '^[0-9]+$'
    or coalesce(part->>'sourceDateContract', '') <> 'mdy-visible-v1'
    or coalesce(part #>> '{calculationRules,dateOrder}', '') <> 'mdy' then
    raise exception 'Version de pointage obsolete. Rechargez la nouvelle application (dates MDY).'
      using errcode = '23514';
  end if;
  if (part->>'dateNormalizationVersion')::integer < 9 then
    raise exception 'La version de normalisation du pointage doit etre au moins 9.' using errcode = '23514';
  end if;
  if jsonb_typeof(part->'rawRows') is distinct from 'array' then
    raise exception 'Le pointage doit contenir les cellules source rawRows.' using errcode = '23514';
  end if;
  for punch in select value from jsonb_array_elements(part->'rawRows') loop
    if coalesce(punch->>'isoDate', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or coalesce(punch->>'pointageAt', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$'
      or left(punch->>'pointageAt', 10) is distinct from punch->>'isoDate'
      or punch->>'sourceDateIso' is distinct from punch->>'pointageAt' then
      raise exception 'Dates ISO du pointage incoherentes avec la cellule source.' using errcode = '23514';
    end if;
    -- Casts validate actual calendar dates and clock values as well.
    perform (punch->>'isoDate')::date;
    perform (punch->>'pointageAt')::timestamp;
    encoding := coalesce(punch->>'sourceDateEncoding', '');
    if encoding = 'canonical-iso' then
      expected_date := (punch->>'sourceDateIso')::timestamp::date;
    elsif encoding = 'iso-text' then
      pieces := regexp_match(coalesce(punch->>'sourceDateValue', ''), '^([0-9]{4})[-/.]([0-9]{1,2})[-/.]([0-9]{1,2})');
      if pieces is null then
        raise exception 'Source ISO du pointage invalide.' using errcode = '23514';
      end if;
      expected_date := make_date(pieces[1]::integer, pieces[2]::integer, pieces[3]::integer);
    elsif encoding = 'excel-localized-mdy' then
      -- Built-in formats 14/22 are regional in Excel. SheetJS renders them in
      -- US order; this French-export source policy reconstructs the visible DMY
      -- label and reads that label as the user's MDY data.
      serial_date := (timestamp '1899-12-30' + round((punch->>'sourceDateValue')::numeric * 86400000)
        * interval '1 millisecond')::date;
      expected_date := case when extract(day from serial_date) > 12 then serial_date
        else make_date(extract(year from serial_date)::integer,
          extract(day from serial_date)::integer, extract(month from serial_date)::integer) end;
    elsif encoding in ('mdy-text', 'excel-visible-mdy') then
      source_text := case when encoding = 'mdy-text' then punch->>'sourceDateValue' else punch->>'sourceDateText' end;
      pieces := regexp_match(coalesce(source_text, ''), '^([0-9]{1,2})[-/.]([0-9]{1,2})[-/.]([0-9]{4}|[0-9]{2})([[:space:]]|$)');
      if pieces is not null then
        source_year := pieces[3]::integer;
        if source_year < 100 then source_year := source_year + 2000; end if;
        expected_date := make_date(source_year, pieces[1]::integer, pieces[2]::integer);
      elsif encoding = 'excel-visible-mdy' and coalesce(source_text, '') = '' then
        serial_date := (timestamp '1899-12-30' + round((punch->>'sourceDateValue')::numeric * 86400000)
          * interval '1 millisecond')::date;
        expected_date := make_date(extract(year from serial_date)::integer,
          extract(day from serial_date)::integer, extract(month from serial_date)::integer);
      else
        raise exception 'Source MDY du pointage invalide.' using errcode = '23514';
      end if;
    elsif encoding = 'excel-serial' then
      -- Round like the JavaScript serial parser, including a fraction near midnight.
      serial_date := (timestamp '1899-12-30' + round((punch->>'sourceDateValue')::numeric * 86400000)
        * interval '1 millisecond')::date;
      expected_date := serial_date;
    else
      raise exception 'Encodage source du pointage inconnu.' using errcode = '23514';
    end if;
    if expected_date is distinct from (punch->>'isoDate')::date then
      raise exception 'Date du pointage differente de la source MDY. Ecriture refusee.' using errcode = '23514';
    end if;
  end loop;
end;
$$;

create or replace function public.hr_guard_pointage_dates()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.id <> 'rh-pointage-analysis' and new.id not like 'rh-pointage-history-%' then
    return new;
  end if;
  if coalesce(new.payload->>'cleared', 'false') <> 'true' then
    perform public.hr_validate_pointage_dates(new.payload);
    if jsonb_typeof(new.payload->'currentFilePointage') = 'object' then
      perform public.hr_validate_pointage_dates(new.payload->'currentFilePointage');
    end if;
  end if;
  -- A monotonic server revision makes conditional updates reliable even when
  -- two tabs send an identical/frozen client clock.
  if tg_op = 'UPDATE' then
    new.updated_at := greatest(clock_timestamp(), coalesce(old.updated_at, clock_timestamp()) + interval '1 microsecond');
  else
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists hr_pointage_date_guard on public.hr_dashboard_store;
create trigger hr_pointage_date_guard
before insert or update on public.hr_dashboard_store
for each row execute function public.hr_guard_pointage_dates();

commit;

-- Vérification après exécution : la première requête doit retourner une ligne.
select tgname from pg_trigger
where tgrelid = 'public.hr_dashboard_store'::regclass
  and tgname = 'hr_pointage_date_guard' and not tgisinternal;

select payload->>'fileName' as fichier,
       payload->>'dateNormalizationVersion' as version_dates,
       payload->>'sourceDateContract' as contrat_source,
       array(select distinct item->>'isoDate' from jsonb_array_elements(payload->'rawRows') item order by 1) as dates,
       jsonb_array_length(payload->'rawRows') as pointages
from public.hr_dashboard_store where id = 'rh-pointage-analysis';
