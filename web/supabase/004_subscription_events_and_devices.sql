-- Normalized subscription snapshots and owner-scoped device management.
-- Raw billing webhooks and customer/payment data are verified and reduced by
-- an upstream adapter; only the exact content-free snapshot enters this layer.

begin;

alter table public.oak_manuscript_entitlements
  add column if not exists source_provider text,
  add column if not exists source_event_id text,
  add column if not exists source_event_at timestamptz,
  add column if not exists source_event_fingerprint text;

alter table public.oak_manuscript_entitlements
  add constraint oak_license_source_snapshot_ck check (
    (source_provider is null and source_event_id is null and source_event_at is null and source_event_fingerprint is null) or
    (source_provider ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' and
     source_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,191}$' and
     source_event_at is not null and source_event_fingerprint ~ '^[0-9a-f]{64}$')
  );

create table if not exists public.oak_manuscript_subscription_events (
  provider_id text not null,
  provider_event_id text not null,
  account_id text not null references public.oak_manuscript_entitlements(account_id) on delete restrict,
  entitlement_id text not null,
  event_reason text not null,
  entitlement_state text not null,
  occurred_at timestamptz not null,
  issued_at timestamptz not null,
  not_before timestamptz not null,
  valid_until timestamptz not null,
  grace_until timestamptz not null,
  event_fingerprint text not null,
  apply_outcome text not null,
  entitlement_revision bigint,
  received_at timestamptz not null default clock_timestamp(),
  primary key (provider_id, provider_event_id),

  constraint oak_subscription_provider_ck check (
    provider_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  ),
  constraint oak_subscription_event_id_ck check (
    char_length(provider_event_id) between 8 and 192 and
    provider_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,191}$'
  ),
  constraint oak_subscription_account_ck check (
    account_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
  ),
  constraint oak_subscription_entitlement_ck check (
    entitlement_id ~ '^ent-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint oak_subscription_reason_ck check (
    event_reason in ('purchase','renewal','cancellation','refund','chargeback','manual')
  ),
  constraint oak_subscription_state_ck check (entitlement_state in ('active','revoked')),
  constraint oak_subscription_reason_state_ck check (
    (event_reason not in ('purchase','renewal') or entitlement_state = 'active') and
    (event_reason not in ('refund','chargeback') or entitlement_state = 'revoked')
  ),
  constraint oak_subscription_time_order_ck check (
    issued_at <= occurred_at and issued_at <= not_before and
    not_before <= valid_until and valid_until <= grace_until
  ),
  constraint oak_subscription_fingerprint_ck check (event_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint oak_subscription_outcome_ck check (apply_outcome in ('applied','stale')),
  constraint oak_subscription_revision_ck check (
    (apply_outcome = 'applied' and entitlement_revision >= 1) or
    (apply_outcome = 'stale' and entitlement_revision is null)
  )
);

create index if not exists oak_subscription_events_account_time_idx
  on public.oak_manuscript_subscription_events (account_id, occurred_at desc);

alter table public.oak_manuscript_subscription_events enable row level security;
alter table public.oak_manuscript_subscription_events force row level security;
revoke all on table public.oak_manuscript_subscription_events from public, anon, authenticated;

