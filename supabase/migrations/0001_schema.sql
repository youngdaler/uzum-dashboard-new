-- ============================================================================
-- Uzum Business Dashboard — схема базы данных (Supabase / PostgreSQL)
--
-- Правила хранения денег:
--   * суммы в UZS            → numeric(20,2)  (округление half-up до 2 знаков)
--   * суммы в валюте операции → numeric(20,4)
--   * курсы валют            → numeric(18,6)
--   * float / double / money НЕ используются.
-- Каждая таблица с бизнес-данными содержит user_id и защищена RLS:
-- пользователь видит и меняет только свои строки.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Общие функции
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text not null default '',
  business_name   text not null default '',
  base_currency   text not null default 'UZS' check (base_currency = 'UZS'),
  language        text not null default 'ru' check (language in ('ru','uz')),
  cost_method     text not null default 'wac' check (cost_method in ('fifo','wac')),
  tax_mode        text not null default 'estimate' check (tax_mode in ('estimate','actual')),
  tax_rate_pct    numeric(7,4) not null default 0 check (tax_rate_pct >= 0 and tax_rate_pct <= 100),
  tax_base        text not null default 'revenue' check (tax_base in ('revenue','profit')),
  default_min_stock integer not null default 5 check (default_min_stock >= 0),
  export_format   text not null default 'csv' check (export_format in ('csv','xlsx')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- Профиль создаётся автоматически при регистрации.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- categories (категории товаров и расходов)
--   cost_type: 'landed'    — расход входит в себестоимость партии
--              'operating' — операционный расход периода
-- ---------------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind        text not null check (kind in ('product','expense')),
  code        text,
  name        text not null check (length(trim(name)) > 0),
  cost_type   text check (cost_type in ('landed','operating')),
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint categories_cost_type_chk check (
    (kind = 'expense' and cost_type is not null) or (kind = 'product' and cost_type is null)
  ),
  unique (user_id, kind, name)
);
create index categories_user_idx on public.categories(user_id, kind);
create trigger trg_categories_updated before update on public.categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- suppliers
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name        text not null check (length(trim(name)) > 0),
  contact     text,
  url         text,
  notes       text,
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index suppliers_user_idx on public.suppliers(user_id);
create trigger trg_suppliers_updated before update on public.suppliers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- products
--   Остаток, количество продаж и текущая себестоимость НЕ хранятся в этой
--   таблице: они выводятся из inventory_movements и партий (единый источник).
-- ---------------------------------------------------------------------------
create table public.products (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name                  text not null check (length(trim(name)) > 0),
  sku                   text not null check (length(trim(sku)) > 0),
  barcode               text,
  category_id           uuid references public.categories(id) on delete set null,
  photo_url             text,
  source_url            text,
  supplier_id           uuid references public.suppliers(id) on delete set null,
  purchase_price_cny    numeric(20,4) not null default 0 check (purchase_price_cny >= 0),
  recommended_price_uzs numeric(20,2) not null default 0 check (recommended_price_uzs >= 0),
  sale_price_uzs        numeric(20,2) not null default 0 check (sale_price_uzs >= 0),
  commission_pct        numeric(7,4) check (commission_pct is null or (commission_pct >= 0 and commission_pct <= 100)),
  packaging_cost_uzs    numeric(20,2) not null default 0 check (packaging_cost_uzs >= 0),
  extra_cost_uzs        numeric(20,2) not null default 0 check (extra_cost_uzs >= 0),
  weight_kg             numeric(12,4) not null default 0 check (weight_kg >= 0),
  volume_m3             numeric(12,6) not null default 0 check (volume_m3 >= 0),
  min_stock             integer not null default 0 check (min_stock >= 0),
  expected_monthly_sales integer check (expected_monthly_sales is null or expected_monthly_sales >= 0),
  status                text not null default 'active' check (status in ('active','archived')),
  is_demo               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, sku)
);
create index products_user_idx on public.products(user_id, status);
create index products_category_idx on public.products(category_id);
create index products_supplier_idx on public.products(supplier_id);
create trigger trg_products_updated before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- purchase_batches
-- ---------------------------------------------------------------------------
create table public.purchase_batches (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade default auth.uid(),
  batch_no            text not null check (length(trim(batch_no)) > 0),
  order_date          date not null default current_date,
  received_date       date,
  supplier_id         uuid references public.suppliers(id) on delete set null,
  order_url           text,
  status              text not null default 'ordered' check (status in
                        ('ordered','paid','shipped','in_transit','customs','received','selling','closed')),
  cny_rate            numeric(18,6) not null check (cny_rate > 0),
  prepayment_cny      numeric(20,4) not null default 0 check (prepayment_cny >= 0),
  allocation_method   text not null default 'quantity' check (allocation_method in ('quantity','value','weight','volume')),
  actual_weight_kg    numeric(14,4) not null default 0 check (actual_weight_kg >= 0),
  volume_m3           numeric(14,6) not null default 0 check (volume_m3 >= 0),
  cargo_tariff_kg     numeric(20,4) not null default 0 check (cargo_tariff_kg >= 0),
  cargo_tariff_m3     numeric(20,4) not null default 0 check (cargo_tariff_m3 >= 0),
  cargo_currency      text not null default 'USD' check (cargo_currency in ('CNY','USD','UZS')),
  notes               text,
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, batch_no)
);
create index purchase_batches_user_idx on public.purchase_batches(user_id, status);
create index purchase_batches_supplier_idx on public.purchase_batches(supplier_id);
create trigger trg_batches_updated before update on public.purchase_batches
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- purchase_batch_items  (несколько товаров в партии; несколько партий товара)
-- ---------------------------------------------------------------------------
create table public.purchase_batch_items (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade default auth.uid(),
  batch_id                uuid not null references public.purchase_batches(id) on delete cascade,
  product_id              uuid not null references public.products(id) on delete restrict,
  qty_ordered             integer not null check (qty_ordered > 0),
  qty_received            integer not null default 0 check (qty_received >= 0),
  qty_defective           integer not null default 0 check (qty_defective >= 0),
  unit_price_cny          numeric(20,4) not null check (unit_price_cny >= 0),
  unit_weight_kg          numeric(12,4) not null default 0 check (unit_weight_kg >= 0),
  unit_volume_m3          numeric(12,6) not null default 0 check (unit_volume_m3 >= 0),
  planned_sale_price_uzs  numeric(20,2) not null default 0 check (planned_sale_price_uzs >= 0),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint batch_items_defect_chk check (qty_defective <= qty_received),
  unique (batch_id, product_id)
);
create index batch_items_batch_idx on public.purchase_batch_items(batch_id);
create index batch_items_product_idx on public.purchase_batch_items(product_id);
create index batch_items_user_idx on public.purchase_batch_items(user_id);
create trigger trg_batch_items_updated before update on public.purchase_batch_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- expenses (журнал расходов)
--   scope: 'batch'     — на всю партию (batch_id задан, batch_item_id null)
--          'item'      — на товар в партии (batch_item_id задан)
--          'operating' — операционный расход периода (batch_id null)
--   Сумма хранится в исходной валюте + курс + итог в UZS.
-- ---------------------------------------------------------------------------
create table public.expenses (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade default auth.uid(),
  expense_date      date not null default current_date,
  category_id       uuid not null references public.categories(id) on delete restrict,
  amount            numeric(20,4) not null check (amount >= 0),
  currency          text not null check (currency in ('UZS','CNY','USD')),
  rate_to_uzs       numeric(18,6) not null check (rate_to_uzs > 0),
  amount_uzs        numeric(20,2) not null check (amount_uzs >= 0),
  scope             text not null default 'operating' check (scope in ('batch','item','operating')),
  batch_id          uuid references public.purchase_batches(id) on delete cascade,
  batch_item_id     uuid references public.purchase_batch_items(id) on delete cascade,
  allocation_method text check (allocation_method in ('quantity','value','weight','volume')),
  payment_method    text not null default 'cash' check (payment_method in ('cash','card','transfer','other')),
  payment_status    text not null default 'paid' check (payment_status in ('paid','pending')),
  due_date          date,
  comment           text,
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint expenses_scope_chk check (
    (scope = 'operating' and batch_id is null and batch_item_id is null) or
    (scope = 'batch'     and batch_id is not null and batch_item_id is null) or
    (scope = 'item'      and batch_id is not null and batch_item_id is not null)
  ),
  constraint expenses_uzs_currency_chk check (currency <> 'UZS' or rate_to_uzs = 1)
);
create index expenses_user_date_idx on public.expenses(user_id, expense_date);
create index expenses_batch_idx on public.expenses(batch_id);
create index expenses_item_idx on public.expenses(batch_item_id);
create index expenses_category_idx on public.expenses(category_id);
create trigger trg_expenses_updated before update on public.expenses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- expense_allocations — распределение расхода партии по позициям.
--   Производная таблица: пересчитывается приложением при любом изменении
--   расходов/позиций партии; сумма по расходу всегда равна expenses.amount_uzs
--   (остаток округления отдаётся методом наибольшего остатка), поэтому
--   двойной учёт невозможен.
-- ---------------------------------------------------------------------------
create table public.expense_allocations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade default auth.uid(),
  expense_id     uuid not null references public.expenses(id) on delete cascade,
  batch_item_id  uuid not null references public.purchase_batch_items(id) on delete cascade,
  amount_uzs     numeric(20,2) not null check (amount_uzs >= 0),
  created_at     timestamptz not null default now(),
  unique (expense_id, batch_item_id)
);
create index expense_alloc_expense_idx on public.expense_allocations(expense_id);
create index expense_alloc_item_idx on public.expense_allocations(batch_item_id);
create index expense_alloc_user_idx on public.expense_allocations(user_id);

