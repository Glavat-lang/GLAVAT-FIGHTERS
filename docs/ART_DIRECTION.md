# GLAVAT FIGHTERS — visual and animation direction

This is the art acceptance brief for the existing game. The visual target is the saved Library reference images:

- “Пиксельная битва на неоновой крыше.png” — rooftop sunset composition and HUD.
- “Пиксельная битва на закате.png” — sunset palette, skyline and character silhouettes.
- “Ночная битва на крыше: GLAVAT против KILLA.png” — night rooftop palette and moonlit skyline.

These images define the direction; they are not production-ready game assets and must not be displayed as the live match background.

## Core look

- Widescreen 16:9 side-view fighting game, crisp 16-bit/arcade pixel art.
- Strong pixel clusters, deliberate dithering, readable silhouettes, controlled highlights and deep shadows. No blurry vector gradients pretending to be pixel art.
- GLAVAT: black cap, dark hoodie/jacket, dark loose trousers and light sneakers.
- KILLA: short brown hair, red hoodie/jacket, light shirt, dark loose trousers and light sneakers.
- HUD across the top: fighter portrait/name, health bar, super meter, central 99 timer. Keep UI legible and consistent across arenas.
- Mobile controls remain separate overlay elements and must not be baked into arena art.

## Rooftop sunset arena

- Industrial city rooftop at dusk, large orange sun behind a layered city skyline.
- Chain-link fence and steel posts across the midground.
- Left-side concrete wall with GLAVAT FIGHTERS graffiti and crown motif.
- Right-side neon sign, rooftop machinery, barrels and crates.
- Helicopter silhouette with a moving searchlight.
- Wet reflective roof surface with orange, magenta and blue light reflections.
- No country house, glass terrace, pergola or garden furniture. Those elements do not match the saved game reference.

## Rooftop night arena

- Same readable rooftop geography, but a distinct night scene.
- Large moon, deep navy/purple sky, illuminated skyline, red/pink neon sign and cool blue reflections.
- Helicopter/searchlight remains a recognizable animated landmark.
- Do not simply recolor the sunset screenshot; change the lighting, sky, windows and reflections.

## Layer and animation requirements

The current sprite atlas still composes 17 poses from reusable body/arm/leg symbols and transforms; this is a prototype atlas, not the accepted frame-by-frame deliverable. GLAVAT/KILLA colors and the second fighter name have been aligned to the reference, but the actual character drawings still need a full redraw to match the silhouettes and clothing in the reference.

Final backgrounds must be delivered as separable layers: sky, far skyline, midground buildings, rooftop architecture, fence, foreground props, lighting/reflection overlays. Each layer must have documented dimensions, origin and parallax factor. Animated elements (clouds, helicopter rotor/searchlight, neon flicker, window lights and water/reflections where applicable) must be independent from the static base layers.

## Fighter animation acceptance

Each fighter needs at least 25 genuinely unique, hand-authored frame images, not duplicated poses, CSS transforms or repeated frames with timing changes. Required motion coverage:

1. idle loop
2. walk forward/backward
3. run
4. crouch and stand
5. jump rise, apex and landing
6. light punch
7. heavy punch
8. light kick
9. heavy kick
10. block high/low
11. hit reaction
12. knockback/fall
13. get-up
14. throw/grab
15. dodge
16. counter
17. special/super startup
18. special/super active
19. special/super recovery
20. victory
21. defeat/KO
22. turn/face change
23. guard break/stagger
24. attack recovery/cancel transition
25. round intro/taunt

The animation manifest must define frame order, per-frame duration, origin/foot anchor, hitbox/hurtbox and active-frame events. Attack active frames must be synchronized to server-authoritative combat windows.

## Release gate

Canvas scene code can be used for temporary layout and testing, but the art row remains open until original layered pixel assets and complete 25-frame fighter sets are integrated, inspected at game resolution and verified in motion.


## Automated asset gate

- `npm run audit:animations` reports the current atlas frame count, standalone drawing count, duplicate count and symbol-composed pose count. CI runs this non-strict audit. The latest passing run (42323500299, #646) reported 17/25 poses, zero standalone drawings and zero unique standalone frames for both fighters.
- `npm run audit:arenas` reports whether all six arenas have the eight required independent image layers.
- `npm run release:animations` requires at least 25 unique standalone frame drawings per fighter and exits non-zero otherwise.
- `npm run release:arenas` requires all six complete layered pixel-art environments.
- `npm run release:verify` runs project validation, the full test suite and both strict art gates. It is expected to fail until the final fighter and arena art is integrated.
