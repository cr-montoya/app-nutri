# ADR-0001: Password hashing library (@node-rs/argon2)

## Status

Accepted

## Date

2026-08-23

## Context

`plan.md` §6 mandates argon2id for password hashing but doesn't name a specific library; that choice fell to the `phase-0-scaffold` design. AppNutri deploys to Vercel serverless/edge functions, which makes the choice non-obvious: the most common Node argon2 binding relies on native compilation and prebuilt binaries per platform, which has a history of cold-start and build-compatibility issues in serverless environments specifically.

## Decision

Use `@node-rs/argon2` for password hashing.

## Alternatives considered

- **`argon2` (the standard npm package)**: the most widely used Node argon2 binding, mature and well-documented. Loses because its native bindings are more prone to build failures and cold-start overhead in serverless/edge deployment targets like Vercel, exactly the environment this project deploys to.
- **`@oslojs/password` / Oslo's password utilities**: pure JS/WASM, appealing for edge-compatibility, part of a toolkit already popular in the Lucia-auth ecosystem. Loses on maturity specifically for argon2id: less production track record for this exact algorithm compared to `@node-rs/argon2`'s napi-rs-based binaries, which are widely used in production Next.js/Vercel deployments today.

## Consequences

Hashing becomes straightforward to call from Server Actions and Auth.js callbacks with prebuilt binaries for the platforms Vercel builds on, with no native build step to babysit in CI. The trade-off accepted: a dependency on napi-rs's binary distribution model, meaning if Vercel ever changes its underlying runtime architecture in a way `@node-rs/argon2` doesn't ship a binary for, hashing would need to be revisited; this risk is judged low given the package's current adoption.

## Related

Spec: `.kiro/specs/phase-0-scaffold/`.
