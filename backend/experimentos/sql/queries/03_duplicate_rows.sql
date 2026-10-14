-- title: Exact duplicate rows
-- technique: CTE + GROUP BY on all columns, distribution of group sizes
-- question: How many rows are exact duplicates? (There is no user id, so duplicates cannot be attributed to the same user and are reported, not removed.)
WITH groups AS (
    SELECT count(*) AS copies
    FROM experiment
    GROUP BY f0, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, treatment, conversion, visit, exposure
),
by_size AS (
    SELECT
        CASE WHEN copies >= 5 THEN '5+' ELSE copies::VARCHAR END AS copies_per_distinct_row,
        count(*)                AS distinct_rows,
        sum(copies)::BIGINT     AS total_rows
    FROM groups
    GROUP BY 1
)
SELECT
    copies_per_distinct_row,
    distinct_rows,
    total_rows,
    round(100.0 * total_rows / sum(total_rows) OVER (), 3) AS pct_of_all_rows
FROM by_size
ORDER BY copies_per_distinct_row;
