# Welcome Image Production Validation

Run this protocol only on a disposable production-like Linux environment.

## Docker / Pterodactyl checklist

1. Use Node.js 22 on Linux x64.
2. Run `npm ci --ignore-scripts` from a clean workspace.
3. Run the Welcome Image Foundation tests.
4. Start CIVRAT with a Discord test guild and valid environment secrets.
5. Open `/settings`, navigate to Welcome & Goodbye, and request an image preview.
6. Confirm that the preview is ephemeral and is a valid PNG attachment.
7. Repeat the preview at least 25 times while observing process memory.
8. Confirm that no generated PNG is written to disk, Supabase Storage, or MongoDB.
9. Confirm French and English preview messages.
10. Record Node version, container image, Pterodactyl egg/version, peak memory, and outcome.
