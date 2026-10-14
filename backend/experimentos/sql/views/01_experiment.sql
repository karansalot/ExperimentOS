-- Base view over the Parquet file for the active scope.
-- {{parquet}} and the split bounds are substituted by the runner from config.py.
CREATE OR REPLACE VIEW experiment AS
SELECT
    *,
    CASE
        WHEN split_bucket < {{train_hi}} THEN 'train'
        WHEN split_bucket < {{valid_hi}} THEN 'valid'
        ELSE 'test'
    END AS split
FROM read_parquet('{{parquet}}');
