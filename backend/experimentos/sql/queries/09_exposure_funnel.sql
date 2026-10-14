-- title: Assignment -> exposure -> visit -> conversion funnel
-- technique: UNION ALL funnel stages, LAG window for step-to-step rates
-- question: How far do users in each arm progress, and where does the treatment arm differ?
WITH stages AS (
    SELECT arm, 1 AS step, 'assigned'  AS stage, n_users     AS users FROM v_arm_summary
    UNION ALL SELECT arm, 2, 'exposed',   exposures   FROM v_arm_summary
    UNION ALL SELECT arm, 3, 'visited',   visits      FROM v_arm_summary
    UNION ALL SELECT arm, 4, 'converted', conversions FROM v_arm_summary
)
SELECT
    arm,
    step,
    stage,
    users,
    round(users::DOUBLE / first_value(users) OVER w, 6)                      AS share_of_assigned,
    -- 'exposed' is not a prerequisite for 'visited', so the step rate is only shown for visit -> conversion.
    CASE WHEN stage = 'converted'
         THEN round(users::DOUBLE / lag(users) OVER w, 6) END                AS conversion_given_visit
FROM stages
WINDOW w AS (PARTITION BY arm ORDER BY step)
ORDER BY arm DESC, step;
