-- title: Highest- and lowest-response segments
-- technique: RANK() window with QUALIFY, minimum-sample guard
-- question: Which segments show the largest and smallest visit effect, among segments with enough control users to estimate it?
WITH effects AS (
    SELECT
        feature,
        segment,
        sum(n_users)::BIGINT                                                    AS n_users,
        sum(n_users) FILTER (WHERE treatment = 0)::BIGINT                       AS n_control,
        sum(visits) FILTER (WHERE treatment = 1)::DOUBLE
            / sum(n_users) FILTER (WHERE treatment = 1)
      - sum(visits) FILTER (WHERE treatment = 0)::DOUBLE
            / sum(n_users) FILTER (WHERE treatment = 0)                         AS visit_effect
    FROM v_segment_arm_stats
    GROUP BY feature, segment
    HAVING sum(n_users) FILTER (WHERE treatment = 0) >= {{min_control}}
)
SELECT
    feature,
    segment,
    n_users,
    n_control,
    round(visit_effect, 5)                              AS visit_effect,
    rank() OVER (ORDER BY visit_effect DESC)            AS rank_highest,
    rank() OVER (ORDER BY visit_effect ASC)             AS rank_lowest
FROM effects
QUALIFY rank_highest <= 5 OR rank_lowest <= 5
ORDER BY visit_effect DESC;
