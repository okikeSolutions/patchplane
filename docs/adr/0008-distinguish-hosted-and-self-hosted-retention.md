# Distinguish hosted and self-hosted evidence retention

Accepted during the V2 design interview on 2026-11-22, Q30 and its follow-up: initial Patchplane-hosted evidence storage supports retention up to seven days, with thirty days and longer reserved for a paid offering. Self-hosted open-source installations let their owners configure retention. This introduces a hosted retention distinction without imposing that commercial restriction on self-hosted installations or making paid-plan delivery a prerequisite for initial dogfooding.

Expired evidence must remain visibly unavailable rather than count as inspectable proof. The exact retention of report metadata, deletion timing and backups must be specified separately; this decision does not approve indefinite storage of sensitive evidence inside metadata.

Updated on 2026-11-23: initial hosted retention of seven days applies to both raw evidence artifacts and report metadata (with matching backup cleanup). Paid hosted tiers cover thirty days and longer; self-hosted installations remain owner-configurable.
