-- Segment definition per feature.
-- The features are zero-inflated: one modal value holds 26-99 % of users, so
-- NTILE() would split ties arbitrarily. Instead: segment 0 = the modal value,
-- segments 1-3 = user-weighted terciles of the remaining values (midpoint rule
-- on a cumulative window over the pre-aggregated value counts).
CREATE OR REPLACE VIEW v_feature_segments AS
WITH per_value AS (
    SELECT feature, value, sum(n_users) AS n
    FROM feature_value_stats
    GROUP BY feature, value
),
flagged AS (
    SELECT
        *,
        row_number() OVER (PARTITION BY feature ORDER BY n DESC, value) = 1 AS is_mode
    FROM per_value
),
cumulative AS (
    SELECT
        *,
        sum(n) OVER (PARTITION BY feature, is_mode ORDER BY value
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_n,
        sum(n) OVER (PARTITION BY feature, is_mode)                    AS group_n
    FROM flagged
)
SELECT
    feature,
    value,
    CASE
        WHEN is_mode THEN 0
        ELSE 1 + least(2, floor(3.0 * (cum_n - n / 2.0) / group_n))::INTEGER
    END AS segment_id
FROM cumulative;

CREATE OR REPLACE VIEW v_segment_arm_stats AS
SELECT
    s.feature,
    g.segment_id,
    CASE g.segment_id
        WHEN 0 THEN 'Modal value'
        WHEN 1 THEN 'Non-modal: low'
        WHEN 2 THEN 'Non-modal: mid'
        ELSE 'Non-modal: high'
    END                         AS segment,
    s.treatment,
    min(s.value)                AS value_min,
    max(s.value)                AS value_max,
    sum(s.n_users)::BIGINT      AS n_users,
    sum(s.visits)::BIGINT       AS visits,
    sum(s.conversions)::BIGINT  AS conversions
FROM feature_value_stats s
JOIN v_feature_segments g USING (feature, value)
GROUP BY s.feature, g.segment_id, s.treatment;
