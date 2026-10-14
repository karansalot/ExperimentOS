-- title: File-order structure (why splits must be hash-based)
-- technique: NTILE window to form position cohorts, LAG for block-over-block change
-- question: The data has no timestamp or test id. Is row order random, or would a sequential sample / head-tail split be biased?
WITH blocks AS (
    SELECT ntile(20) OVER (ORDER BY row_id) AS block, row_id, treatment, visit, f0 FROM experiment
),
agg AS (
    SELECT
        block,
        min(row_id)         AS first_row_id,
        count(*)            AS n_users,
        avg(treatment)      AS treatment_share,
        avg(visit)          AS visit_rate,
        avg(f0)             AS mean_f0
    FROM blocks
    GROUP BY block
)
SELECT
    block,
    first_row_id,
    n_users,
    round(treatment_share, 4)                                               AS treatment_share,
    round(treatment_share - lag(treatment_share) OVER (ORDER BY block), 4)  AS share_change_vs_prev_block,
    round(visit_rate, 5)                                                    AS visit_rate,
    round(visit_rate / avg(visit_rate) OVER (), 2)                          AS visit_rate_vs_block_mean,
    round(mean_f0, 3)                                                       AS mean_f0
FROM agg
ORDER BY block;
