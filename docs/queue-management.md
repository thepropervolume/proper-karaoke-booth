# Queue Management

Version 0.7.0 automatically stages the next eligible approved request. Auto-approval is enabled by default; with manual moderation, pending requests wait for Accept. Staging prepares the selected turn without starting audio. The host presses **Play/Pause** to start or resume; there is no routine Stage Next step.

With automatic advancement enabled, natural completion or confirmed Skip starts the next eligible performance after the configured gap and media preparation. Stop, Pause, errors and device/display-loss recovery cancel delayed starts. Launch/restart never starts karaoke, even when requests are queued or downloads finish. A failed download or missing source retains the staged turn for Retry/Relink. See [playback controls](playback-controls.md).

The host may reorder accepted waiting requests, promote a waiting singer or restore automatic FIFO/fair order. A staged request keeps its slot and cannot be silently displaced by a late request, mode switch, reorder or policy change. Edit its track or singer on that same staged request: its request ID and staged status remain. Active playing requests cannot be edited. Explicit Release remains an authority operation and suspends automatic staging until Play.

Track changes must satisfy policy. Singer reassignment respects the destination's request limit and next free fair round while preserving an explicit manual position. Edits consume no turn and never rewrite performance history. Stop returns the current performance to the queue; a later staged turn remains locked, so the stopped item is not guaranteed to become the next selection.

Timed absence accepts 1–60 whole minutes and permits at most one future request while away; existing extras remain but block additions. Available singers are eligible first. Saved return times restore existing FIFO/fair order subject to manual order and staged lock. The host may need to confirm staged release before marking a singer away. Duets/groups, indefinite holds, explicit skip-turn policy, approximate waits and a fuller edit audit remain planned.

Commands persist through the single host authority. Snapshot validation accepts older shows without manual order, rejects repeated/unknown/terminal order IDs and retains the active slot when Stop makes it waiting again. Stale completion callbacks cannot consume a newer turn.
