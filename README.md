# ArrowBrooke Halloween Map

A separate, mobile-friendly neighborhood Halloween map. Residents can search and filter participating homes, get walking directions, share the map, and submit their own house. There are no crews, route trails, or visited/completed controls.

## Neighborhood addresses

The map's searchable house numbers come from the OpenAddresses Denton County export, whose source is Denton County GIS. `arrowbrooke-addresses.geojson` is clipped to the map boundary and contains only house number, street, and coordinates. It does not include resident names, ownership, values, contact details, or the rest of the county dataset. Address-label coordinates are snapped to matched Overture building centers; any remaining visible labels are matched to loaded base-map buildings in the browser.

The preparation script excludes address points outside the full four-sided clear/fog boundary and the small set of known non-home roadway/common-area records listed in `scripts/snap-addresses-to-buildings.mjs`.

Residents can find a home by typing its address or by placing a pin. Both paths resolve to a verified address in the neighborhood list and let the resident confirm the location before submitting it. Only one listing per verified address is allowed for each event.

The database independently enforces that same address list with `supabase-address-validation.sql`. It replaces submitted address text and coordinates with the canonical record, rejects unknown addresses or event dates, and closes 2026 submissions at midnight Central Time on November 1. Regenerate the SQL after any address-file change with `node scripts/generate-verified-addresses-sql.mjs`, then run it in the Supabase SQL Editor.

## Neighborhood buildings

`arrowbrooke-buildings.geojson` supplements the base map with geometry-only building footprints from the Overture Maps 2026-10-21 release. Overture records sourced from OpenStreetMap are excluded because the base map already draws them; this prevents overlapping transparent fills from changing the original building color. The remaining supplemental footprints use the same styling and home-highlighting behavior as the existing buildings. Overture Maps building data is licensed under ODbL.

Some newly developed southwest streets have public address points but no footprint geometry in either Overture or the base map. For those streets, the file also contains approximate rectangular footprints centered on the public address points and aligned with neighboring addresses. These estimates are for map display and address selection only; they are not survey-grade building outlines. Regenerate them with `node scripts/add-estimated-building-footprints.mjs` after preparing the Overture file.

Run `node scripts/snap-addresses-to-buildings.mjs --buildings path/to/overture-buildings.geojson --write` after replacing either source dataset to audit and refresh the stored address-label positions.

## Submission workflow

Verified homes appear immediately after submission. The database enforces one listing per address and event, and the organizer can review or remove entries in the Supabase Table Editor:

1. Open **Table Editor → stops**.
2. Check the address, map coordinates, categories, and notes.
3. Delete an invalid entry or change `approval_status` to `rejected` to hide it.

Residents cannot replace an existing listing for the same home. Display colors are orange for candy only, yellow whenever non-food treats are selected without adult treats, purple whenever adult treats are selected with fewer than all three offerings, and green when all three offerings are selected.

## Organizer mode

The public map includes a password-only **Organizer login**. It signs in through a dedicated Supabase Auth account; the password is never stored in this repository. The organizer session uses browser session storage and ends when the browser tab or window is closed.

After signing in, select a participating home on the map to change its display name, notes, or offerings, or remove it from the public map. Run `supabase-organizer-setup.sql` once after creating and confirming the dedicated organizer account described in `config.js`.

Organizer mode also includes **Export home list (CSV)**. It downloads the current event's approved homes, offerings, notes, timestamps, and coordinates and remembers the last export time on that device.

## Organizer iPhone notifications

The organizer can receive a native iPhone notification whenever a new home is added, without an SMS provider or paid notification app. Web Push works on iOS 16.4 or newer after the website is installed as a Home Screen app.

1. Run `supabase-push-setup.sql` in the Supabase SQL Editor.
2. Deploy `supabase/functions/notify-new-stop` with JWT verification disabled as specified in `supabase/config.toml`.
3. Add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `PUSH_WEBHOOK_SECRET` to the Edge Function secrets. The public key must match `config.js`; never commit the other two values.
4. Create a database webhook for `public.stops` on **Insert**. Point it to the `notify-new-stop` Edge Function and include the same `x-webhook-secret` value in its HTTP headers.
5. On the organizer's iPhone, open the map in Safari, choose **Share → Add to Home Screen**, launch the installed map, sign in as organizer, and tap **Turn on iPhone alerts**.

The subscription table is private to the organizer account. Expired Apple delivery endpoints are removed automatically by the sender function.

## One-time setup

1. Create a new Supabase project for this site. Do not reuse the personal map's project.
2. Enable anonymous sign-ins under **Authentication → Sign In / Providers → Anonymous**.
3. Run `supabase-setup.sql` in the Supabase SQL Editor.
4. Copy the project's public URL and publishable key into `config.js`. Never place a secret or service-role key in the site.
5. Open `?demo=1` locally or on GitHub Pages to preview five sample homes without changing the database.

The neighborhood boundary and starting map position are in `config.js` and `app.js`. The event date is already set to October 31, 2026.

## GitHub Pages without a personal-name URL

Keep this code in a separate repository. For a neutral address, either:

- attach a custom domain to the repository's GitHub Pages settings; or
- publish it from a neutral GitHub organization, such as `arrowbrooke.github.io/halloween-map`.

GitHub Pages can enforce HTTPS after the custom domain is connected. Add the domain to the Pages settings before creating a `CNAME` file so GitHub records the correct DNS instructions.

## Privacy

Addresses and notes for approved homes are public to anyone with the link. The form tells residents to submit only a home they are authorized to list. Anonymous ownership lets a resident remove their approved home from the same browser, while the organizer can moderate every record in Supabase.
