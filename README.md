# GLAVAT FIGHTERS

A fresh, mobile-first online 1v1 cartoon stickman fighting game.

## Play online

Open the public game link on two phones:

https://tlhgtvrimqrqfjjtotvu.supabase.co/functions/v1/glavat-fighters

One player creates a room and shares the invite code/link. The other player joins with that code.

## Controls

- Mobile: on-screen buttons for movement, jump, attack and block.
- Desktop: arrows or A/D to move, W/Up to jump, Space/J to attack, K/Shift to block.

## Technology

- HTML5 Canvas rendering and responsive touch controls.
- Supabase Edge Function serves the game page.
- Supabase Realtime Presence manages two-player rooms.
- Supabase Realtime Broadcast synchronizes inputs and the host-authoritative fight state.

The game uses the existing GLAVAT Supabase project only for Realtime channels; it does not create or modify application database tables.

## Run locally

```bash
npx serve public
```

Open the local address in two browser windows/devices. The online room service still uses Supabase Realtime.
