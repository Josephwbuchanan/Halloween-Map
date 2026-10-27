# Verification notes — October 27, 2026

Confirmed against the configured Supabase project:
- Anonymous sign-ins are enabled and work.
- Creating a stop without time fields succeeds.
- Another anonymous family session can update the shared visited flag.
- The change is delivered to another session through Supabase Realtime.
- A different visitor cannot delete the creator's stop.
- Invite-only crew creation and joining work.
- An uninvited session cannot read the private crew.
- A joined session can read its crew.
- Only the creator can finish the crew's night.
- Temporary stop data was removed. One finished, empty verification crew remains; it has no GPS route points. Verification created temporary anonymous sessions.

The app explicitly supplies the visitor's access token to Realtime and updates it on token refresh. The public project key is never treated as a user JWT.

Local checks:
- JavaScript syntax checks passed.
- 100 unique automatic stop names and exhaustion behavior checked.
- All seven category combinations checked: purple > green > orange.
- Multi-select category filters checked in the browser.
- Individual home matching, polygon holes, distance limits, and splitting tile-wide MultiPolygons checked.
- Street-network paths follow corners; disconnected roads, off-street fixes, and footpaths do not get coverage.
- Small GPS gaps can join, while long gaps, GPS jumps, different phones, and separate pause/resume runs stay separate.
- Phone layouts, continuous black street coverage, labels above coverage, and persistent Pause/Resume controls inspected.

Still required before Halloween:
- GitHub Pages publication.
- A real two-phone walking test for GPS accuracy, route insert/stream behavior, pause/resume, lost connections, and screen locking.
- No real GPS location was collected during automated verification.
