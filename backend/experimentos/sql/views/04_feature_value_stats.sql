-- Materialised once per session: outcome counts per (feature, distinct value, arm).
-- Every segment / balance query reads this compact table instead of rescanning rows.
CREATE OR REPLACE TABLE feature_value_stats AS
SELECT
    feature,
    value,
    treatment,
    count(*)                AS n_users,
    sum(visit)::BIGINT      AS visits,
    sum(conversion)::BIGINT AS conversions
FROM v_feature_long
GROUP BY feature, value, treatment;
