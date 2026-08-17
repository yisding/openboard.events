-- One-shot repair for visibility rules that point at something no longer on
-- the form, plus the republish that makes the repair visible to speakers.
--
-- A conditional question stores its rule as
-- `{match, conditions:[{sourceFieldId, op, value}]}`, where `value` on a
-- dropdown/multiselect source is an *option id*. Nothing ever checked that the
-- id resolves. Two writers produced ones that do not:
--
--   * the builder's `draft-N` placeholder ids. `FieldInspector` offers the
--     option lines of an unsaved question as condition values; saving the
--     dependent question first stores `draft-2`, and saving the source
--     question afterwards mints a real uuid that nothing rewrites the rule to.
--   * `remapVisibility` in the demo scaffold copy, which carried `in`/`not_in`
--     array values across to a new form verbatim while re-iding the options
--     underneath them.
--
-- The consequence is silent and total: `evaluateRule` compares the stored id
-- with the option ids the speaker can actually pick, `eq` never matches, and
-- the dependent question is unreachable on the public form forever — or, with
-- `neq`, shows unconditionally. `compileFormSnapshot` validated only condition
-- *ordering*, so every publish carried the broken rule forward and no screen
-- ever said anything.
--
-- The repair drops the unresolvable condition and, when that empties the rule,
-- clears `visibility` so the question is simply always shown. There is no
-- honest way to guess which option the organizer meant, and of the two failure
-- modes only this one is discoverable: an unexpected question on the form is
-- something an organizer sees and can re-condition, while a question that
-- never renders is invisible by construction. `routing_rules` reaches the same
-- conclusion from the other side — it soft-disables an invalidated rule rather
-- than guessing — but a visibility rule has no `enabled` column to fall back
-- to.
--
-- Conditions whose `sourceFieldId` names a question that is not live on the
-- form are dropped by the same pass. Those forms are worse off than merely
-- broken: `compileFormSnapshot` rejects them outright, so the builder could
-- not save them at all.
--
-- Not repaired here: a rule whose source question was *reordered* after its
-- dependent. That is a different defect with a different fix (move the
-- question, not edit the rule), the compiler already refuses to publish it,
-- and replicating the compiler's section/sort/id tiebreak in SQL to detect it
-- would be a second definition of field order.

CREATE FUNCTION repair_dangling_visibility(p_visibility jsonb, p_sources jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE WHEN surviving.conditions IS NULL THEN NULL
              ELSE jsonb_set(p_visibility, '{conditions}', surviving.conditions)
         END
  FROM (
    SELECT jsonb_agg(condition ORDER BY position) AS conditions
    FROM jsonb_array_elements(p_visibility -> 'conditions') WITH ORDINALITY AS c(condition, position)
    WHERE p_sources ? (condition ->> 'sourceFieldId')
      -- Only an option-bearing source constrains the value. `eq 'yes'` against
      -- a text question is free text an organizer typed, not an id, and must
      -- survive untouched.
      AND NOT (
        p_sources -> (condition ->> 'sourceFieldId') ->> 'type' IN ('dropdown', 'multiselect')
        AND condition ? 'value'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
            CASE jsonb_typeof(condition -> 'value')
              WHEN 'array' THEN condition -> 'value'
              ELSE jsonb_build_array(condition -> 'value')
            END
          ) AS each_value(value)
          WHERE NOT (p_sources -> (condition ->> 'sourceFieldId') -> 'options' ? each_value.value)
        )
      )
  ) AS surviving;
$$;

