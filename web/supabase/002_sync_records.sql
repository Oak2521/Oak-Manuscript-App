-- Oak Manuscript authenticated SyncRecord v1 persistence.
-- This table stores only the already-minimized result record. Manuscript bytes,
-- excerpts, paths, filenames, hashes, device data, and account profile data are forbidden.
-- Run only as the Supabase database owner. Browser roles receive no table or RPC access;
-- a trusted server uses the service_role key to call the fixed functions below.

begin;

create or replace function public.oak_manuscript_sync_record_has_forbidden_key(
  p_value jsonb
) returns boolean
language plpgsql
immutable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_key text;
  v_child jsonb;
begin
  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in select key, value from jsonb_each(p_value)
    loop
      if v_key ~* '(content|body|text|title|abstract|keyword|preview|excerpt|snippet|filename|file_name|path|username|device|reference|footnote|image|sha(256)?|hash|fingerprint)' or
         public.oak_manuscript_sync_record_has_forbidden_key(v_child) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if public.oak_manuscript_sync_record_has_forbidden_key(v_child) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

revoke all on function public.oak_manuscript_sync_record_has_forbidden_key(jsonb)
  from public, anon, authenticated;

create table if not exists public.oak_manuscript_sync_records (
  account_id        text not null,
  idempotency_id    text not null,
  canonical_record text not null,
  record            jsonb not null,
  received_at       timestamptz not null default clock_timestamp(),
  primary key (account_id, idempotency_id),

  constraint oak_sync_account_ck check (
    char_length(account_id) between 8 and 128 and
    account_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  ),
  constraint oak_sync_id_ck check (
    char_length(idempotency_id) between 32 and 192 and
    idempotency_id ~ '^sync-v1:[0-9a-f]{16}:check-[0-9]{4,}$'
  ),
  constraint oak_sync_canonical_ck check (
    octet_length(canonical_record) between 2 and 65536 and
    canonical_record::jsonb = record
  ),
  constraint oak_sync_record_size_ck check (octet_length(record::text) between 2 and 65536),
  constraint oak_sync_record_keys_ck check (
    jsonb_typeof(record) = 'object' and
    record ?& array[
      'schema_version','record_type','project_id','run_id','idempotency_id','event',
      'document','citation','versions','counts','external_validation','export_state',
      'created_at','authorized_at'
    ] and
    record - array[
      'schema_version','record_type','project_id','run_id','idempotency_id','event',
      'document','citation','versions','counts','issues','external_validation','export_state',
      'created_at','authorized_at'
    ] = '{}'::jsonb
  ),
  constraint oak_sync_record_identity_ck check (
    record->>'schema_version' = '1.0' and
    record->>'record_type' = 'oak_manuscript_result' and
    record->>'project_id' ~ '^[0-9a-f]{16}$' and
    record->>'run_id' ~ '^check-[0-9]{4,}$' and
    record->>'idempotency_id' = idempotency_id and
    idempotency_id = 'sync-v1:' || (record->>'project_id') || ':' || (record->>'run_id') and
    record->>'event' in ('check','export')
  ),
  constraint oak_sync_record_nested_keys_ck check (
    jsonb_typeof(record->'document') = 'object' and
    record->'document' ?& array['format','manuscript_type','check_config','language_bucket','length_bucket'] and
    (record->'document') - array['format','manuscript_type','check_config','language_bucket','length_bucket'] = '{}'::jsonb and
    jsonb_typeof(record->'citation') = 'object' and
    record->'citation' ?& array['requested_style','resolved_style','mode','confidence','reason_code','resolver_version'] and
    (record->'citation') - array['requested_style','resolved_style','mode','confidence','reason_code','resolver_version'] = '{}'::jsonb and
    jsonb_typeof(record->'versions') = 'object' and
    record->'versions' ?& array['rulepack','app','platform'] and
    (record->'versions') - array['rulepack','app','platform'] = '{}'::jsonb and
    jsonb_typeof(record->'counts') = 'object' and
    record->'counts' ?& array['total','fixable','by_severity','by_dimension','by_status'] and
    (record->'counts') - array['total','fixable','by_severity','by_dimension','by_status'] = '{}'::jsonb and
    jsonb_typeof(record->'external_validation') = 'object' and
    record->'external_validation' ?& array['epubcheck','ace'] and
    (record->'external_validation') - array['epubcheck','ace'] = '{}'::jsonb and
    (not (record ? 'issues') or jsonb_typeof(record->'issues') = 'array')
  ),
  constraint oak_sync_record_forbidden_keys_ck check (
    not public.oak_manuscript_sync_record_has_forbidden_key(record)
  )
);

