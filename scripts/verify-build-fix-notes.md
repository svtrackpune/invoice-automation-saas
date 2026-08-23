PR #24 CI failure was isolated to TypeScript inference in collections/page.tsx.

Failure:
Object is possibly 'undefined' in the priority sort map.

Fix applied:
- Added explicit Row type.
- Typed priority as Row['priority'].
- This removes the implicit/undefined index inference from the inline priority maps.

Next step: GitHub Actions should rerun from the new branch commit and validate the full Next.js production build.