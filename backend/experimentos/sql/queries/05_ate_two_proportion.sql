-- title: Average treatment effect (intent-to-treat)
-- technique: CTE pipeline, conditional aggregation, two-proportion z statistic and Wald interval in SQL
-- question: What is the absolute and relative effect of treatment assignment on visits and conversions?
WITH long AS (
    SELECT 'visit' AS outcome, treatment, n_users, visits AS successes FROM v_arm_summary
    UNION ALL
    SELECT 'conversion', treatment, n_users, conversions FROM v_arm_summary
),
arms AS (
    SELECT
        outcome,
        max(CASE WHEN treatment = 1 THEN n_users END)::DOUBLE   AS n_t,
        max(CASE WHEN treatment = 0 THEN n_users END)::DOUBLE   AS n_c,
        max(CASE WHEN treatment = 1 THEN successes END)::DOUBLE AS x_t,
        max(CASE WHEN treatment = 0 THEN successes END)::DOUBLE AS x_c
    FROM long
    GROUP BY outcome
),
rates AS (
    SELECT
        *,
        x_t / n_t                   AS p_t,
        x_c / n_c                   AS p_c,
        (x_t + x_c) / (n_t + n_c)   AS p_pool
    FROM arms
),
effects AS (
    SELECT
        *,
        p_t - p_c                                               AS ate,
        sqrt(p_t * (1 - p_t) / n_t + p_c * (1 - p_c) / n_c)     AS se_unpooled,
        sqrt(p_pool * (1 - p_pool) * (1 / n_t + 1 / n_c))       AS se_pooled
    FROM rates
)
SELECT
    outcome,
    round(p_c, 6)                               AS control_rate,
    round(p_t, 6)                               AS treatment_rate,
    round(ate, 6)                               AS absolute_effect,
    round(ate - 1.959964 * se_unpooled, 6)      AS ci95_low,
    round(ate + 1.959964 * se_unpooled, 6)      AS ci95_high,
    round(ate / p_c, 4)                         AS relative_effect,
    round(ate / se_pooled, 2)                   AS z_statistic
FROM effects
ORDER BY outcome DESC;
