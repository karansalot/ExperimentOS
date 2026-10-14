-- title: Qini curve of the champion uplift model, in SQL
-- requires: predictions
-- technique: NTILE ranking, running totals with SUM() OVER, Qini formula
-- question: If we target users in descending order of predicted uplift, how many incremental visits accumulate on the held-out test split?
WITH ranked AS (
    SELECT
        treatment,
        visit,
        ntile(20) OVER (ORDER BY {{champion_visit}} DESC, row_id) AS bucket
    FROM predictions
    WHERE split = 'test'
),
per_bucket AS (
    SELECT
        bucket,
        count(*)                                        AS n_users,
        sum(treatment)                                  AS n_t,
        sum(1 - treatment)                              AS n_c,
        sum(visit) FILTER (WHERE treatment = 1)         AS y_t,
        sum(visit) FILTER (WHERE treatment = 0)         AS y_c
    FROM ranked
    GROUP BY bucket
),
running AS (
    SELECT
        bucket,
        sum(n_users) OVER w AS cum_users,
        sum(n_t) OVER w     AS cum_n_t,
        sum(n_c) OVER w     AS cum_n_c,
        sum(y_t) OVER w     AS cum_y_t,
        sum(y_c) OVER w     AS cum_y_c,
        sum(n_users) OVER () AS total_users,
        sum(n_t) OVER ()    AS total_n_t
    FROM per_bucket
    WINDOW w AS (ORDER BY bucket ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
)
SELECT
    bucket,
    round(cum_users / total_users, 2)                               AS fraction_targeted,
    cum_y_t::BIGINT                                                 AS cum_treated_visits,
    cum_y_c::BIGINT                                                 AS cum_control_visits,
    round(cum_y_t - cum_y_c * cum_n_t / cum_n_c, 1)                 AS qini_incremental_visits,
    round(1000 * (cum_y_t / cum_n_t - cum_y_c / cum_n_c) * cum_users / total_users, 3)
                                                                    AS incremental_visits_per_1000_users,
    round(last_value(cum_y_t - cum_y_c * cum_n_t / cum_n_c) OVER (ORDER BY bucket
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) * cum_users / total_users, 1)
                                                                    AS random_targeting_baseline
FROM running
ORDER BY bucket;
