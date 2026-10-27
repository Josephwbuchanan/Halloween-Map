# ArrowBrooke After Dark 🎃

A mobile-first neighborhood Halloween map for ArrowBrooke in Aubrey, Texas. Familiar map controls, search, category chips, and a bottom details card. Built with Leaflet, MapLibre, and OpenFreeMap vector tiles in a custom slate-lavender/orange map palette and purple controls; Google Maps opens for walking directions.

- Orange pins: kids’ candy
- Purple pins: adult treats
- Green pins: decorations
- Multi-category stops, optional names and notes, precise map placement
- Group visited checkoffs, shared across the crew through the database
- The three-family crew can contribute without an email/password, using Supabase anonymous sign-in
- New shared stops and visited checkoffs appear through Supabase Realtime, with a 30-second refresh fallback
- Contributors can remove their own stops on the same browser
- Share the whole map or a specific stop

## Finish the shared database setup

GitHub Pages hosts the app; Supabase stores the shared pins. The unconfigured app clearly shows setup in progress and does not pretend that locally saved pins are shared.

1. Create a Supabase project at https://supabase.com/dashboard (signing in with GitHub is an option).
2. Open its SQL Editor. Paste and run `supabase-setup.sql`.
3. Under Authentication → Sign In / Providers, enable anonymous sign-ins.
4. Find the project URL and publishable key in the project's Connect / API settings.
5. Add those two PUBLIC values to `config.js` as `supabaseUrl` and `supabaseKey`.
6. Never use a secret key, service_role key, database password, or access token in the app or repository.
7. Commit the updated configuration, open the site on two phones, and add a stop on one. It should appear on the other without a reload.

The SQL enables row-level security: everyone can read stops, authenticated anonymous users can create their own stops, and only the same user can remove their stops. Authenticated visitors can update only the shared visited flag. The organizer can remove inappropriate stops through the Supabase dashboard. There is a cap of 12 stops per anonymous visitor per event. For a wider public launch, consider adding bot protection; the app currently assumes a neighborhood audience.

Anonymous ownership lasts only while the browser retains its session. Clearing browser data loses stop ownership; shared visited progress remains in the database. Stop addresses and notes are public; submit only authorized participating locations.

## Publish on GitHub Pages

1. Put these files and the `vendor` folder in the root of the `main` branch.
2. In the repository, open Settings → Pages.
3. Choose Deploy from a branch → main → /(root) → Save.
4. Wait for the Pages deployment to succeed. The expected URL is:
   https://josephwbuchanan.github.io/Halloween-Map/

All asset links are relative, so the app works under the repository's Pages subpath. No build step, API map key, package install, or paid Google Maps account is required. Street tiles require an internet connection. The primary map uses OpenFreeMap vector tiles with OpenMapTiles/OpenStreetMap attribution. Older phones without WebGL fall back to OpenStreetMap raster tiles. Keep all attribution visible. No offline tile prefetching is used.

## Preview

Serve the folder with a local HTTP server. Open the normal URL to see the real empty/setup state. Add `?demo=1` for five clearly labeled SAMPLE stops. Demo additions exist only in that page session and never reach the live database. Demo and real visited lists are separate.

The initial view centers on ArrowBrooke at approximately 33.2475, -96.9025. It is not a surveyed subdivision boundary. Placement is restricted to a bounding area around the neighborhood. Adjust the center/zoom in `config.js` if desired, and the matching client/SQL bounds if needed.

## Change the event year

Change `eventDate` in `config.js`. Shared stops are queried for that date, and a fresh local visited list is used. The app does not ask for or display start/end times.

## Dependencies and licenses

Leaflet 1.9.4 (BSD-2-Clause), MapLibre GL JS 4.7.1 (BSD-3-Clause), MapLibre GL Leaflet 0.1.4 (ISC), and Supabase JS 2.49.8 (MIT) are vendored with their licenses. The customized map style is derived from OpenFreeMap Liberty. Street tiles: © OpenStreetMap contributors. Google Fonts supplies DM Sans and Outfit with system font fallbacks.