create or replace function public.oak_manuscript_license_apply_subscription_event(
  p_provider_id text,
  p_event jsonb,
  p_canonical_event text,
  p_event_fingerprint text
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_key_count integer;
  v_existing public.oak_manuscript_subscription_events%rowtype;
  v_entitlement public.oak_manuscript_entitlements%rowtype;
  v_account_id text;
  v_event_id text;
  v_entitlement_id text;
  v_reason text;
  v_state text;
  v_occurred_at timestamptz;
  v_issued_at timestamptz;
  v_not_before timestamptz;
  v_valid_until timestamptz;
  v_grace_until timestamptz;
  v_revision bigint;
begin
  if p_provider_id is null or p_provider_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' or
     p_event is null or jsonb_typeof(p_event) <> 'object' or
     p_canonical_event is null or octet_length(p_canonical_event) > 4096 or
     p_event_fingerprint is null or p_event_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid bounded subscription event input';
  end if;
  select count(*) into v_key_count from jsonb_object_keys(p_event);
  if v_key_count <> 12 or not p_event ?& array[
    'schema_version','event_type','provider_event_id','account_id','entitlement_id','reason',
    'entitlement_state','occurred_at','issued_at','not_before','valid_until','grace_until'
  ] or p_canonical_event::jsonb <> p_event or
     p_event->>'schema_version' <> '1.0' or
     p_event->>'event_type' <> 'oak_manuscript_subscription_snapshot' then
    raise exception using errcode = '22023', message = 'invalid exact subscription event';
  end if;

  v_event_id := p_event->>'provider_event_id';
  v_account_id := p_event->>'account_id';
  v_entitlement_id := p_event->>'entitlement_id';
  v_reason := p_event->>'reason';
  v_state := p_event->>'entitlement_state';
  v_occurred_at := (p_event->>'occurred_at')::timestamptz;
  v_issued_at := (p_event->>'issued_at')::timestamptz;
  v_not_before := (p_event->>'not_before')::timestamptz;
  v_valid_until := (p_event->>'valid_until')::timestamptz;
  v_grace_until := (p_event->>'grace_until')::timestamptz;

  if v_event_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,191}$' or
     v_account_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' or
     v_entitlement_id !~ '^ent-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or
     v_reason not in ('purchase','renewal','cancellation','refund','chargeback','manual') or
     v_state not in ('active','revoked') or
     (v_reason in ('purchase','renewal') and v_state <> 'active') or
     (v_reason in ('refund','chargeback') and v_state <> 'revoked') or
     v_issued_at > v_occurred_at or v_issued_at > v_not_before or
     v_not_before > v_valid_until or v_valid_until > v_grace_until then
    raise exception using errcode = '22023', message = 'invalid normalized subscription fields';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('oak_manuscript_license:' || v_account_id, 0));

  select * into v_existing
  from public.oak_manuscript_subscription_events
  where provider_id = p_provider_id and provider_event_id = v_event_id
  for update;
  if found then
    if v_existing.event_fingerprint <> p_event_fingerprint then
      return jsonb_build_object(
        'schema_version','1.0','result_type','oak_manuscript_subscription_event_apply',
        'outcome','conflict','account_id',v_account_id,'provider_id',p_provider_id,
        'provider_event_id',v_event_id,'event_fingerprint',p_event_fingerprint,
        'entitlement_revision',null
      );
    end if;
    return jsonb_build_object(
      'schema_version','1.0','result_type','oak_manuscript_subscription_event_apply',
      'outcome',case when v_existing.apply_outcome = 'applied' then 'replayed' else 'stale' end,
      'account_id',v_existing.account_id,'provider_id',v_existing.provider_id,
      'provider_event_id',v_existing.provider_event_id,'event_fingerprint',v_existing.event_fingerprint,
      'entitlement_revision',v_existing.entitlement_revision
    );
  end if;

  select * into v_entitlement
  from public.oak_manuscript_entitlements
  where account_id = v_account_id
  for update;

  if found and v_entitlement.source_event_at is not null and v_occurred_at <= v_entitlement.source_event_at then
    insert into public.oak_manuscript_subscription_events (
      provider_id, provider_event_id, account_id, entitlement_id, event_reason, entitlement_state,
      occurred_at, issued_at, not_before, valid_until, grace_until, event_fingerprint,
      apply_outcome, entitlement_revision
    ) values (
      p_provider_id, v_event_id, v_account_id, v_entitlement_id, v_reason, v_state,
      v_occurred_at, v_issued_at, v_not_before, v_valid_until, v_grace_until, p_event_fingerprint,
      'stale', null
    );
    return jsonb_build_object(
      'schema_version','1.0','result_type','oak_manuscript_subscription_event_apply',
      'outcome','stale','account_id',v_account_id,'provider_id',p_provider_id,
      'provider_event_id',v_event_id,'event_fingerprint',p_event_fingerprint,
      'entitlement_revision',null
    );
  end if;

  insert into public.oak_manuscript_entitlements (
    account_id, entitlement_id, entitlement_state, issued_at, not_before, valid_until, grace_until,
    revision, updated_at, source_provider, source_event_id, source_event_at, source_event_fingerprint
  ) values (
    v_account_id, v_entitlement_id, v_state, v_issued_at, v_not_before, v_valid_until, v_grace_until,
    1, clock_timestamp(), p_provider_id, v_event_id, v_occurred_at, p_event_fingerprint
  )
  on conflict (account_id) do update set
    entitlement_id = excluded.entitlement_id,
    entitlement_state = excluded.entitlement_state,
    issued_at = excluded.issued_at,
    not_before = excluded.not_before,
    valid_until = excluded.valid_until,
    grace_until = excluded.grace_until,
    revision = public.oak_manuscript_entitlements.revision + 1,
    updated_at = clock_timestamp(),
    source_provider = excluded.source_provider,
    source_event_id = excluded.source_event_id,
    source_event_at = excluded.source_event_at,
    source_event_fingerprint = excluded.source_event_fingerprint
  returning revision into v_revision;

  insert into public.oak_manuscript_subscription_events (
    provider_id, provider_event_id, account_id, entitlement_id, event_reason, entitlement_state,
    occurred_at, issued_at, not_before, valid_until, grace_until, event_fingerprint,
    apply_outcome, entitlement_revision
  ) values (
    p_provider_id, v_event_id, v_account_id, v_entitlement_id, v_reason, v_state,
    v_occurred_at, v_issued_at, v_not_before, v_valid_until, v_grace_until, p_event_fingerprint,
    'applied', v_revision
  );

  return jsonb_build_object(
    'schema_version','1.0','result_type','oak_manuscript_subscription_event_apply',
    'outcome','applied','account_id',v_account_id,'provider_id',p_provider_id,
    'provider_event_id',v_event_id,'event_fingerprint',p_event_fingerprint,
    'entitlement_revision',v_revision
  );
