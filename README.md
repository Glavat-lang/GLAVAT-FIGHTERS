# GLAVAT FIGHTERS

A fresh, mobile-first online 1v1 stickman fighting game. Built from a clean codebase for the GLAVAT FIGHTERS project.

## Play
Open the deployed public URL on two phones. One player creates a room and shares the invite code/link; the other joins with that code.

## Controls
- Desktop: arrows or A/D to move, W/Up to jump, Space/J to attack, K/Shift to block.
- Mobile: on-screen movement, jump, attack and block controls.

## Run locally
```bash
npm install
npm start
``
Then open http://localhost:3000 in two browser windows/devices.

## Stack
- Node.js HTTP server
- WebSocket real-time room and combat state
- Canvas 2D rendering; no frontend build step
- Responsive touch controls for iOS and Android

## Notes
The server runs authoritative movement, attack range, damage, blocking and round state. Rooms support two concurrent players. A disconnected player frees their slot.
