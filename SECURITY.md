# Security Policy

## Reporting a vulnerability

Email **hello@flarelink.dev** with `[SECURITY]` in the subject. Please include a description of the issue and its impact, steps to reproduce (or a proof of concept), and which part of the starter is affected.

We'll acknowledge your report, keep you updated as we investigate, and credit you if you'd like. Please give us a reasonable window to ship a fix before public disclosure.

## Scope

This repo is a **starter scaffold** (MIT) — template code meant to be forked and modified. The patterns that matter for security (service key stays server-only, `requireUser` on every mutation, the auth proxy) are documented in [`AGENTS.md`](AGENTS.md). Reports about those patterns or about the Flarelink components the starter uses are welcome.

More on Flarelink's security model at <https://flarelink.dev/trust>.
