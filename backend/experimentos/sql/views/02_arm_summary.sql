-- One row per experiment arm with the sufficient statistics every test needs.
CREATE OR REPLACE VIEW v_arm_summary AS
SELECT
    treatment,
    CASE WHEN treatment = 1 THEN 'treatment' ELSE 'control' END AS arm,
    count(*)                        AS n_users,
    sum(visit)::BIGINT              AS visits,
    sum(conversion)::BIGINT         AS conversions,
    sum(exposure)::BIGINT           AS exposures,
    avg(visit)                      AS visit_rate,
    avg(conversion)                 AS conversion_rate,
    avg(exposure)                   AS exposure_rate
FROM experiment
GROUP BY treatment;
