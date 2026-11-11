# Manual queue management

The host may move an accepted waiting request before another waiting request or to the end. The queue records the explicit order in show state; later requests follow that list using the selected FIFO or fair scheduling rules. Automatic order clears the manual order and promotion. An already staged or playing request remains locked.

Waiting requests may change track or singer. Track changes must satisfy the show policy. Moving a request to another singer respects that singer's future-request limit and assigns their next free fair-rotation round; an explicit manual position remains in place. This does not change recorded performance history or consume a turn. Multiple performers on one request remain future work.

The domain commands are host-authorized and persist through the existing single show authority. Snapshot validation accepts older shows with no manual order, rejects repeated/unknown/terminal request IDs, and preserves an active request's slot when Stop makes it waiting again. Reordering does not rewrite previously assigned rounds.
