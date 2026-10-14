-- title: Feature quantiles by arm
-- technique: Ordered-set aggregates (quantile_cont) with PIVOT
-- question: Beyond means, do the feature distributions line up between arms at the median and tails?
WITH q AS (
    SELECT
        feature,
        CASE WHEN treatment = 1 THEN 'treatment' ELSE 'control' END AS arm,
        quantile_cont(value, 0.50) AS p50,
        quantile_cont(value, 0.90) AS p90,
        quantile_cont(value, 0.99) AS p99
    FROM v_feature_long
    GROUP BY feature, treatment
)
SELECT *
FROM (PIVOT q ON arm USING first(round(p50, 4)) AS p50, first(round(p90, 4)) AS p90, first(round(p99, 4)) AS p99 GROUP BY feature)
ORDER BY CAST(substr(feature, 2) AS INTEGER);
