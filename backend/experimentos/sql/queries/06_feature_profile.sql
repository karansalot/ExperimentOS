-- title: Feature profile
-- technique: Aggregation over the pre-aggregated value table, FIRST_VALUE window, FILTER clause
-- question: What do the 12 anonymised features look like (cardinality, range, concentration)?
WITH per_value AS (
    SELECT feature, value, sum(n_users) AS n
    FROM feature_value_stats
    GROUP BY feature, value
),
with_mode AS (
    SELECT
        *,
        first_value(value) OVER (PARTITION BY feature ORDER BY n DESC, value) AS mode_value,
        first_value(n)     OVER (PARTITION BY feature ORDER BY n DESC, value) AS mode_n
    FROM per_value
)
SELECT
    feature,
    count(*)                                                AS distinct_values,
    round(min(value), 4)                                    AS min_value,
    round(max(value), 4)                                    AS max_value,
    round(sum(value * n) / sum(n), 4)                       AS mean_value,
    round(sqrt(sum(n * value * value) / sum(n) - power(sum(value * n) / sum(n), 2)), 4) AS std_value,
    round(any_value(mode_value), 4)                         AS modal_value,
    round(any_value(mode_n) / sum(n), 4)                    AS share_at_modal_value,
    count(*) FILTER (WHERE n = 1)                           AS singleton_values
FROM with_mode
GROUP BY feature
ORDER BY CAST(substr(feature, 2) AS INTEGER);