-- ---------------------------------------------------------------------------
-- sales / sale_items
--   status: in_progress — заказ в работе (резерв, не выручка)
--           completed   — признанная продажа
--           cancelled   — отменён (не продажа, склад не меняется)
-- ---------------------------------------------------------------------------
create table public.sales (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade default auth.uid(),
  order_no              text not null check (length(trim(order_no)) > 0),
  sale_date             date not null default current_date,
  status                text not null default 'completed' check (status in ('in_progress','completed','cancelled')),
  payout_actual_uzs     numeric(20,2) check (payout_actual_uzs is null or payout_actual_uzs >= 0),
  payout_received_date  date,
  notes                 text,
  is_demo               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, order_no)
);
create index sales_user_date_idx on public.sales(user_id, sale_date);
create index sales_status_idx on public.sales(user_id, status);
create trigger trg_sales_updated before update on public.sales
  for each row execute function public.set_updated_at();

create table public.sale_items (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade default auth.uid(),
  sale_id               uuid not null references public.sales(id) on delete cascade,
  product_id            uuid not null references public.products(id) on delete restrict,
  qty                   integer not null check (qty > 0),
  unit_price_uzs        numeric(20,2) not null check (unit_price_uzs >= 0),
  seller_discount_uzs   numeric(20,2) not null default 0 check (seller_discount_uzs >= 0),   -- на всю строку
  commission_uzs        numeric(20,2) not null default 0 check (commission_uzs >= 0),        -- на всю строку
  commission_pct        numeric(7,4),                                                         -- справочно: % на момент продажи
  logistics_uzs         numeric(20,2) not null default 0 check (logistics_uzs >= 0),
  ads_uzs               numeric(20,2) not null default 0 check (ads_uzs >= 0),
  other_deductions_uzs  numeric(20,2) not null default 0 check (other_deductions_uzs >= 0),
  packaging_uzs         numeric(20,2) not null default 0 check (packaging_uzs >= 0),
  extra_cost_uzs        numeric(20,2) not null default 0 check (extra_cost_uzs >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint sale_items_discount_chk check (seller_discount_uzs <= unit_price_uzs * qty)
);
create index sale_items_sale_idx on public.sale_items(sale_id);
create index sale_items_product_idx on public.sale_items(product_id);
create index sale_items_user_idx on public.sale_items(user_id);
create trigger trg_sale_items_updated before update on public.sale_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- inventory_movements — журнал изменения остатков (источник истины по остаткам)
--   qty со знаком: приход > 0, расход < 0.
--   receipt  — приход партии (годные единицы), batch_id обязателен
--   opening  — начальный остаток (unit_cost_uzs обязателен)
--   sale     — продажа (создаётся при статусе completed)
--   return   — возврат на склад
--   writeoff / defect — списание / брак (убыток)
--   adjustment — ручная корректировка (инвентаризация)
-- ---------------------------------------------------------------------------
create table public.inventory_movements (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade default auth.uid(),
  product_id     uuid not null references public.products(id) on delete restrict,
  batch_id       uuid references public.purchase_batches(id) on delete cascade,
  batch_item_id  uuid references public.purchase_batch_items(id) on delete cascade,
  sale_item_id   uuid references public.sale_items(id) on delete cascade,
  return_id      uuid,
  movement_date  date not null default current_date,
  type           text not null check (type in ('opening','receipt','sale','return','writeoff','defect','adjustment')),
  qty            integer not null check (qty <> 0),
  unit_cost_uzs  numeric(20,4) check (unit_cost_uzs is null or unit_cost_uzs >= 0),
  note           text,
  created_at     timestamptz not null default now(),
  constraint movements_sign_chk check (
    (type in ('opening','receipt','return') and qty > 0) or
    (type in ('sale','writeoff','defect') and qty < 0) or
    (type = 'adjustment')
  ),
  constraint movements_receipt_chk check (type <> 'receipt' or batch_item_id is not null),
  constraint movements_opening_chk check (type <> 'opening' or unit_cost_uzs is not null),
  constraint movements_sale_chk check (type <> 'sale' or sale_item_id is not null)
);
create index movements_user_product_idx on public.inventory_movements(user_id, product_id, movement_date);
create index movements_batch_idx on public.inventory_movements(batch_id);
create index movements_sale_item_idx on public.inventory_movements(sale_item_id);
create unique index movements_one_receipt_per_item on public.inventory_movements(batch_item_id) where type = 'receipt';
create unique index movements_one_sale_per_item on public.inventory_movements(sale_item_id) where type = 'sale';

-- ---------------------------------------------------------------------------
-- returns — возвраты, повреждения, компенсации (по строке продажи)
-- ---------------------------------------------------------------------------
create table public.returns (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade default auth.uid(),
  sale_item_id             uuid not null references public.sale_items(id) on delete cascade,
  return_date              date not null default current_date,
  kind                     text not null default 'return' check (kind in ('return','damaged')),
  qty                      integer not null check (qty > 0),
  restock                  boolean not null default true,
  refund_uzs               numeric(20,2) not null default 0 check (refund_uzs >= 0),             -- реверс выручки
  commission_refund_uzs    numeric(20,2) not null default 0 check (commission_refund_uzs >= 0),  -- возврат комиссии
  return_logistics_uzs     numeric(20,2) not null default 0 check (return_logistics_uzs >= 0),   -- расход на обратную логистику
  compensation_uzs         numeric(20,2) not null default 0 check (compensation_uzs >= 0),       -- компенсация от маркетплейса
  note                     text,
  created_at               timestamptz not null default now(),
  constraint returns_restock_chk check (kind <> 'damaged' or restock = false)
);
create index returns_sale_item_idx on public.returns(sale_item_id);
create index returns_user_idx on public.returns(user_id, return_date);
alter table public.inventory_movements
  add constraint movements_return_fk foreign key (return_id) references public.returns(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- exchange_rates — история курсов (ручное обновление)
-- ---------------------------------------------------------------------------
create table public.exchange_rates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  rate_date   date not null default current_date,
  pair        text not null check (pair in ('CNY_UZS','USD_UZS')),
  rate        numeric(18,6) not null check (rate > 0),
  created_at  timestamptz not null default now(),
  unique (user_id, pair, rate_date)
);
create index exchange_rates_user_idx on public.exchange_rates(user_id, pair, rate_date desc);

-- ---------------------------------------------------------------------------
-- marketplace_fee_settings — тарифы Uzum с историей изменений.
--   Значения вводятся вручную; в приложении нет «официальных» тарифов.
--   Действующий тариф на дату = последняя запись с effective_from <= дата
--   (для категории; если нет — общая запись с category_id is null).
-- ---------------------------------------------------------------------------
create table public.marketplace_fee_settings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade default auth.uid(),
  category_id      uuid references public.categories(id) on delete cascade,
  effective_from   date not null default current_date,
  commission_pct   numeric(7,4) not null default 0 check (commission_pct >= 0 and commission_pct <= 100),
  logistics_fee_uzs numeric(20,2) not null default 0 check (logistics_fee_uzs >= 0),   -- на единицу
  processing_fee_uzs numeric(20,2) not null default 0 check (processing_fee_uzs >= 0), -- на единицу
  other_pct        numeric(7,4) not null default 0 check (other_pct >= 0 and other_pct <= 100),
  note             text,
  created_at       timestamptz not null default now()
);
create index fee_settings_user_idx on public.marketplace_fee_settings(user_id, category_id, effective_from desc);

