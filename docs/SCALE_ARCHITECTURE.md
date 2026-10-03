# Moneymatters scale architecture

## Current strategy

Moneymatters remains a PostgreSQL-first, multi-tenant relational application. The normalized transactional schema is the source of truth for accounting, customers, vendors, invoices, bills, payments, inventory and audit history.

We are intentionally not introducing microservices, database sharding, replicas, or a distributed cache before workload justifies them.

## Non-negotiable access rules

1. Every business-data query must scope by `business_id` (or by a directly indexed tenant relationship).
2. List pages must use a small page size and keyset/cursor pagination. Do not load an entire business dataset into the browser.
3. Search must execute in PostgreSQL. Client-side filtering is only acceptable for an already-small, explicitly bounded result set.
4. High-cardinality lists should order by a stable pair such as `(created_at, id)` so keyset pagination remains deterministic.
5. Foreign keys used for navigation/history must have supporting indexes when the access path is frequent.
6. Expensive dashboard/accounting aggregates should eventually be served from incremental read models rather than recalculated from raw ledger tables on every request.
7. Transaction tables remain authoritative; read models, caches and replicas are derived acceleration layers.

## Current foundation added in v1

The scale foundation migration adds:

- tenant/member/permission indexes for RLS and authorization checks;
- customer and vendor list/search indexes;
- invoice and bill history/status indexes;
- payment/allocation indexes;
- catalog and vendor-item mapping indexes;
- inventory movement indexes;
- journal entry/line indexes;
- bank transaction indexes;
- customer credit/refund/write-off indexes;
- PostgreSQL `pg_trgm` support for scalable partial text search.

The customer/vendor `(business_id, is_active, created_at, id)` indexes are the intended keyset-pagination paths.

## Next scale stages

### Stage 1 — now

- Index critical access paths.
- Replace whole-table browser loads with bounded queries.
- Introduce reusable keyset pagination patterns.
- Move search/filtering to PostgreSQL.
- Keep business/organization RLS efficient and indexed.

### Stage 2 — when data volume justifies it

- Add incremental read models such as `customer_account_summary`, `vendor_account_summary`, `inventory_balance_summary` and dashboard summaries.
- Add query-performance telemetry and slow-query thresholds.
- Add server/API-level caching for stable reference data.
- Review connection pooling and Supabase/Postgres resource sizing.

### Stage 3 — when global traffic justifies it

- Add edge/API caching where safe.
- Add read replicas for read-heavy workloads.
- Introduce regional deployment/read strategies where latency requires them.
- Partition only the specific high-volume tables demonstrated by workload measurements.

### Stage 4 — very large scale

- Separate analytical workloads from OLTP.
- Consider event-driven derived stores/search infrastructure where justified.
- Consider tenant-aware workload isolation for exceptionally large customers.

## Important accounting consideration

Document numbering currently uses business-scoped advisory locking in several accounting functions. This is safe, but at very high write concurrency it can become a serialization point. Before that becomes a bottleneck, migrate numbering to dedicated business/document-type counters or PostgreSQL sequence-backed allocation.

## Performance target

"Milliseconds" should be treated as a layered target:

- SQL execution should be optimized through indexed point/bounded queries.
- API response time should remain bounded through small payloads and server-side pagination.
- Global user latency depends on application/database region and network distance; database indexing alone cannot guarantee sub-10ms end-user latency worldwide.

## Decision rule

Do not add distributed infrastructure because it sounds scalable. Add it when measured workload shows the current layer is the bottleneck. Keep the normalized transactional model stable so those acceleration layers can be introduced without rewriting business logic.
