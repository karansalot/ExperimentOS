-- title: Covariate balance (standardised mean differences)
-- technique: Conditional aggregation over a long table, derived statistics
-- question: Are pre-treatment features distributed the same way in both arms, as randomisation implies?
WITH moments AS (
    SELECT
        feature,
        treatment,
        sum(n_users)                                AS n,
        sum(value * n_users) / sum(n_users)         AS mean_value,
        sum(value * value * n_users) / sum(n_users) AS mean_sq
    FROM feature_value_stats
    GROUP BY feature, treatment
),
wide AS (
    SELECT
        feature,
        max(CASE WHEN treatment = 1 THEN mean_value END)                         AS mean_t,
        max(CASE WHEN treatment = 0 THEN mean_value END)                         AS mean_c,
        max(CASE WHEN treatment = 1 THEN (mean_sq - mean_value * mean_value) * n / (n - 1) END) AS var_t,
        max(CASE WHEN treatment = 0 THEN (mean_sq - mean_value * mean_value) * n / (n - 1) END) AS var_c
    FROM moments
    GROUP BY feature
)
SELECT
    feature,
    round(mean_c, 5)                                            AS mean_control,
    round(mean_t, 5)                                            AS mean_treatment,
    round((mean_t - mean_c) / sqrt((var_t + var_c) / 2), 5)     AS std_mean_diff,
    round(var_t / var_c, 4)                                     AS variance_ratio,
    abs((mean_t - mean_c) / sqrt((var_t + var_c) / 2)) < 0.1    AS within_0_1_threshold
FROM wide
ORDER BY abs((mean_t - mean_c) / sqrt((var_t + var_c) / 2)) DESC;
