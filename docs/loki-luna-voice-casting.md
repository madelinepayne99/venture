# Loki & Luna — Canonical Voice Casting (LOCKED)

**Status: exploratory pilot record, not a live production integration.**
This file documents a founder-approved casting decision for the planned
"Loki & Luna" animated pilot (working title "What's That MOO?"). It is
**not** wired into `lib/media/registry.ts` — Content Bot's real, registered
voice provider remains ElevenLabs (`MEDIA_VOICE_PROVIDER=elevenlabs`), per
CLAUDE.md. `CARTESIA_API_KEY` in `.env.local`/`.env.example` exists only
for the manual scratchpad scripts used during this casting process, exactly
as noted where that key was added. If Cartesia is ever adopted as a real,
second `lib/media` voice provider, that is a separate, explicit architecture
decision requiring its own approval, pricing-table entry, and tests — not
implied by this document.

**Do not change either base voice or its approved settings without explicit
founder approval.** This selection followed an extensive, deliberately
staged $0/sub-$1 audition process (ElevenLabs premade library → ElevenLabs
shared library, three rounds → Cartesia's named "emotion-optimized" voices
→ a broad Cartesia catalog search → Cartesia's Zeke/Avery pairing → targeted
"smoother-timbre" re-casting for Luna → final performance-direction
refinement via lettered treatments). The reasoning behind each rejected
candidate is preserved in session history, not repeated here — this file
records only the final, locked result.

## LUNA

- **Base voice:** Daisy (Cartesia Sonic voice library)
- **Voice ID:** `32b3f3c5-7171-46aa-abe7-b598964aa793`
- **Approved performance reference:** `LUNA-DAISY-F-SOFT-PLAYFUL.mp3`
- **Approved generation settings** (Cartesia `sonic-3`, `generation_config`):
  - `speed: 0.87`
  - `volume: 0.70`
  - `emotion: "amazed"`
- No pitch control was used or is available on this model — do not claim
  or attempt pitch adjustment for Luna.

## LOKI

- **Base voice:** Zeke (Cartesia Sonic voice library)
- **Voice ID:** `e00d0e4c-a5c8-443f-a8a3-473eb9a62355`
- **Approved performance reference:** `LOKI-ZEKE-G-CUTE-CHEEKY.mp3`
- **Approved generation settings** (Cartesia `sonic-3`, `generation_config`):
  - `speed: 0.88`
  - `volume: 0.72`
  - `emotion: "confident"`
- No pitch control was used or is available on this model — do not claim
  or attempt pitch adjustment for Loki.

## Canonical performance direction

Shared (both characters): soft, youthful, warm, playful, naturally
conversational — never narrator, presenter, YouTuber, adult voice-over,
exaggerated/cartoonish, shouted, or squeaky/baby-voiced. Never an
imitation or soundalike of any existing character or performer — Bluey-style
preschool animation is a high-level performance *reference* only.

- **Luna:** smooth, clean, cute, curious, slightly calmer/more grounded
  than Loki.
- **Loki:** cheeky, playful, slightly mischievous, tries to sound braver
  than he feels underneath.

They are siblings and should read as two young characters genuinely
talking to each other — not two voice-over artists independently reading
lines.

## Mechanism for future reuse

Cartesia's TTS request shape is `{ model_id, transcript, voice: { mode:
"id", id }, output_format, generation_config }` — same shape used for
every test clip referenced above. Reproducing either character going
forward means reusing that exact `voice.id` and `generation_config` block;
only `transcript` (the actual line) changes per shot.
