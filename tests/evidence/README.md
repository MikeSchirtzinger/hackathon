# Demo integration evidence

The calendar, write and audio implementation was tested at `2ffdcc1b375a3693aabf159b3c6316690b97c9f5`. The teammate logo and workspace setup were merged from `dbb47bae4d128edf211cde974bf2d51050de452d`. After correcting the final hosted-consent guard, `npm run verify`, all foundation checks and all hosted checks passed at `5e134a9cb3ba2a0656792a0bef55a0b9bbd49848`. The final evidence/docs commit changes no runtime code.

| Command | Measured result | Receipt |
| --- | --- | --- |
| `npm run verify` | TypeScript, 11 focused tests, build, inherited syntax and 362 local assets passed | `final-build.json` |
| `npm run test:foundation` | 13 real browser checks passed, including notification and restart persistence | `foundation-final.json` |
| `npm run test:demo` | Eight real integration checks passed | `demo-browser.json` |
| `npm run test:hosted` | Five real hosted-analysis checks passed | `hosted-browser.json` |

Browser commands used Chrome for Testing 151.0.7922.34 through `CHROME_PATH`. The demo and hosted checks require an authorized `AMBIGUOUS_API_KEY` in the test process. They enter it through Settings. No key is bundled or written to these reports. The demo check creates a note document and task in the receiving workspace; the hosted check submits saved evidence for actual analysis. Run these checks only against a workspace authorized for those operations.

The demo report contains real HTTP create/readback receipts, the imported event and reminder, and the actual transcript produced from the documented LibriSpeech clip playing inside the Jitsi document. It also records Jitsi's own service-worker traffic separately from extension traffic. `probe-history.json` retains the failed probes and their corrections.

The hosted report contains actual response text, accepted proposals, evidence IDs, and returned tool activity. It omits provider internal reasoning. The simultaneous-request check submitted two requests for one target and observed exactly one Assistant HTTP request. The meeting check supplied a saved absence interval and retained the returned timing limitation.

`final-build.json` records the tested implementation, merged base, packaging head and file hashes. The only changed file in the earlier demo report's source map is the inherited manifest's new icon declarations. All final hosted source hashes match the corrected implementation. An earlier rerun received HTTP 504 and accepted no proposal; `hosted-http504.json` retains that failure beside the successful fresh attempt. Model checks were not repeated solely for that branding change.

Live meeting participant delivery, BlackHole routing, autonomous Takeover, managed coworker execution, and absence-aligned missed-item attribution remain unverified or unavailable. The hosted UI uses the saved workspace key; separate per-agent execution evidence is maintained by the workspace setup.
