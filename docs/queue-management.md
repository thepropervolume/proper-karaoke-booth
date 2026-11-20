# Queue Management

Version 0.7.1 allows the host to queue a song with no singer. The request stores `singerId: null`, the host queue labels it **Unassigned**, and playback does not require a placeholder singer. Host/staff request commands may use null; only the host may later assign or clear an eligible request. Remote singer commands remain bound to their own singer identity.

The application automatically stages the next eligible approved request. Auto-approval is enabled by default; with manual moderation, pending requests wait for Accept. Staging prepares the selected turn without starting audio. The host presses **Play/Pause** to start or resume; there is no routine Stage Next step.

With automatic advancement enabled, natural completion or confirmed Skip starts the next eligible performance after the configured gap and media preparation. Stop, Pause, errors and device/display-loss recovery cancel delayed starts. Launch/restart never starts karaoke, even when requests are queued or downloads finish. A failed download or missing source retains the staged turn for Retry/Relink. See [playback controls](playback-controls.md).

The host may reorder queued requests, promote a waiting singer or restore automatic FIFO/fair order. Preparation does not lock a queued song: the host can change its place, edit its track or singer, or remove it before playback. Edits retain the request ID, and changing the next song does not start it. Changes during background Start checks cancel an obsolete start; review the queue and press Play again. Active performances cannot be edited.

Unassigned requests each receive an independent FIFO place in the current eligible fair round, or the next round once the final turn has begun. They share no singer profile, availability deadline or per-singer future-request limit. Assigning one to a singer rechecks that singer’s limits and fair round; clearing an assignment restores an independent slot without changing an explicit manual position or staged request ID.

Track changes must satisfy policy. Singer reassignment respects the destination's request limit and next free fair round while preserving an explicit manual position. Edits consume no turn and never rewrite performance history. Completed unassigned performances retain a null singer identity in schema-5 history. Stop returns the current performance to the queue.

Timed absence accepts 1–60 whole minutes and permits at most one future request while away; existing extras remain but block additions. Available singers are eligible first. Saved return times restore eligibility under the FIFO/fair and manual-order rules. A prepared song does not prevent its singer from marking themselves away. Two-singer duets and approximate waits are supported; larger groups, indefinite holds, explicit skip-turn policy and a fuller edit audit remain planned.

Commands persist through the single host authority. Snapshot validation accepts older shows without manual order, rejects repeated/unknown/terminal order IDs and retains the active slot when Stop makes it waiting again. Stale completion callbacks cannot consume a newer turn.