-- ---------------------------------------------------------------------------
-- payments — платежи (денежный поток, дебиторская/кредиторская задолженность)
--   kind: supplier  — платёж поставщику за товар (доплата сверх предоплаты)
--         owner_in  — вложение собственных средств
--         owner_out — вывод средств владельцем
--   status 'scheduled' + due_date — напоминание о предстоящем платеже
--   (не увеличивает задолженность: она считается как стоимость товара минус оплаченное).
--   Выплаты Uzum отслеживаются в sales.payout_*; расходы и налоги — в expenses.
-- ---------------------------------------------------------------------------
create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade default auth.uid(),
  kind          text not null check (kind in ('supplier','owner_in','owner_out')),
  payment_date  date not null default current_date,
  due_date      date,
  status        text not null default 'paid' check (status in ('paid','scheduled')),
  batch_id      uuid references public.purchase_batches(id) on delete cascade,
  amount        numeric(20,4) not null check (amount > 0),
  currency      text not null check (currency in ('UZS','CNY','USD')),
  rate_to_uzs   numeric(18,6) not null check (rate_to_uzs > 0),
  amount_uzs    numeric(20,2) not null check (amount_uzs > 0),
  note          text,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint payments_supplier_batch_chk check (kind <> 'supplier' or batch_id is not null)
);
create index payments_user_date_idx on public.payments(user_id, payment_date);
create index payments_batch_idx on public.payments(batch_id);

