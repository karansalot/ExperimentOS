-- title: Dataset profile
-- technique: Aggregation
-- question: How many users are in the experiment and what are the headline rates?
SELECT
    count(*)                                   AS n_users,
    sum(treatment)::BIGINT                     AS n_treatment,
    (count(*) - sum(treatment))::BIGINT        AS n_control,
    round(avg(treatment), 6)                   AS treatment_share,
    round(avg(visit), 6)                       AS visit_rate,
    round(avg(conversion), 6)                  AS conversion_rate,
    round(avg(exposure), 6)                    AS exposure_rate,
    min(row_id)                                AS min_row_id,
    max(row_id)                                AS max_row_id
FROM experiment;
