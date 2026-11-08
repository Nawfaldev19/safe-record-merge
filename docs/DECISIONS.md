# Architecture decision records

Each record states the situation, the decision and what follows from it, including
the costs. They are numbered in the order they were made.

## ADR 1: A merge is one transaction, with both rows locked first

**Context.** A merge touches two member rows, their sign-ups, payments and history,
and the journal. A failure half-way would leave a person split across two records in
a new and worse way. Two people may also try to merge the same pair at once.

**Decision.** Do every step inside one database transaction. Before reading
anything, lock both member rows with `FOR UPDATE`, in id order.

**Rejected.** _Application-level steps with compensation on failure_: every
compensation is another thing that can fail. _Locking in request order_: two merges
of the same pair in opposite directions would wait on each other for ever.

**Consequences.** The merge is atomic, and concurrent merges of a pair run one after
the other; the second finds the pair already merged. A test injects a failure at the
very last step and compares the full state before and after. The cost is a
transaction that holds two row locks for a few statements, which is acceptable for
an action a person triggers by hand.

## ADR 2: Journal what changed, by id, not how to recompute it

**Context.** Undo needs to put things back. It could try to work out what the merge
must have done, or it could read what the merge wrote down.

**Decision.** The merge writes a snapshot: the kept record's fields before, the ids
of every row it moved, and the full content of every row it deleted. Undo reads only
the snapshot.

**Rejected.** _Recomputing from current data_: once two records' sign-ups are
together, nothing says which came from where. _Soft-deleting instead of moving_:
every later query would have to know about two kinds of row.

**Consequences.** Undo is mechanical and exact: a test compares every column of both
records, and their sign-ups and payments, before the merge and after the undo. The
snapshot is JSON in one column, which is easy to keep in step with the code that
writes and reads it, but is not queryable in detail and would need a version field if
its shape ever changed.

## ADR 3: Undo only while the kept record is unchanged, and say so otherwise

**Context.** After a merge, people keep working. They edit the kept record, or merge
a third record into it. An undo that ignores this would overwrite their work with
values from before the merge.

**Decision.** Every member has a `revision` that goes up on each change. The journal
stores the kept record's revision right after the merge. Undo is allowed only while
the revision is still that number. Otherwise it is refused with a sentence that says
what happened, and the history page shows the same sentence instead of an enabled
button.

**Rejected.** _Field-by-field undo that skips fields changed since_: produces a
record that never existed and that nobody chose. _A full history of every change
with arbitrary rollback_: a different and much larger system. _Timestamps instead of
revisions_: two changes in the same millisecond would be invisible.

**Consequences.** Undo never loses a later change. The price is strictness: stacked
merges are undone newest first, and undoing one merge is itself a change, so an
earlier merge of the same record then has to be fixed by hand. This is the
conservative choice for a tool run by volunteers, and the behaviour is pinned down
by tests so that it is at least predictable.

## ADR 4: Keep the folded record as a signpost

**Context.** A merged-away record has an id that may be bookmarked, linked from an
email or held in another browser tab.

**Decision.** Do not delete it. Set `merged_into_id`, leave it out of lists and
matching, and make lookups follow the pointer (through chains, with a hop limit) to
the record that exists now.

**Rejected.** _Deleting it_: old links break, and undo would have to re-create a row
with a fixed id. _A separate redirect table_: one more place to keep consistent.

**Consequences.** Links survive merges, and undo is a matter of clearing a column.
Every query that lists people must say `merged_into_id is null`; the partial indexes
and one shared query function keep that in one place.

## ADR 5: Blocking before scoring

**Context.** The simple way to find duplicates compares every record with every
other, which is quadratic.

**Decision.** Give each record a few cheap keys (email, phone, first letters of the
name's words) and compare only records that share a key.

**Rejected.** _All pairs_: 4.5 million comparisons for 3,000 people, on every visit.
_Database-side fuzzy matching with trigram indexes_: a good production answer, but
it ties the matching rules to one database and makes them hard to unit test.
_Sorted-neighbourhood methods_: more recall for more complexity than this roster
needs.

**Consequences.** The search is close to linear in practice, and the matching is a
pure function with fast tests. The cost is recall: a pair with no shared key is
never seen. For a club roster, where a duplicate nearly always shares a contact
detail or a recognisable name, that is the right side to err on.

## ADR 6: A score made of named reasons

**Context.** A volunteer has to decide whether two records are one person. A bare
number does not help them, and cannot be argued with.

**Decision.** The score is a sum of a few weights, each tied to a sentence ("Same
phone number"). The reasons are returned with the pair and shown on screen.

**Rejected.** _A trained model_: no data to train on, and no way to explain a
suggestion. _A similarity number only_: opaque.

**Consequences.** Suggestions are explainable and the rules are easy to test (the
tests assert exact scores and reasons). The weights are judgement, not measurement,
which the README says plainly.

## ADR 7: Derive the stage instead of storing it

**Context.** Whether someone is a member depends on today's date and their dues. A
stored stage would be wrong the day after dues run out unless something updated it.

**Decision.** Compute the stage from dues and trips in one pure function, with an
optional manual override stored as `stage_pin`. Repeat the rules as a SQL `CASE` for
filtering and counting.

**Rejected.** _A stored stage with a nightly job_: wrong between runs, and one more
thing to operate.

**Consequences.** The stage is always right, and a merge changes it automatically
when it brings dues from one record to the other. The rules exist twice; a test
checks that the two agree for a person in every stage.

## ADR 8: Stream the export, and defuse formulas

**Context.** An export can be large, and it will be opened in a spreadsheet. Names
and notes on a roster are typed by the public.

**Decision.** Fetch rows in batches by key and write each row to the response as it
is produced, respecting back-pressure. Prefix any text cell that starts with `=`,
`+`, `-`, `@`, a tab or a carriage return with an apostrophe, and quote cells as
RFC 4180 describes.

**Rejected.** _Building the whole file in memory_: memory grows with the roster.
_Escaping only commas and quotes_: leaves formula injection open.

**Consequences.** Memory use is flat, and a hostile name cannot run as a formula on
the machine of whoever opens the file. A phone number that starts with `+` gains a
visible apostrophe in some spreadsheet programs, which is the accepted cost of the
standard defence.

## ADR 9: The comparison screen's logic lives outside React

**Context.** The merge screen makes several decisions: which record to keep by
default, where each field starts, how the result will look. These are easy to get
subtly wrong and tedious to test through a rendered page.

**Decision.** Put them in `merge-model.ts` as pure functions over plain values. The
page calls them and renders the answers.

**Rejected.** _State and rules inside the component_: testable only by clicking.

**Consequences.** The rules have direct unit tests, including the translation from
"left and right" on screen to "kept and folded in" for the API, which is the kind of
mapping that is easy to invert by mistake. The page stays a description of layout.
