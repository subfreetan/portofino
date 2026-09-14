-- ============================================================
-- Portofino — schéma Supabase
-- Points : 4 pts / € dépensé
-- Récompenses (codées en dur, front + back) :
--   Boisson = 100 pts | Pizza = 300 pts | Pâtes = 350 pts
-- Pas de wallet, pas de cartes cadeaux, pas de niveaux.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------
create table if not exists users (
  id               uuid primary key default gen_random_uuid(),
  first_name       text not null,
  username         text not null unique,
  password_hash    text not null,
  card_number      text not null unique,        -- identifiant encodé dans le QR (compte, écran "account")
  points_balance   int  not null default 0,      -- points dépensables actuellement
  lifetime_points  int  not null default 0,      -- total de points gagnés depuis toujours
  points_spent     int  not null default 0,      -- total de points dépensés en récompenses
  role             text not null default 'user' check (role in ('user', 'admin')),
  created_at       timestamptz not null default now()
);

create index if not exists idx_users_username    on users (username);
create index if not exists idx_users_card_number on users (card_number);

-- ---------------------------------------------------------------
-- ORDERS
-- ---------------------------------------------------------------
create table if not exists orders (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references users(id) on delete cascade,
  items                  jsonb not null,          -- [{ name, detail, qty, unit_price }, ...]
  total                  numeric(10,2) not null,  -- 0.00 si commande payée en récompense
  status                 text not null default 'pending'
                           check (status in ('pending','confirmed','preparing','ready','collected')),
  payment_method         text not null check (payment_method in ('card','reward')),
  pickup_code            text not null,           -- code donné au comptoir (commande normale ou récompense)
  points_earned          int  not null default 0, -- crédités seulement quand payment_method = 'card' et paiement confirmé
  is_reward              boolean not null default false,
  reward_type            text check (reward_type in ('boisson','pizza','pates')),
  stripe_payment_intent  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists idx_orders_user_id     on orders (user_id);
create index if not exists idx_orders_status      on orders (status);
create index if not exists idx_orders_pickup_code on orders (pickup_code);

-- ---------------------------------------------------------------
-- trigger updated_at
-- ---------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_orders_updated_at on orders;
create trigger trg_orders_updated_at
  before update on orders
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------
-- - Pas de tables events/notifications : les offres de l'accueil
--   restent codées en dur côté front (décision prise le 14/09/2026).
-- - Pas de eur_balance, free_coffee, card_visual, ni de route
--   pay-with-wallet : tout le volet wallet du café est supprimé.
