# HTTP contract

JSON request/response bodies; maximum body size 32 KiB. Except `/health`, all routes require `Authorization: Bearer TOKEN`. Supply `Content-Type: application/json` when sending a JSON body; omit it for an empty request.

| Method | Path | Success | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | 200 | API/database readiness |
| GET | `/documents` | 200 `{documents: [...]}` | Current tenant's latest 100 visible documents |
| POST | `/documents` | 201 `{document, jobId}` | Create document and schedule processing |
| GET | `/documents/:id` | 200 document | Inspect current state |
| PATCH | `/documents/:id` | 200 document | Review/correct extracted fields |
| POST | `/documents/:id/process` | 202 `{jobId}` | Schedule an explicit new processing attempt |
| GET | `/documents/:id/results` | 200 `{results: [...]}` | Accepted processing history |
| DELETE | `/documents/:id` | 204 | Remove a document from use |

Create body:

```json
{
  "title": "Synthetic utility invoice",
  "source": {
    "issuer": "Example Utilities",
    "amountCents": 4200,
    "currency": "EUR",
    "dueDate": "2027-01-15"
  }
}
```

The processor uses `source` as simulated extracted data. Review changes the current `fields`, not the original source. No file upload is needed.

Review body (use the actual latest revision returned by GET):

```json
{"expectedRevision": 1, "fields": {"amountCents": 4300}}
```

At least one field is required. Amounts are integer cents between 0 and 100000000; currencies are EUR, USD or GBP. Due dates are valid ISO calendar dates. Title and issuer are nonempty strings of at most 160 characters.

Documents contain `id`, `tenant_id`, `title`, `source`, `fields`, `status`, `revision`, `result_count`, timestamps and internal lifecycle metadata. Clients use `revision` for editing; internal fields such as `processing_version` are not client inputs. `result_count` counts accepted processing operations, not human edits. Processing history contains result ID, job ID, fields and timestamp. A correction advances revision; a successful processing effect advances revision. Queue housekeeping alone does not.

The overview is a stored summary and can briefly lag background progress. An accepted removal must nevertheless keep the document out of the overview. History contents may be cached for up to 30 seconds; this freshness allowance never permits reading another account's data or accessing a removed document. Detail reads return the current document state.

Lifecycle vocabulary: `queued`, `processing`, `ready`, `reviewed`, `deleted`. New documents start queued. A completed extraction normally becomes ready, a correction becomes reviewed, and deletion removes the document from API reads. Reprocessing requests are explicit new work.

Errors: 400 invalid input, 401 invalid/missing credential, 404 missing/inaccessible document, 409 stale correction, 413 oversized body, 500 unexpected server error. Error bodies have an `error` message. These are the intended contracts; the challenge concerns reports where current behavior diverges.
