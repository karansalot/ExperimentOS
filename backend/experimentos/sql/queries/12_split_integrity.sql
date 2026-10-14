-- title: Train / validation / test split integrity
-- technique: GROUP BY with window share, uniqueness check against leakage
-- question: Are the modelling splits disjoint, correctly sized, and comparable?
SELECT
    split,
    count(*)                                            AS n_users,
    round(count(*) / sum(count(*)) OVER (), 4)          AS share_of_rows,
    count(*) - count(DISTINCT row_id)                   AS duplicate_row_ids,
    round(avg(treatment), 5)                            AS treatment_share,
    round(avg(visit), 5)                                AS visit_rate,
    round(avg(conversion), 5)                           AS conversion_rate,
    min(split_bucket)                                   AS min_bucket,
    max(split_bucket)                                   AS max_bucket
FROM experiment
GROUP BY split
ORDER BY min_bucket;
