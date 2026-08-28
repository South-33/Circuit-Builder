# Harness experiment rationale

The current experiment separates three questions that were previously mixed together:

1. Can a strong model produce coherent 2D geometry itself when the action language is small and discrete?
2. Does seeing and replacing one holistic blueprint help spatial consistency?
3. Is it better for the model to state relationships while deterministic code solves coordinates and routes?

That maps to Harness A, B, and C respectively. The legacy interface remains as the control.

## Why the grid is shared

A coarse discrete planning grid removes unnecessary floating-point/pixel bookkeeping and gives all harnesses the same layout world. One planning cell is 32 px. Physical pins, breadboard holes, visible dots, and Harness C wire lanes stay on the separate 9.6 px connector lattice. Components occupy known rotated planning footprints while endpoints keep exact physical geometry. This makes the comparison about action-space design rather than different renderers or accidental snapping errors.

## Why ASCII is observation, not cell painting

A compact text map gives the model a global spatial view and lets it reason about empty lanes, footprints, and crossings. The action APIs still operate on parts, relations, and route points. Requiring the model to emit every occupied cell would turn layout into bookkeeping and make long wires unnecessarily expensive.

## Why routing is only automatic in C

A and B are intentionally model-controlled geometry baselines. C asks whether a circuit-specific solver can remove a task that is already deterministic: obstacle-aware orthogonal cable routing. The router is scored by the same independent `evaluateLayout()` used for every profile.

## Visual feedback comes later

Rendered feedback is useful, but it is a separate variable. First compare the three action spaces without adding a custom visual-refinement loop. Then take the best two and compare no visual feedback, one rendered correction pass, and at most a few scored correction passes with rollback.

This keeps the result interpretable. Otherwise a better result could come from the action space, the number of retries, or the visual critic, and we would not know which one mattered.