-- The same repair against a compiled snapshot, which carries its own copy of
-- every question and option and is therefore self-describing: the ids a rule
-- must resolve against are the ones in this snapshot, not whatever the
-- authoring rows say today.
CREATE FUNCTION repair_snapshot_visibility(p_snapshot jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT AS $$
  WITH sources AS (
    SELECT coalesce(jsonb_object_agg(field ->> 'id', jsonb_build_object(
             'type', field ->> 'type',
             'options', coalesce((
               SELECT jsonb_agg(option ->> 'id') FROM jsonb_array_elements(field -> 'options') AS option
             ), '[]'::jsonb)
           )), '{}'::jsonb) AS live_fields
    FROM jsonb_array_elements(p_snapshot -> 'sections') AS section
    CROSS JOIN LATERAL jsonb_array_elements(section -> 'fields') AS field
  )
  SELECT jsonb_set(p_snapshot, '{sections}', coalesce((
    SELECT jsonb_agg(jsonb_set(section, '{fields}', coalesce((
      SELECT jsonb_agg(
        CASE WHEN coalesce(jsonb_typeof(field -> 'visibility'), 'null') = 'null' THEN field
             ELSE jsonb_set(field, '{visibility}', coalesce(
               repair_dangling_visibility(field -> 'visibility', sources.live_fields), 'null'::jsonb))
        END ORDER BY field_position)
      FROM jsonb_array_elements(section -> 'fields') WITH ORDINALITY AS f(field, field_position)
    ), '[]'::jsonb)) ORDER BY section_position)
    FROM jsonb_array_elements(p_snapshot -> 'sections') WITH ORDINALITY AS s(section, section_position)
  ), '[]'::jsonb))
  FROM sources;
$$;

-- The authoring rows the builder reads and every future publish compiles from.
WITH sources AS (
  SELECT form_id, jsonb_object_agg(id::text, jsonb_build_object(
           'type', field_type::text,
           'options', coalesce((
             SELECT jsonb_agg(option ->> 'id') FROM jsonb_array_elements(options) AS option
           ), '[]'::jsonb)
         )) AS live_fields
  FROM form_fields
  WHERE deleted_at IS NULL
  GROUP BY form_id
)
UPDATE form_fields AS field
SET visibility = repair_dangling_visibility(field.visibility, sources.live_fields),
    updated_at = date_trunc('milliseconds', now())
FROM sources
WHERE sources.form_id = field.form_id
  AND field.deleted_at IS NULL
  AND field.visibility IS NOT NULL
  AND repair_dangling_visibility(field.visibility, sources.live_fields) IS DISTINCT FROM field.visibility;

-- The public form renders the pinned snapshot, not the authoring rows, so
-- repairing `form_fields` alone would leave every live call for speakers
-- exactly as broken until an organizer happened to click Publish. Repairing
-- the current snapshot in place is not an option either — a snapshot is
-- immutable, and an in-flight draft pinned to that version answered the form
-- it was served. So this publishes a new version, which is what a publish has
-- always been: one more append, drafts keep the version they started on.
WITH repaired AS (
  SELECT version.event_id, version.form_id, version.version + 1 AS next_version,
         jsonb_set(
           repair_snapshot_visibility(version.snapshot),
           '{version}',
           to_jsonb(version.version + 1)
         ) AS snapshot
  FROM form_versions AS version
  JOIN forms AS form
    ON form.id = version.form_id
   AND form.event_id = version.event_id
   AND form.current_version = version.version
  WHERE repair_snapshot_visibility(version.snapshot) IS DISTINCT FROM version.snapshot
), published AS (
  INSERT INTO form_versions (event_id, form_id, version, snapshot)
  SELECT event_id, form_id, next_version, snapshot FROM repaired
  RETURNING event_id, form_id, version
)
-- `updated_at` is the form builder's compare-and-swap token and has to move:
-- a builder left open on the old copy must be told to reload rather than
-- publish the broken rule back over the repair. Truncated to milliseconds
-- because that is the resolution the token has (`touchFormIn`) — a raw `now()`
-- here would leave a microsecond remainder no client-held token can ever
-- match, and deploys run migrations before the web Worker.
UPDATE forms AS form
SET current_version = published.version,
    row_version = form.row_version + 1,
    updated_at = date_trunc('milliseconds', now())
FROM published
WHERE form.id = published.form_id AND form.event_id = published.event_id;

DROP FUNCTION repair_snapshot_visibility(jsonb);
DROP FUNCTION repair_dangling_visibility(jsonb, jsonb);