Useful documentation:
- https://leafletjs.com/examples/quick-start/
- https://supabase.com/docs/guides/auth/auth-anonymous
- https://supabase.com/docs/guides/realtime/postgres-changes
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## Family outing workflow

This map is designed for three families walking together. One shared visited flag per stop keeps the crew in sync. The map URL is shareable and does not enforce a private family allowlist; anyone with access can view stops, and anonymous authenticated users can add stops and toggle visits. Do not store private family details.

Stop names are optional. The app chooses an unused name from 100 Halloween names in stop-names.js when blank; after all 100 are used, it adds numeric suffixes. Custom names are preserved. Selection checks currently loaded stops; simultaneous submissions can still choose the same name.

After confirming a pin, the app requests an address suggestion from Photon (OpenStreetMap data). The pin coordinates are sent to the configured provider; stop names, notes, and manually entered addresses are not. Suggestions are editable and may omit the house number or reference a nearby home. The app never invents a missing number. It preserves manually entered addresses. Requests happen only after confirming a pin, and results are cached on the device for seven days.

The endpoint in config.js can be changed or blanked to disable lookup. The default uses Photon's public demo service for light use; it has no availability guarantee. For higher traffic, use a hosted provider or private Photon instance. Manual address entry always works. See https://github.com/komoot/photon for the service's terms and documentation.

If you already ran the earlier database setup, rerun supabase-setup.sql to add the shared visited column and its limited update policy.

## Colored house footprints

At close zoom (17+), stops color a nearby individual building footprint, with a quiet Halloween glow. Each house uses one color with priority: purple (adult treats), then green (decorations), then orange (candy). All selected categories remain listed in its details. Visited homes fade and gain a small checkmark. Zooming out switches to compact colored dots. Missing building footprints retain slender coffin pins. The house shapes come from currently loaded OpenFreeMap vector tiles and are matched within 18 meters of the pin; position the pin on the correct house. Demo coordinates are approximate and allow a wider 65-meter association purely for the sample view. Large MultiPolygon tile features are split into their individual buildings before selection.
## Shared haunted trail

- Start our night creates an invite-only crew trail. Invite shares a link/code with the other families. Joining explicitly requests location permission; there is no automatic location recording just from opening the map.
- All participating phones contribute to the same covered-street layer. Routes are restricted to joined members through Supabase row-level security, unlike the publicly shareable stop list.
- Pause trail stays visible above the map. It pauses only that phone. Resume starts a new run and never paints across the detour or pause.
- The creator can Finish for the crew. The route remains viewable. Already captured offline points can upload if they predate the finish time.
- Ink black is the default street coverage color, with a faint ember glow. The color button toggles crimson for comparison. This preference is local to each phone.
- Coverage traces mapped streets only, including their corners. It never falls back to a freehand straight line across lots, disconnected roads, or missing street data. Footpaths and driveway/parking-aisle classifications are excluded.
- The coverage layer is below street-name labels and replaces the orange color of covered portions. Continuous runs are merged into continuous lines.
- Fixes worse than 40 meters are ignored; fixes more than 25 meters from a mapped street are not recorded. Small interruptions of up to 90 seconds and 45 meters may connect using the actual road network; long interruptions and apparent speeds over 5 m/s split the trail. Pauses always split, regardless of gap size.
- Unsynced fixes are cached on the phone, with a 2,000-point limit. The server accepts delayed fixes up to 48 hours old. Browser screen locking/backgrounding can interrupt GPS: keep the map open while walking. Opening the app again requires Resume to record again.
- The demo Start our night button plays a labeled sample route. It does not request, record, or upload real GPS data.

Run trail-setup.sql after supabase-setup.sql to create the crew, membership, route tables, restricted policies, join/create functions, and Realtime publication. Cross-device behavior and SQL execution remain unverified until the shared database is connected. Test with two phones before Halloween.

## Combined category filters

Category buttons toggle independently. Selecting candy and adult treats shows stops offering either category; selecting all three shows every category. All stops clears the selected categories. A home's color still follows purple > green > orange, regardless of active filters.