-- ---------------------------------------------------------------------------
-- product_evaluations — оценка товаров перед закупкой (инструмент сравнения)
-- ---------------------------------------------------------------------------
create table public.product_evaluations (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name                  text not null check (length(trim(name)) > 0),
  supplier_price_cny    numeric(20,4) not null check (supplier_price_cny >= 0),
  moq                   integer not null check (moq > 0),
  cny_rate              numeric(18,6) not null check (cny_rate > 0),
  unit_weight_kg        numeric(12,4) not null default 0 check (unit_weight_kg >= 0),
  delivery_per_unit_uzs numeric(20,2) not null default 0 check (delivery_per_unit_uzs >= 0),
  sale_price_uzs        numeric(20,2) not null check (sale_price_uzs >= 0),
  commission_pct        numeric(7,4) not null default 0 check (commission_pct >= 0 and commission_pct <= 100),
  selling_costs_per_unit_uzs numeric(20,2) not null default 0 check (selling_costs_per_unit_uzs >= 0),
  monthly_sales         integer check (monthly_sales is null or monthly_sales >= 0),
  defect_return_pct     numeric(7,4) not null default 0 check (defect_return_pct >= 0 and defect_return_pct < 100),
  budget_uzs            numeric(20,2) check (budget_uzs is null or budget_uzs >= 0),
  notes                 text,
  is_demo               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index evaluations_user_idx on public.product_evaluations(user_id);
create trigger trg_evaluations_updated before update on public.product_evaluations
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- Row Level Security: пользователь видит только собственные данные
-- ===========================================================================
alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select using (id = auth.uid());
create policy profiles_insert on public.profiles for insert with check (id = auth.uid());
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'categories','suppliers','products','purchase_batches','purchase_batch_items',
    'expenses','expense_allocations','sales','sale_items','inventory_movements',
    'returns','exchange_rates','marketplace_fee_settings','payments','product_evaluations'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (user_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (user_id = auth.uid())', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_update', t);
    execute format('create policy %I on public.%I for delete using (user_id = auth.uid())', t || '_delete', t);
  end loop;
end $$;

-- Дополнительная защита: ссылки между строками не могут указывать на чужие данные.
create or replace function public.assert_same_owner()
returns trigger language plpgsql as $$
declare
  parent_owner uuid;
begin
  if tg_table_name = 'purchase_batch_items' then
    select user_id into parent_owner from public.purchase_batches where id = new.batch_id;
    if parent_owner is distinct from new.user_id then raise exception 'batch belongs to another user'; end if;
    select user_id into parent_owner from public.products where id = new.product_id;
    if parent_owner is distinct from new.user_id then raise exception 'product belongs to another user'; end if;
  elsif tg_table_name = 'sale_items' then
    select user_id into parent_owner from public.sales where id = new.sale_id;
    if parent_owner is distinct from new.user_id then raise exception 'sale belongs to another user'; end if;
    select user_id into parent_owner from public.products where id = new.product_id;
    if parent_owner is distinct from new.user_id then raise exception 'product belongs to another user'; end if;
  elsif tg_table_name = 'expenses' then
    if new.batch_id is not null then
      select user_id into parent_owner from public.purchase_batches where id = new.batch_id;
      if parent_owner is distinct from new.user_id then raise exception 'batch belongs to another user'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_owner_batch_items before insert or update on public.purchase_batch_items
  for each row execute function public.assert_same_owner();
create trigger trg_owner_sale_items before insert or update on public.sale_items
  for each row execute function public.assert_same_owner();
create trigger trg_owner_expenses before insert or update on public.expenses
  for each row execute function public.assert_same_owner();
