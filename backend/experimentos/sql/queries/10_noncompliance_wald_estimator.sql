-- title: Exposure non-compliance and the Wald (IV) estimator
-- technique: Scalar subqueries / CROSS JOIN of arm rows, ratio estimator
-- question: Only a few treated users are actually exposed. What effect per exposed user does the intent-to-treat effect imply, under the exclusion restriction?
WITH t AS (SELECT * FROM v_arm_summary WHERE treatment = 1),
     c AS (SELECT * FROM v_arm_summary WHERE treatment = 0)
SELECT
    round(t.exposure_rate, 6)                                               AS exposure_rate_treatment,
    round(c.exposure_rate, 6)                                               AS exposure_rate_control,
    round(t.visit_rate - c.visit_rate, 6)                                   AS itt_visit,
    round(t.conversion_rate - c.conversion_rate, 6)                         AS itt_conversion,
    round((t.visit_rate - c.visit_rate) / (t.exposure_rate - c.exposure_rate), 4)           AS effect_per_exposed_user_visit,
    round((t.conversion_rate - c.conversion_rate) / (t.exposure_rate - c.exposure_rate), 4) AS effect_per_exposed_user_conversion
FROM t CROSS JOIN c;
