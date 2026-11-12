# Taking ownership of Ricori's document service

You are taking over a backend that has grown from a document-processing prototype into a small service used by several test accounts. It accepts synthetic documents, extracts information in the background, and lets people review their records.

The application starts and its normal workflows have tests. Before we build on it, we need someone to investigate a set of inconsistent behaviors reported during testing. You have the source, migrations, documented API and local development setup. There is no external processing provider to configure.

## Notes from support and product testing

> **Support:** "One invoice shows two processing entries even though I submitted it only once. I noticed it after an interrupted session. I could not reproduce it by simply uploading another invoice."

> **Product review:** "I changed an amount and saw the saved confirmation. Later the original amount was back. On another document the correction stayed as expected."

> **QA:** "I opened the same document in two tabs. Both tabs said their changes were saved, but after reopening the document I could only see the amount from one of them."

> **Account testing:** "While switching between our two test accounts, I briefly saw processing information that belonged to the other account. Following the same link in a different session said the document was unavailable."

> **Support:** "I removed an invoice and it disappeared. It later returned to the overview. When I tried to open it, I got a not-found response."

These reports are observations, not diagnoses or a checklist of independent fixes. Establish which conditions matter, investigate whether the reports are related, and make corrections you can substantiate.

## Expected product behavior

People must be able to trust a saved correction. Background activity must not silently undo it. A person can deliberately request fresh processing; explain how your changes distinguish that action from work already under way.

If an edit cannot safely be accepted because the document has changed, tell the caller instead of confirming a save that loses their intent. The request and error contracts are documented in [API.md](API.md).

Each account sees only its own documents and related information. Removing a document makes it unavailable in both the overview and its detail/history views. Removal stays effective while background activity finishes. A new restore feature is outside this assignment.

The activity history and processing total should describe the work actually accepted for that document. Repeated background activity must not make one requested processing operation appear to have happened several times.

## Your assignment

Investigate and explain the relevant causes, implement the corrections you judge appropriate, and demonstrate their behavior with meaningful tests. Preserve ordinary workflows and consider the effects of a change on other components. You may change schema, transactions and internal structure where justified. Explain any deliberate API change and its compatibility consequences.

An incomplete submission with sound investigation, working corrections and clearly stated limitations is acceptable. You do not need to add features or replace the framework. We assess the quality of your reasoning and evidence; code volume, implementation speed and architectural complexity earn no extra credit.

Documentation, search and AI tools are allowed. Describe meaningful assistance and how you checked the result. You remain responsible for understanding your submission. 

See [SUBMISSION.md](SUBMISSION.md) for delivery instructions.
