-- Oak Manuscript server-only subscription entitlement and device state.
-- No manuscript, filename, path, result record, AI data, token, payment secret,
-- or signing private key belongs in these tables.

begin;

create table if not exists public.oak_manuscript_entitlements (
  account_id      text primary key,
  entitlement_id text not null unique,
  entitlement_state text not null default 'active',
  issued_at       timestamptz not null,
  not_before      timestamptz not null,
  valid_until     timestamptz not null,
  grace_until     timestamptz not null,
  revision        bigint not null default 1,
  updated_at      timestamptz not null default clock_timestamp(),

  constraint oak_license_account_ck check (
    char_length(account_id) between 1 and 128 and
    account_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
  ),
  constraint oak_license_entitlement_id_ck check (
    entitlement_id ~ '^ent-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint oak_license_entitlement_state_ck check (entitlement_state in ('active','revoked')),
  constraint oak_license_time_order_ck check (
    issued_at <= not_before and not_before <= valid_until and valid_until <= grace_until
  ),
  constraint oak_license_revision_ck check (revision >= 1)
);

create table if not exists public.oak_manuscript_devices (
  account_id text not null references public.oak_manuscript_entitlements(account_id) on delete cascade,
  device_id  text not null,
  device_state text not null default 'active',
  first_seen_at timestamptz not null,
  last_seen_at  timestamptz not null,
  revoked_at    timestamptz,
  primary key (account_id, device_id),

  constraint oak_license_device_id_ck check (
    device_id ~ '^device-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint oak_license_device_state_ck check (device_state in ('active','revoked')),
  constraint oak_license_device_time_ck check (
    first_seen_at <= last_seen_at and
    ((device_state = 'active' and revoked_at is null) or
     (device_state = 'revoked' and revoked_at is not null and first_seen_at <= revoked_at))
  )
);

create index if not exists oak_manuscript_devices_account_state_idx
  on public.oak_manuscript_devices (account_id, device_state, first_seen_at);

alter table public.oak_manuscript_entitlements enable row level security;
alter table public.oak_manuscript_entitlements force row level security;
alter table public.oak_manuscript_devices enable row level security;
alter table public.oak_manuscript_devices force row level security;

revoke all on table public.oak_manuscript_entitlements from public, anon, authenticated;
revoke all on table public.oak_manuscript_devices from public, anon, authenticated;

create or replace function public.oak_manuscript_license_authorize_device(
  p_account_id text,
  p_device_id text,
  p_now timestamptz,
  p_max_devices integer
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_entitlement public.oak_manuscript_entitlements%rowtype;
  v_device public.oak_manuscript_devices%rowtype;
  v_effective_device_state text;
begin
  if p_account_id is null or p_account_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' or
     p_device_id is null or p_device_id !~ '^device-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or
     p_now is null or p_max_devices not between 1 and 20 then
    raise exception using errcode = '22023', message = 'invalid bounded license authorization input';
  end if;

  -- One account lock makes entitlement read, capacity check, and first device
  -- registration atomic across concurrent server instances.
  perform pg_advisory_xact_lock(hashtextextended('oak_manuscript_license:' || p_account_id, 0));

  select * into v_entitlement
  from public.oak_manuscript_entitlements
  where account_id = p_account_id
  for update;

  if not found then
    return jsonb_build_object(
      'schema_version', '1.0',
      'result_type', 'oak_manuscript_device_authorization',
      'outcome', 'no_entitlement',
      'authorization', null
    );
  end if;

  select * into v_device
  from public.oak_manuscript_devices
  where account_id = p_account_id and device_id = p_device_id
  for update;

  if not found then
    -- Expired or account-revoked entitlements are still signed for an already
    -- known device, but never register a new device after access has ended.
    if v_entitlement.entitlement_state = 'revoked' or v_entitlement.grace_until < p_now then
      return jsonb_build_object(
        'schema_version', '1.0',
        'result_type', 'oak_manuscript_device_authorization',
        'outcome', 'no_entitlement',
        'authorization', null
      );
    end if;
    if (select count(*) from public.oak_manuscript_devices
        where account_id = p_account_id and device_state = 'active') >= p_max_devices then
      return jsonb_build_object(
        'schema_version', '1.0',
        'result_type', 'oak_manuscript_device_authorization',
        'outcome', 'device_limit',
        'authorization', null
      );
    end if;
    insert into public.oak_manuscript_devices (
      account_id, device_id, device_state, first_seen_at, last_seen_at, revoked_at
    ) values (
      p_account_id, p_device_id, 'active', p_now, p_now, null
    ) returning * into v_device;
  else
    update public.oak_manuscript_devices
    set last_seen_at = greatest(last_seen_at, p_now)
    where account_id = p_account_id and device_id = p_device_id
    returning * into v_device;
  end if;

  v_effective_device_state := case
    when v_entitlement.entitlement_state = 'revoked' or v_device.device_state = 'revoked' then 'revoked'
    else 'active'
  end;

  return jsonb_build_object(
    'schema_version', '1.0',
    'result_type', 'oak_manuscript_device_authorization',
    'outcome', 'authorized',
    'authorization', jsonb_build_object(
      'account_id', v_entitlement.account_id,
      'entitlement_id', v_entitlement.entitlement_id,
      'device_id', p_device_id,
      'device_state', v_effective_device_state,
      'issued_at', to_char(v_entitlement.issued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'not_before', to_char(v_entitlement.not_before at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'valid_until', to_char(v_entitlement.valid_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'grace_until', to_char(v_entitlement.grace_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    )
  );
end;
$$;

revoke all on function public.oak_manuscript_license_authorize_device(text,text,timestamptz,integer)
  from public, anon, authenticated;
grant execute on function public.oak_manuscript_license_authorize_device(text,text,timestamptz,integer)
  to service_role;

commit;
