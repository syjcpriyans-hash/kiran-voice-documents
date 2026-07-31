create extension if not exists pgcrypto;

create table if not exists public.workbook_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  source_sheet text not null,
  row_count integer not null default 0,
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  is_current boolean not null default false,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists workbook_imports_one_current_idx
  on public.workbook_imports (is_current)
  where is_current = true;

create table if not exists public.imported_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.workbook_imports(id) on delete cascade,
  source_sheet text not null,
  source_row_number integer not null,
  row_data jsonb not null,
  search_text text not null default '',
  created_at timestamptz not null default now(),
  unique(import_id, source_sheet, source_row_number)
);

create index if not exists imported_rows_import_idx on public.imported_rows(import_id);

create table if not exists public.workbook_settings (
  singleton boolean primary key default true check (singleton = true),
  current_import_id uuid references public.workbook_imports(id) on delete set null,
  current_file_path text,
  source_sheet text,
  updated_at timestamptz not null default now()
);

insert into public.workbook_settings(singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.document_sequences (
  document_type text not null,
  financial_year text not null,
  prefix text not null,
  last_number bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (document_type, financial_year)
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  serial_number text not null unique,
  document_type text not null default 'approval_note',
  recipient_name text not null,
  recipient_type text not null check (recipient_type in ('Broker', 'Customer', 'Other')),
  through_name text not null default '',
  document_date date not null,
  total_carats numeric(14,2) not null,
  document_data jsonb not null,
  template_version text not null default 'approval-note-v1',
  status text not null default 'generated',
  excel_sync_status text not null default 'pending' check (excel_sync_status in ('pending', 'completed', 'failed')),
  excel_sync_error text,
  excel_synced_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists documents_created_at_idx on public.documents(created_at desc);

create table if not exists public.document_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  line_number integer not null check (line_number between 1 and 8),
  source_row_id uuid references public.imported_rows(id) on delete set null,
  source_serial_number text,
  size_snapshot text not null,
  description_snapshot text not null,
  carats numeric(14,2) not null,
  asking_price_snapshot numeric(16,2) not null,
  remarks text not null default '',
  created_at timestamptz not null default now(),
  unique(document_id, line_number)
);

create or replace function public.create_approval_note(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_existing public.documents%rowtype;
  v_doc_date date;
  v_year text;
  v_prefix text;
  v_last bigint;
  v_next bigint;
  v_serial text;
  v_document_id uuid;
  v_total numeric(14,2);
  v_item jsonb;
  v_index integer := 0;
begin
  v_request_id := (p_payload->>'requestId')::uuid;

  select * into v_existing
  from public.documents
  where request_id = v_request_id;

  if found then
    return jsonb_build_object(
      'id', v_existing.id,
      'serial_number', v_existing.serial_number,
      'total_carats', v_existing.total_carats,
      'excel_sync_status', v_existing.excel_sync_status,
      'is_new', false
    );
  end if;

  v_doc_date := (p_payload->>'documentDate')::date;
  v_year := case
    when extract(month from v_doc_date) >= 4 then
      to_char(v_doc_date, 'YYYY') || '-' || right(to_char(v_doc_date + interval '1 year', 'YYYY'), 2)
    else
      to_char(v_doc_date - interval '1 year', 'YYYY') || '-' || right(to_char(v_doc_date, 'YYYY'), 2)
  end;

  v_prefix := 'AN/' || right(split_part(v_year, '-', 1), 2) || '-' || split_part(v_year, '-', 2) || '/';

  insert into public.document_sequences(document_type, financial_year, prefix, last_number)
  values ('approval_note', v_year, v_prefix, 0)
  on conflict (document_type, financial_year) do nothing;

  select prefix, last_number
  into v_prefix, v_last
  from public.document_sequences
  where document_type = 'approval_note' and financial_year = v_year
  for update;

  v_next := v_last + 1;

  update public.document_sequences
  set last_number = v_next, updated_at = now()
  where document_type = 'approval_note' and financial_year = v_year;

  v_serial := v_prefix || lpad(v_next::text, 5, '0');

  select coalesce(sum((item->>'carats')::numeric), 0)
  into v_total
  from jsonb_array_elements(p_payload->'items') item;

  insert into public.documents(
    request_id,
    serial_number,
    recipient_name,
    recipient_type,
    through_name,
    document_date,
    total_carats,
    document_data,
    created_by
  )
  values (
    v_request_id,
    v_serial,
    p_payload->>'recipientName',
    p_payload->>'recipientType',
    coalesce(p_payload->>'through', ''),
    v_doc_date,
    v_total,
    p_payload,
    auth.uid()
  )
  returning id into v_document_id;

  for v_item in select value from jsonb_array_elements(p_payload->'items') loop
    v_index := v_index + 1;

    insert into public.document_items(
      document_id,
      line_number,
      source_row_id,
      source_serial_number,
      size_snapshot,
      description_snapshot,
      carats,
      asking_price_snapshot,
      remarks
    )
    values (
      v_document_id,
      v_index,
      nullif(v_item->>'sourceRowId', '')::uuid,
      nullif(v_item->>'sourceSerialNumber', ''),
      v_item->>'size',
      v_item->>'description',
      (v_item->>'carats')::numeric,
      (v_item->>'askingPrice')::numeric,
      coalesce(v_item->>'remarks', '')
    );
  end loop;

  return jsonb_build_object(
    'id', v_document_id,
    'serial_number', v_serial,
    'total_carats', v_total,
    'excel_sync_status', 'pending',
    'is_new', true
  );
end;
$$;

alter table public.workbook_imports enable row level security;
alter table public.imported_rows enable row level security;
alter table public.workbook_settings enable row level security;
alter table public.document_sequences enable row level security;
alter table public.documents enable row level security;
alter table public.document_items enable row level security;

revoke all on function public.create_approval_note(jsonb) from public, anon, authenticated;
grant execute on function public.create_approval_note(jsonb) to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'workbooks',
  'workbooks',
  false,
  20971520,
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
