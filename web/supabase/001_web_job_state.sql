-- Oak Manuscript Web 作业状态与幂等数据库 v1。
-- 只保存内容无关的任务元数据；稿件输入/输出不得进入这些表。
-- 迁移必须由 Supabase 数据库所有者执行。浏览器 anon/authenticated 角色无表或 RPC 权限；
-- Netlify 服务端以 service_role 调用固定 RPC，service-role key 永不得进入前端。

begin;

create table if not exists public.oak_manuscript_web_jobs (
  job_id                         text primary key,
  owner_key                      text not null,
  state                          text not null,
  created_at                     timestamptz not null default clock_timestamp(),
  updated_at                     timestamptz not null default clock_timestamp(),
  expires_at                     timestamptz not null,
  input_retained                 boolean not null default false,
  result_available               boolean not null default false,
  result_media_type              text,
  pending_deletion_reason        text,
  request_fingerprint            text not null,
  request_canonical              text not null,
  idempotency_key                text not null,
  document                       jsonb not null,
  upload_reservation_id          uuid,
  upload_reservation_expires_at  timestamptz,
  lease_id                       uuid,
  lease_expires_at               timestamptz,
  revision                       bigint not null default 0,

  constraint oak_web_job_id_ck check (
    job_id ~ '^webjob-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint oak_web_job_owner_ck check (
    char_length(owner_key) between 16 and 138 and
    owner_key ~ '^(account|anonymous):[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  ),
  constraint oak_web_job_state_ck check (
    state in ('awaiting_upload','queued','processing','result_ready','deletion_pending')
  ),
  constraint oak_web_job_time_ck check (
    updated_at >= created_at and expires_at > created_at
  ),
  constraint oak_web_job_fingerprint_ck check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint oak_web_job_idempotency_key_ck check (
    char_length(idempotency_key) between 16 and 128 and
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$'
  ),
  constraint oak_web_job_request_ck check (octet_length(request_canonical) between 2 and 8192),
  constraint oak_web_job_document_keys_ck check (
    jsonb_typeof(document) = 'object' and
    document ?& array['format','manuscript_type','check_config','citation_style','size_bytes'] and
    document - array['format','manuscript_type','check_config','citation_style','size_bytes'] = '{}'::jsonb
  ),
  constraint oak_web_job_document_values_ck check (
    document->>'format' in ('docx','md','txt','epub') and
    document->>'manuscript_type' in ('paper','print_book','ebook') and
    document->>'check_config' in ('quick','full') and
    document->>'citation_style' in (
      'default','gbt7714-2025','apa-7','chicago-18-nb','chicago-18-ad','none'
    ) and
    case
      when jsonb_typeof(document->'size_bytes') = 'number' and
           document->>'size_bytes' ~ '^[1-9][0-9]{0,7}$'
      then (document->>'size_bytes')::bigint between 1 and 52428800
      else false
    end
  ),
  constraint oak_web_job_result_media_ck check (
    result_media_type is null or result_media_type in (
      'application/json','application/pdf','application/epub+zip',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/markdown','text/plain'
    )
  ),
  constraint oak_web_job_result_pair_ck check (
    result_available = (result_media_type is not null)
  ),
  constraint oak_web_job_delete_reason_ck check (
    (state = 'deletion_pending') = (pending_deletion_reason is not null) and
    (pending_deletion_reason is null or pending_deletion_reason in (
      'canceled','expired','user_deleted','processing_failed','downloaded'
    ))
  ),
  constraint oak_web_job_reservation_pair_ck check (
    (upload_reservation_id is null) = (upload_reservation_expires_at is null) and
    (upload_reservation_id is null or (
      state = 'awaiting_upload' and upload_reservation_expires_at > created_at and
      upload_reservation_expires_at <= expires_at
    ))
  ),
  constraint oak_web_job_lease_pair_ck check (
    (lease_id is null) = (lease_expires_at is null) and
    ((state = 'processing') = (lease_id is not null)) and
    (lease_id is null or (
      state = 'processing' and lease_expires_at > created_at and lease_expires_at <= expires_at
    ))
  ),
  constraint oak_web_job_state_payload_ck check (
    state = 'deletion_pending' or
    (state = 'awaiting_upload' and not input_retained and not result_available) or
    (state = 'queued' and input_retained and not result_available) or
    (state = 'processing' and input_retained and not result_available) or
    (state = 'result_ready' and not input_retained and result_available)
  ),
  constraint oak_web_job_revision_ck check (revision >= 0)
);

create table if not exists public.oak_manuscript_web_job_idempotency (
  owner_key            text not null,
  idempotency_key      text not null,
  request_fingerprint  text not null,
  job_id               text unique references public.oak_manuscript_web_jobs(job_id) on delete set null,
  terminal             boolean not null default false,
  created_at           timestamptz not null default clock_timestamp(),
  terminal_at          timestamptz,
  primary key (owner_key, idempotency_key),

  constraint oak_web_idem_owner_ck check (
    char_length(owner_key) between 16 and 138 and
    owner_key ~ '^(account|anonymous):[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  ),
  constraint oak_web_idem_key_ck check (
    char_length(idempotency_key) between 16 and 128 and
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$'
  ),
  constraint oak_web_idem_fingerprint_ck check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint oak_web_idem_terminal_ck check (
    (terminal and job_id is null and terminal_at is not null) or
    (not terminal and job_id is not null and terminal_at is null)
  )
);

create index if not exists oak_web_jobs_owner_created_idx
  on public.oak_manuscript_web_jobs (owner_key, created_at, job_id);
create index if not exists oak_web_jobs_expiry_idx
  on public.oak_manuscript_web_jobs (expires_at, job_id);
create index if not exists oak_web_jobs_active_owner_idx
  on public.oak_manuscript_web_jobs (owner_key, state);
create index if not exists oak_web_jobs_claim_idx
  on public.oak_manuscript_web_jobs (state, lease_expires_at, created_at, job_id)
  where state in ('queued', 'processing');

alter table public.oak_manuscript_web_jobs enable row level security;
alter table public.oak_manuscript_web_jobs force row level security;
alter table public.oak_manuscript_web_job_idempotency enable row level security;
alter table public.oak_manuscript_web_job_idempotency force row level security;

revoke all on table public.oak_manuscript_web_jobs from public, anon, authenticated;
revoke all on table public.oak_manuscript_web_job_idempotency from public, anon, authenticated;

create or replace function public.oak_manuscript_web_job_record(
  p_job public.oak_manuscript_web_jobs
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'schema_version', '1.0',
    'record_type', 'oak_manuscript_web_job_internal',
    'job_id', p_job.job_id,
    'owner_key', p_job.owner_key,
    'state', p_job.state,
    'created_at', to_char(p_job.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updated_at', to_char(p_job.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expires_at', to_char(p_job.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'input_retained', p_job.input_retained,
    'result_available', p_job.result_available,
    'result_media_type', p_job.result_media_type,
    'pending_deletion_reason', p_job.pending_deletion_reason,
    'request_fingerprint', p_job.request_fingerprint,
    'request_canonical', p_job.request_canonical,
    'idempotency_key', p_job.idempotency_key,
    'document', p_job.document,
    'upload_reservation_id', p_job.upload_reservation_id,
    'upload_reservation_expires_at', case when p_job.upload_reservation_expires_at is null then null
      else to_char(p_job.upload_reservation_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'lease_id', p_job.lease_id,
    'lease_expires_at', case when p_job.lease_expires_at is null then null
      else to_char(p_job.lease_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'revision', p_job.revision
  );
$$;

revoke all on function public.oak_manuscript_web_job_record(public.oak_manuscript_web_jobs)
  from public, anon, authenticated;

create or replace function public.oak_manuscript_web_job_create_or_replay(
  p_owner_key text,
  p_job_id text,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_request_canonical text,
  p_document jsonb,
  p_ttl_seconds integer,
  p_max_active_per_owner integer,
  p_max_active_global integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_idem public.oak_manuscript_web_job_idempotency%rowtype;
  v_job public.oak_manuscript_web_jobs%rowtype;
  v_now timestamptz := clock_timestamp();
  v_outcome text;
begin
  if p_ttl_seconds not between 60 and 3600 or
     p_max_active_per_owner not between 1 and 100 or
     p_max_active_global not between 1 and 100000 then
    raise exception using errcode = '22023', message = 'invalid bounded job settings';
  end if;

  -- 全局锁使“计数 + 插入”在多实例间原子；owner 锁保留明确的同账户序列化语义。
  perform pg_advisory_xact_lock(hashtextextended('oak_manuscript_web_job_global', 0));
  perform pg_advisory_xact_lock(hashtextextended(p_owner_key, 0));

  select * into v_idem
  from public.oak_manuscript_web_job_idempotency
  where owner_key = p_owner_key and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_idem.request_fingerprint <> p_request_fingerprint then
      v_outcome := 'conflict';
    elsif v_idem.terminal or v_idem.job_id is null then
      v_outcome := 'terminal';
    else
      select * into v_job from public.oak_manuscript_web_jobs
      where job_id = v_idem.job_id and owner_key = p_owner_key
        and idempotency_key = p_idempotency_key
        and request_fingerprint = p_request_fingerprint;
      if not found then
        v_outcome := 'terminal';
      else
        v_outcome := 'replayed';
      end if;
    end if;
  elsif exists (select 1 from public.oak_manuscript_web_jobs where job_id = p_job_id) then
    v_outcome := 'job_id_collision';
  elsif (select count(*) from public.oak_manuscript_web_jobs) >= p_max_active_global then
    v_outcome := 'global_limit';
  elsif (select count(*) from public.oak_manuscript_web_jobs where owner_key = p_owner_key)
        >= p_max_active_per_owner then
    v_outcome := 'owner_limit';
  else
    insert into public.oak_manuscript_web_jobs (
      job_id, owner_key, state, created_at, updated_at, expires_at,
      request_fingerprint, request_canonical, idempotency_key, document
    ) values (
      p_job_id, p_owner_key, 'awaiting_upload', v_now, v_now,
      v_now + make_interval(secs => p_ttl_seconds),
      p_request_fingerprint, p_request_canonical, p_idempotency_key, p_document
    ) returning * into v_job;

    insert into public.oak_manuscript_web_job_idempotency (
      owner_key, idempotency_key, request_fingerprint, job_id
    ) values (p_owner_key, p_idempotency_key, p_request_fingerprint, p_job_id);
    v_outcome := 'created';
  end if;

  return jsonb_build_object(
    'schema_version', '1.0',
    'result_type', 'oak_manuscript_web_job_create_result',
    'outcome', v_outcome,
    'record', case when v_job.job_id is null then null
      else public.oak_manuscript_web_job_record(v_job) end
  );
end;
$$;

create or replace function public.oak_manuscript_web_job_get(
  p_owner_key text,
  p_job_id text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_job public.oak_manuscript_web_jobs%rowtype;
begin
  select * into v_job from public.oak_manuscript_web_jobs
  where owner_key = p_owner_key and job_id = p_job_id;
  if not found then return null; end if;
  return public.oak_manuscript_web_job_record(v_job);
end;
$$;

create or replace function public.oak_manuscript_web_job_list(
  p_owner_key text
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(public.oak_manuscript_web_job_record(j)
    order by j.created_at, j.job_id), '[]'::jsonb)
  from public.oak_manuscript_web_jobs j
  where j.owner_key = p_owner_key;
$$;

create or replace function public.oak_manuscript_web_job_compare_and_swap(
  p_owner_key text,
  p_job_id text,
  p_expected_revision bigint,
  p_expected_states text[],
  p_next_state text,
  p_input_retained boolean,
  p_result_available boolean,
  p_result_media_type text,
  p_pending_deletion_reason text,
  p_upload_reservation_id uuid,
  p_upload_reservation_expires_at timestamptz,
  p_lease_id uuid,
  p_lease_expires_at timestamptz
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.oak_manuscript_web_jobs%rowtype;
  v_updated public.oak_manuscript_web_jobs%rowtype;
begin
  if p_expected_revision < 0 or coalesce(array_length(p_expected_states, 1), 0) not between 1 and 5 or
     not (p_expected_states <@ array['awaiting_upload','queued','processing','result_ready','deletion_pending']::text[]) then
    raise exception using errcode = '22023', message = 'invalid compare-and-swap expectation';
  end if;

  select * into v_current from public.oak_manuscript_web_jobs
  where owner_key = p_owner_key and job_id = p_job_id
    and revision = p_expected_revision and state = any(p_expected_states)
  for update;
  if not found then return null; end if;

  if not (
    v_current.state = p_next_state or
    (v_current.state = 'awaiting_upload' and p_next_state in ('queued','deletion_pending')) or
    (v_current.state = 'queued' and p_next_state in ('processing','deletion_pending')) or
    (v_current.state = 'processing' and p_next_state in ('result_ready','deletion_pending')) or
    (v_current.state = 'result_ready' and p_next_state = 'deletion_pending')
  ) then
    raise exception using errcode = '22023', message = 'invalid web job state transition';
  end if;

  if v_current.state = 'awaiting_upload' and p_next_state = 'awaiting_upload' and
     v_current.upload_reservation_id is not null and p_upload_reservation_id is not null and
     v_current.upload_reservation_id <> p_upload_reservation_id and
     v_current.upload_reservation_expires_at > clock_timestamp() then
    raise exception using errcode = '55000', message = 'active upload reservation cannot be replaced';
  end if;
  if v_current.state = 'processing' and p_next_state = 'processing' and
     v_current.lease_id is not null and p_lease_id is not null and
     v_current.lease_id <> p_lease_id and v_current.lease_expires_at > clock_timestamp() then
    raise exception using errcode = '55000', message = 'active processing lease cannot be replaced';
  end if;

  update public.oak_manuscript_web_jobs set
    state = p_next_state,
    updated_at = clock_timestamp(),
    input_retained = p_input_retained,
    result_available = p_result_available,
    result_media_type = p_result_media_type,
    pending_deletion_reason = p_pending_deletion_reason,
    upload_reservation_id = p_upload_reservation_id,
    upload_reservation_expires_at = p_upload_reservation_expires_at,
    lease_id = p_lease_id,
    lease_expires_at = p_lease_expires_at,
    revision = revision + 1
  where job_id = v_current.job_id
  returning * into v_updated;

  return public.oak_manuscript_web_job_record(v_updated);
end;
$$;

create or replace function public.oak_manuscript_web_job_finalize_deletion(
  p_owner_key text,
  p_job_id text,
  p_expected_revision bigint
) returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare v_job public.oak_manuscript_web_jobs%rowtype;
begin
  select * into v_job from public.oak_manuscript_web_jobs
  where owner_key = p_owner_key and job_id = p_job_id
    and revision = p_expected_revision and state = 'deletion_pending'
  for update;
  if not found then return false; end if;

  update public.oak_manuscript_web_job_idempotency set
    terminal = true,
    terminal_at = clock_timestamp(),
    job_id = null
  where owner_key = v_job.owner_key and idempotency_key = v_job.idempotency_key
    and request_fingerprint = v_job.request_fingerprint and job_id = v_job.job_id and not terminal;
  if not found then
    raise exception using errcode = '23514', message = 'idempotency tombstone transition failed';
  end if;

  delete from public.oak_manuscript_web_jobs where job_id = v_job.job_id;
  return true;
end;
$$;

create or replace function public.oak_manuscript_web_job_claim_next(
  p_lease_id uuid,
  p_lease_seconds integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_job public.oak_manuscript_web_jobs%rowtype;
begin
  if p_lease_id is null or p_lease_seconds not between 30 and 900 then
    raise exception using errcode = '22023', message = 'invalid processing lease request';
  end if;

  select * into v_job
  from public.oak_manuscript_web_jobs
  where expires_at > v_now + make_interval(secs => p_lease_seconds) and
    input_retained and not result_available and (
    state = 'queued' or
    (state = 'processing' and lease_id is not null and lease_expires_at <= v_now)
  )
  order by
    case when state = 'processing' then lease_expires_at else created_at end,
    created_at,
    job_id
  for update skip locked
  limit 1;
  if not found then return null; end if;

  update public.oak_manuscript_web_jobs set
    state = 'processing',
    updated_at = v_now,
    upload_reservation_id = null,
    upload_reservation_expires_at = null,
    lease_id = p_lease_id,
    lease_expires_at = least(v_job.expires_at, v_now + make_interval(secs => p_lease_seconds)),
    revision = revision + 1
  where job_id = v_job.job_id
  returning * into v_job;

  return public.oak_manuscript_web_job_record(v_job);
end;
$$;

create or replace function public.oak_manuscript_web_job_list_expired(
  p_before timestamptz,
  p_limit integer default 100
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when p_limit between 1 and 100 then
    coalesce(jsonb_agg(public.oak_manuscript_web_job_record(q)
      order by q.expires_at, q.job_id), '[]'::jsonb)
  else null end
  from (
    select * from public.oak_manuscript_web_jobs
    where expires_at <= p_before
    order by expires_at, job_id
    limit greatest(0, least(coalesce(p_limit, 0), 100))
  ) q;
$$;

revoke all on function public.oak_manuscript_web_job_create_or_replay(
  text,text,text,text,text,jsonb,integer,integer,integer
) from public, anon, authenticated;
revoke all on function public.oak_manuscript_web_job_get(text,text)
  from public, anon, authenticated;
revoke all on function public.oak_manuscript_web_job_list(text)
  from public, anon, authenticated;
revoke all on function public.oak_manuscript_web_job_compare_and_swap(
  text,text,bigint,text[],text,boolean,boolean,text,text,uuid,timestamptz,uuid,timestamptz
) from public, anon, authenticated;
revoke all on function public.oak_manuscript_web_job_finalize_deletion(text,text,bigint)
  from public, anon, authenticated;
revoke all on function public.oak_manuscript_web_job_claim_next(uuid,integer)
  from public, anon, authenticated;
revoke all on function public.oak_manuscript_web_job_list_expired(timestamptz,integer)
  from public, anon, authenticated;

grant execute on function public.oak_manuscript_web_job_create_or_replay(
  text,text,text,text,text,jsonb,integer,integer,integer
) to service_role;
grant execute on function public.oak_manuscript_web_job_get(text,text) to service_role;
grant execute on function public.oak_manuscript_web_job_list(text) to service_role;
grant execute on function public.oak_manuscript_web_job_compare_and_swap(
  text,text,bigint,text[],text,boolean,boolean,text,text,uuid,timestamptz,uuid,timestamptz
) to service_role;
grant execute on function public.oak_manuscript_web_job_finalize_deletion(text,text,bigint)
  to service_role;
grant execute on function public.oak_manuscript_web_job_claim_next(uuid,integer)
  to service_role;
grant execute on function public.oak_manuscript_web_job_list_expired(timestamptz,integer)
  to service_role;

commit;
