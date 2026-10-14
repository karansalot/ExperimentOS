-- title: Predicted vs observed uplift by decile
-- requires: predictions
-- technique: NTILE deciles, predicted-vs-actual comparison, standard error per decile
-- question: Within each decile of predicted uplift, does the observed treatment-minus-control difference match the prediction?
WITH ranked AS (
    SELECT
        treatment,
        visit,
        {{champion_visit}} AS predicted_uplift,
        ntile(10) OVER (ORDER BY {{champion_visit}} DESC, row_id) AS decile
    FROM predictions
    WHERE split = 'test'
),
agg AS (
    SELECT
        decile,
        count(*)                                            AS n_users,
        avg(predicted_uplift)                               AS mean_predicted_uplift,
        avg(visit) FILTER (WHERE treatment = 1)             AS p_t,
        avg(visit) FILTER (WHERE treatment = 0)             AS p_c,
        count(*) FILTER (WHERE treatment = 1)::DOUBLE       AS n_t,
        count(*) FILTER (WHERE treatment = 0)::DOUBLE       AS n_c
    FROM ranked
    GROUP BY decile
)
SELECT
    decile,
    n_users,
    round(mean_predicted_uplift, 5)                                     AS mean_predicted_uplift,
    round(p_t - p_c, 5)                                                 AS observed_uplift,
    round(sqrt(p_t * (1 - p_t) / n_t + p_c * (1 - p_c) / n_c), 5)       AS std_error,
    round((p_t - p_c) - mean_predicted_uplift, 5)                       AS calibration_gap
FROM agg
ORDER BY decile;