create index if not exists oak_sync_records_owner_received_idx
  on public.oak_manuscript_sync_records (account_id, received_at desc, idempotency_id desc);

alter table public.oak_manuscript_sync_records enable row level security;
alter table public.oak_manuscript_sync_records force row level security;
revoke all on table public.oak_manuscript_sync_records from public, anon, authenticated;

create or replace function public.oak_manuscript_sync_record_row(
  p_row public.oak_manuscript_sync_records
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'account_id', p_row.account_id,
    'canonical_record', p_row.canonical_record,
    'received_at', to_char(p_row.received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'record', p_row.record
  );
$$;

revoke all on function public.oak_manuscript_sync_record_row(public.oak_manuscript_sync_records)
  from public, anon, authenticated;

create or replace function public.oak_manuscript_sync_record_create_or_replay(
  p_account_id text,
  p_idempotency_id text,
  p_canonical_record text,
  p_record jsonb,
  p_max_records integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.oak_manuscript_sync_records%rowtype;
  v_outcome text;
begin
  if p_max_records not between 1 and 500 then
    raise exception using errcode = '22023', message = 'invalid bounded sync record limit';
  end if;
  if p_record is null or p_record->>'idempotency_id' is distinct from p_idempotency_id or
     p_canonical_record::jsonb is distinct from p_record then
    raise exception using errcode = '22023', message = 'invalid sync record identity';
  end if;

  -- The account lock makes count-plus-insert atomic across concurrent server instances.
  perform pg_advisory_xact_lock(hashtextextended('oak_manuscript_sync:' || p_account_id, 0));

  select * into v_row
  from public.oak_manuscript_sync_records
  where account_id = p_account_id and idempotency_id = p_idempotency_id
  for update;

  if found then
    if v_row.canonical_record = p_canonical_record then
      v_outcome := 'replayed';
    else
      v_outcome := 'conflict';
    end if;
  elsif (select count(*) from public.oak_manuscript_sync_records where account_id = p_account_id)
        >= p_max_records then
    v_outcome := 'limit';
  else
    insert into public.oak_manuscript_sync_records (
      account_id, idempotency_id, canonical_record, record
    ) values (
      p_account_id, p_idempotency_id, p_canonical_record, p_record
    ) returning * into v_row;
    v_outcome := 'created';
  end if;

  return jsonb_build_object(
    'schema_version', '1.0',
    'result_type', 'oak_manuscript_sync_record_create_result',
    'outcome', v_outcome,
    'row', case when v_outcome in ('created','replayed')
      then public.oak_manuscript_sync_record_row(v_row) else null end
  );
end;
$$;

create or replace function public.oak_manuscript_sync_record_list(
  p_account_id text,
  p_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid bounded sync record list limit';
  end if;
  with owned as materialized (
    select * from public.oak_manuscript_sync_records
    where account_id = p_account_id
  ), limited as (
    select * from owned
    order by received_at desc, idempotency_id desc
    limit p_limit
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(public.oak_manuscript_sync_record_row(r)
      order by r.received_at desc, r.idempotency_id desc) from limited r), '[]'::jsonb),
    'total', (select count(*) from owned)
  )
  into v_result
  ;
  return v_result;
end;
$$;

create or replace function public.oak_manuscript_sync_record_get(
  p_account_id text,
  p_idempotency_id text
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.oak_manuscript_sync_record_row(r)
  from public.oak_manuscript_sync_records r
  where r.account_id = p_account_id and r.idempotency_id = p_idempotency_id;
$$;

create or replace function public.oak_manuscript_sync_record_delete(
  p_account_id text,
  p_idempotency_id text
) returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted_count integer;
begin
  delete from public.oak_manuscript_sync_records
  where account_id = p_account_id and idempotency_id = p_idempotency_id;
  get diagnostics v_deleted_count = row_count;
  return v_deleted_count = 1;
end;
$$;

revoke all on function public.oak_manuscript_sync_record_create_or_replay(text,text,text,jsonb,integer)
  from public, anon, authenticated;
revoke all on function public.oak_manuscript_sync_record_list(text,integer)
  from public, anon, authenticated;
revoke all on function public.oak_manuscript_sync_record_get(text,text)
  from public, anon, authenticated;
revoke all on function public.oak_manuscript_sync_record_delete(text,text)
  from public, anon, authenticated;

grant execute on function public.oak_manuscript_sync_record_create_or_replay(text,text,text,jsonb,integer)
  to service_role;
grant execute on function public.oak_manuscript_sync_record_list(text,integer)
  to service_role;
grant execute on function public.oak_manuscript_sync_record_get(text,text)
  to service_role;
grant execute on function public.oak_manuscript_sync_record_delete(text,text)
  to service_role;

commit;
