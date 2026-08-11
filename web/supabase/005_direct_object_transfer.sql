-- Oak Manuscript Web 对象直传状态扩展。
-- 仅增加 content-free 状态；签名 URL、稿件字节、对象键和服务端凭据不得进入数据库。

begin;

alter table public.oak_manuscript_web_jobs
  drop constraint oak_web_job_state_ck,
  drop constraint oak_web_job_reservation_pair_ck,
  drop constraint oak_web_job_state_payload_ck;

alter table public.oak_manuscript_web_jobs
  add constraint oak_web_job_state_ck check (
    state in (
      'awaiting_upload','upload_finalizing','queued','processing','result_ready',
      'result_transfer','deletion_pending'
    )
  ),
  add constraint oak_web_job_reservation_pair_ck check (
    (upload_reservation_id is null) = (upload_reservation_expires_at is null) and
    (upload_reservation_id is null or (
      state in ('awaiting_upload','upload_finalizing','result_transfer') and
      upload_reservation_expires_at > created_at and upload_reservation_expires_at <= expires_at
    ))
  ),
  add constraint oak_web_job_state_payload_ck check (
    state = 'deletion_pending' or
    (state in ('awaiting_upload','upload_finalizing') and not input_retained and not result_available) or
    (state = 'queued' and input_retained and not result_available) or
    (state = 'processing' and input_retained and not result_available) or
    (state in ('result_ready','result_transfer') and not input_retained and result_available)
  );

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
  if p_expected_revision < 0 or coalesce(array_length(p_expected_states, 1), 0) not between 1 and 7 or
     not (p_expected_states <@ array[
       'awaiting_upload','upload_finalizing','queued','processing','result_ready',
       'result_transfer','deletion_pending'
     ]::text[]) then
    raise exception using errcode = '22023', message = 'invalid compare-and-swap expectation';
  end if;

  select * into v_current from public.oak_manuscript_web_jobs
  where owner_key = p_owner_key and job_id = p_job_id
    and revision = p_expected_revision and state = any(p_expected_states)
  for update;
  if not found then return null; end if;

  if not (
    v_current.state = p_next_state or
    (v_current.state = 'awaiting_upload' and p_next_state in ('upload_finalizing','queued','deletion_pending')) or
    (v_current.state = 'upload_finalizing' and p_next_state in ('awaiting_upload','queued','deletion_pending')) or
    (v_current.state = 'queued' and p_next_state in ('processing','deletion_pending')) or
    (v_current.state = 'processing' and p_next_state in ('result_ready','deletion_pending')) or
    (v_current.state = 'result_ready' and p_next_state in ('result_transfer','deletion_pending')) or
    (v_current.state = 'result_transfer' and p_next_state in ('result_ready','deletion_pending'))
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

create or replace function public.oak_manuscript_web_job_list_cleanup_due(
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
      order by case
        when q.state = 'deletion_pending' then 0
        when q.state = 'result_transfer' then 1
        else 2
      end, q.updated_at, q.expires_at, q.job_id), '[]'::jsonb)
  else null end
  from (
    select * from public.oak_manuscript_web_jobs
    where state = 'deletion_pending' or expires_at <= p_before or
      (state = 'result_transfer' and upload_reservation_expires_at <= p_before)
    order by case
      when state = 'deletion_pending' then 0
      when state = 'result_transfer' then 1
      else 2
    end, updated_at, expires_at, job_id
    limit greatest(0, least(coalesce(p_limit, 0), 100))
  ) q;
$$;

revoke all on function public.oak_manuscript_web_job_compare_and_swap(
  text,text,bigint,text[],text,boolean,boolean,text,text,uuid,timestamptz,uuid,timestamptz
) from public, anon, authenticated;
revoke all on function public.oak_manuscript_web_job_list_cleanup_due(timestamptz,integer)
  from public, anon, authenticated;

grant execute on function public.oak_manuscript_web_job_compare_and_swap(
  text,text,bigint,text[],text,boolean,boolean,text,text,uuid,timestamptz,uuid,timestamptz
) to service_role;
grant execute on function public.oak_manuscript_web_job_list_cleanup_due(timestamptz,integer)
  to service_role;

commit;
