-- title: Development-sample representativeness
-- technique: Cohort comparison with a z statistic per metric (UNPIVOT + self-join)
-- question: Is the ~5 % development sample a fair miniature of the full dataset?
WITH cohorts AS (
    SELECT
        CASE WHEN sample_bucket < {{dev_buckets}} THEN 'dev_sample' ELSE 'rest_of_data' END AS cohort,
        count(*)::DOUBLE    AS n,
        avg(treatment)      AS treatment_share,
        avg(visit)          AS visit_rate,
        avg(conversion)     AS conversion_rate,
        avg(exposure)       AS exposure_rate
    FROM experiment
    GROUP BY 1
),
long AS (
    UNPIVOT cohorts ON treatment_share, visit_rate, conversion_rate, exposure_rate INTO NAME metric VALUE rate
)
SELECT
    s.metric,
    s.n::BIGINT                     AS n_dev_sample,
    r.n::BIGINT                     AS n_rest,
    round(s.rate, 6)                AS dev_sample_rate,
    round(r.rate, 6)                AS rest_rate,
    round((s.rate - r.rate)
        / sqrt(s.rate * (1 - s.rate) / s.n + r.rate * (1 - r.rate) / r.n), 2) AS z_statistic
FROM long s
LEFT JOIN long r ON r.metric = s.metric AND r.cohort = 'rest_of_data'
WHERE s.cohort = 'dev_sample'
ORDER BY s.metric;
