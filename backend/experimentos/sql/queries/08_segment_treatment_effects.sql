-- title: Segment-level treatment effects
-- technique: Self-join of arm statistics, per-segment standard errors, cohort comparison
-- question: How does the visit effect differ across feature segments?
WITH arms AS (
    SELECT
        t.feature, t.segment_id, t.segment,
        least(t.value_min, c.value_min)     AS value_min,
        greatest(t.value_max, c.value_max)  AS value_max,
        t.n_users::DOUBLE AS n_t, c.n_users::DOUBLE AS n_c,
        t.visits / t.n_users::DOUBLE        AS p_t,
        c.visits / c.n_users::DOUBLE        AS p_c
    FROM v_segment_arm_stats t
    JOIN v_segment_arm_stats c
      ON t.feature = c.feature AND t.segment_id = c.segment_id
     AND t.treatment = 1 AND c.treatment = 0
)
SELECT
    feature,
    segment,
    round(value_min, 3)                                         AS value_min,
    round(value_max, 3)                                         AS value_max,
    (n_t + n_c)::BIGINT                                         AS n_users,
    round(p_c, 5)                                               AS control_visit_rate,
    round(p_t, 5)                                               AS treatment_visit_rate,
    round(p_t - p_c, 5)                                         AS absolute_effect,
    round(sqrt(p_t * (1 - p_t) / n_t + p_c * (1 - p_c) / n_c), 5) AS std_error,
    round((p_t - p_c) / nullif(p_c, 0), 3)                      AS relative_effect
FROM arms
ORDER BY CAST(substr(feature, 2) AS INTEGER), segment_id;
