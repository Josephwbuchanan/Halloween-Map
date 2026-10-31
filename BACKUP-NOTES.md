# Personal Halloween Map backup

Copied October 31, 2026 from Arrowbrooke/Halloween-Map. The neighborhood repository and database were read only and were not modified.

- Personal site: https://josephwbuchanan.github.io/Halloween-Map/
- Personal Supabase project: zskwzqzmmymhdwfcmugw
- Initial snapshot: 114 approved homes for October 31, 2026, plus the verified address catalog.
- This is an independent point-in-time copy, not a live sync. Edits do not propagate between the two sites.
- Old personal source remains recoverable in Git history. Old personal database tables are retained in the private personal_legacy_20261031 schema.
- Imported listings have no visitor ownership in this separate Auth project. Original creator identifiers are preserved privately for provenance.
- Organizer login must be created separately. Passwords, sessions and push subscriptions are not copied.
- Personal push notifications need separate secrets, webhook configuration and subscriptions. vapidPublicKey is deliberately blank until then.
- Arrowbrooke Cloudflare analytics was removed so personal visits do not affect neighborhood statistics.

Never point this backup at the neighborhood database or store private keys in this repository.
