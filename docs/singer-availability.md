# Singer availability

In **Singers**, the host can mark a singer unavailable for a whole number of minutes from 1 to 60, or choose **Return now**. The experimental local singer page offers the same controls for the authenticated singer's own identity. Return times are persisted by the host, so restarting does not clear an absence. The UI shows the remaining minutes.

While unavailable, a singer can have at most one upcoming request (pending, accepted or staged), even when the general request limit is unlimited. Requests already present are retained; if there is more than one, further additions are blocked. This limit applies per singer identity, not per physical person.

Available singers are scheduled ahead of unavailable ones; absent singers are listed by expected return time. On return or deadline expiry the singer resumes their existing FIFO/fair-rotation position, subject to an explicit manual order and the staged-song lock. The host still stages and starts performances; expiry never starts playback or replaces a staged song. It cannot estimate how many songs will fit before someone returns.

A singer cannot mark themselves away while their request is staged or playing. The host may explicitly confirm release of a staged song before marking that singer away. Marking the current performer away from the host only affects future requests; their current song keeps playing. Other singers and guests cannot change this singer's availability.

The local service validates 0–60 integer minutes, uses the host clock, and derives singer identity from authentication. Zero means return now. Guest commands have durable idempotent receipts: after a connection failure, use **Check outcome** before another change. The deadline is private to the relevant guest projection; the host receives full show state. A secure public internet relay and native mobile connection remain separate unfinished work.
