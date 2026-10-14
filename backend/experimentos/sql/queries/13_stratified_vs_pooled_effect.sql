-- title: Stratified vs pooled effect (Simpson's paradox check)
-- technique: Multi-CTE post-stratification, weighted average of within-stratum effects
-- question: Does the pooled effect agree with a size-weighted average of within-segment effects for every feature?
WITH strata AS (
    SELECT
        feature, segment_id,
        sum(n_users)                                                            AS n,
        sum(visits) FILTER (WHERE treatment = 1)::DOUBLE
            / sum(n_users) FILTER (WHERE treatment = 1)                         AS p_t,
        sum(visits) FILTER (WHERE treatment = 0)::DOUBLE
            / sum(n_users) FILTER (WHERE treatment = 0)                         AS p_c
    FROM v_segment_arm_stats
    GROUP BY feature, segment_id
),
stratified AS (
    SELECT
        feature,
        sum(n * (p_t - p_c)) / sum(n)   AS stratified_effect,
        min(p_t - p_c)                  AS min_stratum_effect,
        max(p_t - p_c)                  AS max_stratum_effect
    FROM strata
    GROUP BY feature
),
pooled AS (
    SELECT max(visit_rate) FILTER (WHERE treatment = 1)
         - max(visit_rate) FILTER (WHERE treatment = 0) AS pooled_effect
    FROM v_arm_summary
)
SELECT
    s.feature,
    round(p.pooled_effect, 6)                           AS pooled_effect,
    round(s.stratified_effect, 6)                       AS stratified_effect,
    round(s.stratified_effect - p.pooled_effect, 6)     AS difference,
    round(s.min_stratum_effect, 6)                      AS min_stratum_effect,
    round(s.max_stratum_effect, 6)                      AS max_stratum_effect,
    s.min_stratum_effect > 0                            AS all_strata_positive
FROM stratified s CROSS JOIN pooled p
ORDER BY CAST(substr(s.feature, 2) AS INTEGER);