end;
$$;

create or replace function public.oak_manuscript_license_account_overview(
  p_account_id text,
  p_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_entitlement public.oak_manuscript_entitlements%rowtype;
  v_has_entitlement boolean;
  v_devices jsonb;
  v_total integer;
begin
  if p_account_id is null or p_account_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' or
     p_limit not between 1 and 20 then
    raise exception using errcode = '22023', message = 'invalid bounded license account input';
  end if;
  select * into v_entitlement from public.oak_manuscript_entitlements where account_id = p_account_id;
  v_has_entitlement := found;
  select count(*) into v_total from public.oak_manuscript_devices where account_id = p_account_id;
  select coalesce(jsonb_agg(item order by state_order, last_seen_at desc, device_id), '[]'::jsonb)
  into v_devices
  from (
    select jsonb_build_object(
      'account_id',account_id,'device_id',device_id,'device_state',device_state,
      'first_seen_at',to_char(first_seen_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'last_seen_at',to_char(last_seen_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'revoked_at',case when revoked_at is null then null else to_char(revoked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
    ) as item,
    case when device_state = 'active' then 0 else 1 end as state_order,
    last_seen_at,
    device_id
    from public.oak_manuscript_devices
    where account_id = p_account_id
    order by state_order, last_seen_at desc, device_id
    limit p_limit
  ) bounded_devices;
  return jsonb_build_object(
    'schema_version','1.0','result_type','oak_manuscript_license_account_snapshot',
    'account_id',p_account_id,
    'entitlement',case when not v_has_entitlement then null else jsonb_build_object(
      'account_id',v_entitlement.account_id,'entitlement_id',v_entitlement.entitlement_id,
      'entitlement_state',v_entitlement.entitlement_state,
      'not_before',to_char(v_entitlement.not_before at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'valid_until',to_char(v_entitlement.valid_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'grace_until',to_char(v_entitlement.grace_until at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'revision',v_entitlement.revision
    ) end,
    'devices',v_devices,'total_devices',v_total
  );
end;
$$;

create or replace function public.oak_manuscript_license_revoke_device(
  p_account_id text,
  p_device_id text,
  p_now timestamptz
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_device public.oak_manuscript_devices%rowtype;
begin
  if p_account_id is null or p_account_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' or
     p_device_id is null or p_device_id !~ '^device-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or
     p_now is null then
    raise exception using errcode = '22023', message = 'invalid bounded device revoke input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('oak_manuscript_license:' || p_account_id, 0));
  select * into v_device from public.oak_manuscript_devices
  where account_id = p_account_id and device_id = p_device_id for update;
  if not found then return null; end if;
  if v_device.device_state = 'active' then
    update public.oak_manuscript_devices set
      device_state = 'revoked',
      revoked_at = greatest(first_seen_at, last_seen_at, p_now)
    where account_id = p_account_id and device_id = p_device_id
    returning * into v_device;
  end if;
  return jsonb_build_object(
    'account_id',v_device.account_id,'device_id',v_device.device_id,'device_state',v_device.device_state,
    'first_seen_at',to_char(v_device.first_seen_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'last_seen_at',to_char(v_device.last_seen_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'revoked_at',to_char(v_device.revoked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
end;
$$;

revoke all on function public.oak_manuscript_license_apply_subscription_event(text,jsonb,text,text)
  from public, anon, authenticated;
revoke all on function public.oak_manuscript_license_account_overview(text,integer)
  from public, anon, authenticated;
revoke all on function public.oak_manuscript_license_revoke_device(text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.oak_manuscript_license_apply_subscription_event(text,jsonb,text,text)
  to service_role;
grant execute on function public.oak_manuscript_license_account_overview(text,integer)
  to service_role;
grant execute on function public.oak_manuscript_license_revoke_device(text,text,timestamptz)
  to service_role;

commit;
