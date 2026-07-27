# Context

## Scan plan

A scan plan is the compiled DOM work for the profiles matching the current page. It
holds PII, media, rule and conditional-rule work with precomputed blur radii and
source IDs, so mutation handling does not repeatedly derive the same configuration.
