-- title: Sample ratio mismatch (SRM)
-- technique: CTE, chi-square goodness-of-fit computed in SQL
-- question: Does the observed treatment/control split match the documented 85/15 design?
WITH design AS (
    SELECT 1 AS treatment, {{design_ratio}} AS expected_share
    UNION ALL
    SELECT 0, 1 - {{design_ratio}}
),
observed AS (
    SELECT treatment, n_users, sum(n_users) OVER () AS n_total FROM v_arm_summary
),
cells AS (
    SELECT
        o.treatment,
        o.n_users                                   AS observed,
        d.expected_share * o.n_total                AS expected,
        o.n_users::DOUBLE / o.n_total               AS observed_share,
        d.expected_share
    FROM observed o JOIN design d USING (treatment)
)
SELECT
    treatment,
    observed,
    round(expected, 1)                                              AS expected,
    round(observed_share, 6)                                        AS observed_share,
    expected_share,
    round(observed - expected, 1)                                   AS excess_users,
    round(sum(power(observed - expected, 2) / expected) OVER (), 4) AS chi_square_1df,
    -- 3.841 is the 5 % critical value for 1 degree of freedom; the exact p-value is computed in SciPy.
    sum(power(observed - expected, 2) / expected) OVER () > 3.841   AS exceeds_5pct_critical_value
FROM cells
ORDER BY treatment DESC;
