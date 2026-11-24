# MeetGuru auth-js vendor

Pinned package: `@supabase/auth-js@2.119.2-meetguru.1`, based on upstream 2.119.2.

`../auth-js-2.119.2-meetguru.1.tgz` is the application dependency selected by the root npm override. The root lockfile records its relative path and SHA-512 integrity. `npm ci` installs it directly; no postinstall patching, registry publishing or runtime monkey-patch is used.

`meetguru.patch` combines the reviewed terminal cleanup write lock, explicit logout/no-Web-Locks handling, and superseded-refresh cancellation. `upstream/auth-js-2.119.2.tgz` is the original published source archive, verified against npm integrity. The upstream MIT license is retained. `manifest.json` pins the source/patch/build inputs and resulting tarball checksums.

To rebuild, use Node 24.14.0, Python 3 and Git:

```sh
python3 vendor/auth-js/rebuild.py /path/to/new-output.tgz
```

The output must not already exist. The script uses a fresh temporary directory, installs the exact isolated toolchain with npm ci, applies the patch to extracted source, compiles CJS/ESM and verifies the resulting archive against the manifest. It does not modify the installed SDK or application dependencies. Network access is needed only for the pinned compiler toolchain; upstream source is included locally. Two independent rebuilds must produce the same SHA-256.

The TypeScript configuration comes from the upstream supabase-js v2.119.2 monorepo; only the SDK tsconfig extends path is adjusted for standalone layout. Compiler: TypeScript 5.8.3, @types/node 20.19.9, tslib 2.8.1. These are separate build inputs, not new application dependencies.

This package preserves server token verification and RLS. It remains a maintained source fork; upstream upgrades require reviewing the patch and repeating the Auth regression matrix. Do not upload this tarball as a replacement official Supabase package.
