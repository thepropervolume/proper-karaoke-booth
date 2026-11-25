# Desktop room media and moderation

## Current desktop behavior

- The LAN singer API and internet relay both authenticate a room guest before forwarding applause or a photo to the desktop host. They use the same show authority. The relay sign-in pilot verifies a Booth account separately. A room guest still joins by display name and gets a show-scoped singer ID. The desktop has no verified account-to-singer mapping.
- A guest JPEG or PNG is reduced to JPEG in the sender and checked and re-encoded by the desktop. Host ingress bounds the payload to 256 KiB and each dimension to 1280 pixels. Desktop sends a valid image directly to the singer renderer and can open its window in the process. One photo can appear at a time for about ten seconds. The host records the 24-point award once, after the renderer acknowledges adding the decoded image and the guest is still authorized. The show database keeps the digest, receipt and point event. Desktop has no photo approval list or retained image library.
- The host preview and enabled LAN and internet mirrors capture the same display. Revocation blocks further commands, but an image already shown can remain until the display timer expires. Frames already received by viewers can be copied. The current relay permits one outstanding photo per room and allows up to 15 seconds for the photo RPC to return.

## Proposed verified profile photos

Add an optional account-linked join flow alongside ordinary guest join. The relay issues a short-lived, single-use grant derived from a verified account session and bound to the room, room generation, join ID and resume proof. The host trusts only the relay’s attested account subject. It binds that subject to a local singer ID and verifies show and room scope on resume. The authenticated account and the display name serve separate purposes.

Associate the avatar with the verified subject using an opaque asset ID and version. Decode, resize and re-encode uploads before storage. Require the singer to choose whether the avatar may appear at the venue and in the internet mirror. Authorize each fetch for its intended audience. Clear the display and invalidate its capture when the singer removes consent or the account binding ends. Guests, older clients and avatar lookup failures fall back to initials or the standard placeholder. Keep account tokens, email addresses and private profile data out of room replies and screen frames.

## Proposed retained guest photos

Split submission from display. Return a room-scoped receipt as soon as validation succeeds so the host can review without holding a relay request open. Give the host explicit **Approve and show**, **Reject** and **Clear from screen** actions. Bind pending images, renderer acknowledgements and clear events to the submission ID and room generation. Verify the scope again when the host approves and when the renderer acknowledges. Award points once for a successfully displayed image. Default to a temporary image with an expiry for pending review.

Offer retention as a separate opt-in for the host and submitting singer. Store sanitized copies in a private media store keyed by opaque photo ID, with a deletion deadline. Show receipts can refer to that ID and record review status without embedding the image in SQLite. Provide host deletion and cleanup of expired content. Cancel pending decode and clear the overlay on revocation, room end, display replacement, restore and quit. Invalidate captured frames when the overlay clears and expire the relay’s last frame promptly. Tell the singer which display audiences can see the image before submission.

## Proposed moderator controls

Give the host a room-scoped grant and revocation workflow for verified members. Define specific permissions such as approving or rejecting song requests and reviewing photos. Authorize each action at the host boundary and recheck the grant at commit, including for requests that wait on the display. Record idempotent, redacted audit events with the actor, room generation, action, target and outcome. Keep playback, provider credentials, private singer notes and role assignment with the host authority. Ordinary guest sessions retain the existing singer permissions.

Test matching names on unrelated accounts, cross-room and replayed grants, revoked access during an approval, and old clients using normal guest join. Test malformed images, opt-out and deletion, interrupted review, duplicate awards, stale renderer acknowledgements, and overlay cleanup in the host preview and both mirrors. Verify that logs, show backups and guest responses exclude photos and account credentials.
