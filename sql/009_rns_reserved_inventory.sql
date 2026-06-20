do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'notification_subscriptions_scope_check'
      and conrelid = 'stage0_rns.notification_subscriptions'::regclass
  ) then
    alter table stage0_rns.notification_subscriptions
      drop constraint notification_subscriptions_scope_check;
  end if;
end $$;

alter table stage0_rns.notification_subscriptions
  add constraint notification_subscriptions_scope_check
  check (scope in ('marketplace_seller', 'marketplace_bidder', 'marketplace_watcher'));

create table if not exists stage0_rns.reserved_names (
  id bigserial primary key,
  chain_id integer not null,
  label text not null,
  fqdn text not null,
  category text not null,
  enabled boolean not null default false,
  sale_mode text not null default 'auction' check (sale_mode in ('auction', 'buy_now')),
  reserve_price_wei numeric,
  fixed_price_wei numeric,
  notes text,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_stage0_rns_reserved_names_chain_label
  on stage0_rns.reserved_names (chain_id, lower(label));

with seed(label, category, display_order) as (
  values
    ('ai', 'two_char_highlights', 10),
    ('gm', 'two_char_highlights', 11),
    ('gn', 'two_char_highlights', 12),
    ('l2', 'two_char_highlights', 13),

    ('nft', 'ultra_premium', 100),
    ('defi', 'ultra_premium', 101),
    ('dex', 'ultra_premium', 102),
    ('perp', 'ultra_premium', 103),
    ('rwa', 'ultra_premium', 104),
    ('mev', 'ultra_premium', 105),
    ('gas', 'ultra_premium', 106),
    ('node', 'ultra_premium', 107),
    ('bot', 'ultra_premium', 108),
    ('chain', 'ultra_premium', 109),
    ('app', 'ultra_premium', 110),
    ('pay', 'ultra_premium', 111),
    ('wallet', 'ultra_premium', 112),
    ('trade', 'ultra_premium', 113),
    ('swap', 'ultra_premium', 114),
    ('stake', 'ultra_premium', 115),
    ('bridge', 'ultra_premium', 116),
    ('mint', 'ultra_premium', 117),
    ('claim', 'ultra_premium', 118),
    ('launch', 'ultra_premium', 119),
    ('meme', 'ultra_premium', 120),
    ('alpha', 'ultra_premium', 121),
    ('degen', 'ultra_premium', 122),
    ('whale', 'ultra_premium', 123),
    ('ape', 'ultra_premium', 124),
    ('moon', 'ultra_premium', 125),
    ('pump', 'ultra_premium', 126),
    ('fud', 'ultra_premium', 127),
    ('fomo', 'ultra_premium', 128),
    ('wagmi', 'ultra_premium', 129),
    ('ngmi', 'ultra_premium', 130),
    ('anon', 'ultra_premium', 131),

    ('agent', 'ai_agentic', 200),
    ('agents', 'ai_agentic', 201),
    ('terminal', 'ai_agentic', 202),
    ('compute', 'ai_agentic', 203),
    ('model', 'ai_agentic', 204),
    ('prompt', 'ai_agentic', 205),
    ('aiagent', 'ai_agentic', 206),
    ('assistant', 'ai_agentic', 207),
    ('intent', 'ai_agentic', 208),

    ('stage0', 'stage0_reserved', 300),
    ('stage', 'stage0_reserved', 301),
    ('s0', 'stage0_reserved', 302),
    ('stagezero', 'stage0_reserved', 303),
    ('risepunk', 'stage0_reserved', 304),
    ('punk', 'stage0_reserved', 305),
    ('launchpad', 'stage0_reserved', 306),

    ('infra', 'infra_terms', 400),
    ('liquidity', 'infra_terms', 401),
    ('router', 'infra_terms', 402),
    ('oracle', 'infra_terms', 403),
    ('validator', 'infra_terms', 404),
    ('rollup', 'infra_terms', 405),
    ('sequencer', 'infra_terms', 406),
    ('block', 'infra_terms', 407),
    ('blocks', 'infra_terms', 408),
    ('chainlink', 'infra_terms', 409),
    ('evm', 'infra_terms', 410),

    ('sigma', 'social', 500),
    ('cult', 'social', 501),
    ('tribe', 'social', 502),
    ('king', 'social', 503),
    ('queen', 'social', 504),
    ('ghost', 'social', 505),
    ('pepe', 'social', 506),
    ('wojak', 'social', 507),
    ('giga', 'social', 508),
    ('chad', 'social', 509),
    ('aura', 'social', 510),
    ('doge', 'social', 511),
    ('farmer', 'social', 512),
    ('sniper', 'social', 513),
    ('kek', 'social', 514),
    ('lol', 'social', 515),
    ('lmao', 'social', 516),
    ('hopium', 'social', 517),

    ('money', 'finance', 600),
    ('bank', 'finance', 601),
    ('usd', 'finance', 602),
    ('usdc', 'finance', 603),
    ('yield', 'finance', 604),
    ('earn', 'finance', 605),
    ('farm', 'finance', 606),
    ('vault', 'finance', 607),
    ('reserve', 'finance', 608),
    ('treasury', 'finance', 609),

    ('sam', 'core_team', 700),
    ('drdent', 'core_team', 701),
    ('sashaaa', 'core_team', 702),
    ('apoorv', 'core_team', 703),
    ('hai', 'core_team', 704),
    ('thaiji', 'core_team', 705),
    ('rich', 'core_team', 706),
    ('thanh', 'core_team', 707),

    ('risex', 'projects', 800),
    ('icarus', 'projects', 801),
    ('ftk', 'projects', 802),
    ('helios', 'projects', 803),
    ('attention', 'projects', 804),
    ('risechain', 'projects', 805),
    ('rise', 'projects', 806),
    ('admin', 'ops', 807),
    ('support', 'ops', 808),
    ('team', 'ops', 809),
    ('official', 'ops', 810),
    ('foundation', 'ops', 811),

    ('111', 'numerics', 900),
    ('222', 'numerics', 901),
    ('333', 'numerics', 902),
    ('444', 'numerics', 903),
    ('555', 'numerics', 904),
    ('666', 'numerics', 905),
    ('777', 'numerics', 906),
    ('888', 'numerics', 907),
    ('999', 'numerics', 908),
    ('1234', 'numerics', 909),
    ('420', 'numerics', 910),
    ('404', 'numerics', 911),

    ('btc', 'crypto_tickers', 1000),
    ('eth', 'crypto_tickers', 1001),
    ('sol', 'crypto_tickers', 1002),
    ('arb', 'crypto_tickers', 1003),
    ('near', 'crypto_tickers', 1004),
    ('hype', 'crypto_tickers', 1005),
    ('bnb', 'crypto_tickers', 1006),
    ('op', 'crypto_tickers', 1007),
    ('xrp', 'crypto_tickers', 1008),
    ('zec', 'crypto_tickers', 1009),
    ('xmr', 'crypto_tickers', 1010),
    ('ada', 'crypto_tickers', 1011),
    ('dia', 'crypto_tickers', 1012),
    ('sui', 'crypto_tickers', 1013),
    ('avax', 'crypto_tickers', 1014),
    ('pengu', 'crypto_tickers', 1015),
    ('bonk', 'crypto_tickers', 1016),
    ('mon', 'crypto_tickers', 1017),
    ('shib', 'crypto_tickers', 1018),
    ('floki', 'crypto_tickers', 1019),
    ('wif', 'crypto_tickers', 1020),
    ('trump', 'crypto_tickers', 1021)
)
insert into stage0_rns.reserved_names (
  chain_id,
  label,
  fqdn,
  category,
  enabled,
  sale_mode,
  display_order
)
select
  11155931,
  seed.label,
  seed.label || '.rise',
  seed.category,
  false,
  'auction',
  seed.display_order
from seed
on conflict (chain_id, (lower(label))) do nothing;
