# Cloth simulation: runtime, collision and the Cloth Lab

The garment simulator is an XPBD cloth solver (`src/features/clothing/simulation`) shared by the
studio's pattern editor and a character-agnostic runtime (`src/features/clothing/runtime`) that
dresses arbitrary rigged characters. The Cloth Lab (`src/features/cloth-lab`, nav: **CLOTH LAB**,
deep link `#cloth-lab`) is the test scene for both.

## Update order

One fixed step (60 Hz) always runs, in this order (`ClothLabController.fixedStep`):

1. **Animation**: `CharacterAnimator.step(dt × intensity)` advances the mixer and applies root motion
   to the character container.
2. **Skeleton**: `container.updateMatrixWorld()`.
3. **Body skin**: `CharacterBody.update()` re-skins the collision proxy and pushes the pose to the
   `KinematicBodyCollider` as the end of this step.
4. **Cloth**: `ClothSimulation.step()` runs the XPBD substeps against that pose.
5. **Render** (once per frame): `ClothSimulation.updateRender()` re-embeds the render meshes.

Animation is advanced by the same fixed step as the cloth, so the skin the cloth collides with is
exactly the pose the character was animated to. In the studio, `HumanModel` runs at `useFrame`
priority −2 and the garment hook at −1 for the same reason.

## Public API

```ts
import { prepareCharacter, applyDressingPose } from 'features/clothing/runtime/characterRig'
import { CharacterBody } from 'features/clothing/runtime/characterBody'
import { CharacterAnimator } from 'features/clothing/runtime/characterAnimator'
import { bakeClip } from 'features/clothing/runtime/animationRetarget'
import { measureBody } from 'features/clothing/runtime/bodyMeasurements'
import { buildOutfitDocument } from 'features/clothing/runtime/garmentLibrary'
import { buildBodyDepthMaps } from 'features/clothing/runtime/garmentArrangement'
import { ClothSimulation } from 'features/clothing/runtime/clothSimulation'

const character = prepareCharacter(gltf.scene)          // normalise + analyse the skeleton
const body = new CharacterBody(character)               // collision proxy from all meshes
const animator = new CharacterAnimator(character)
animator.addClip('walk', bakeClip(walkClip, ybotSource, character)!)  // retarget + root motion

applyDressingPose(character); body.update(true)
const m = measureBody(body.vertices, body.vertexPart, character)
const cloth = new ClothSimulation({ quality: 'medium' })
cloth.dress(buildOutfitDocument([{ kind: 'trousers' }, { kind: 'tshirt', fabric: 'jersey' }], m),
  body, buildBodyDepthMaps(body.vertices, body.collider.indices, m.chest.centerZ))
scene.add(character.container, cloth.group)

// every fixed step, once dressed (cloth.dressed):
animator.step(dt); body.update(); cloth.step()
// every frame:
cloth.updateRender()
```

`ClothLabController` wraps exactly this, plus pause / resume / reset / restart, clip switching
(cross-fade, no reset), quality and diagnostics.

## What makes it character-agnostic

- **Skeleton analysis** (`characterRig.ts`) finds hips, spine, chest, neck, arms and legs from
  hierarchy and rest geometry (legs hang below the hips, the spine reaches highest, arms branch
  sideways off the chest). Bone names are only tie-breakers inside a chain. Mixamo (65, 49 and
  23-joint variants), Quaternius (Robot Expressive) and Cesium rigs all resolve.
- **Collision proxy** (`characterBody.ts`) is built from every visible mesh, skinned or rigidly
  bone-parented, clustered per body part (~2 cm) so an arm never webs into the torso, and
  re-skinned on the CPU each step.
- **Retargeting** (`animationRetarget.ts`) applies each source bone's world-space rotation delta
  from rest to the target's rest pose, with per-bone direction calibration (T- vs A-pose), matching
  by normalised name or by semantic role. Root motion is extracted as a velocity and yaw rate and
  applied to the container, so clips loop and cross-fade without sliding.
- **Garments** (`garmentLibrary.ts`) are sewing patterns cut from tape-measure girths
  (convex-hull perimeters) and landmarks, laid around the body by arc length on front/back depth
  maps (`garmentArrangement.ts`) and sewn by the solver's assembly phase. Waistbands are bound to
  the skin with soft XPBD attachments once sewn.

## Collision model

`KinematicBodyCollider` keeps the skin pose at the start and end of each fixed step and is
interpolated per substep. A BVH is refit once per step over both poses.

Per substep, `detectKinematicContacts` finds particle–skin contacts once (contact plane +
skin motion). `projectKinematicContacts` then runs inside every constraint iteration, so stretch,
bend, seams and contacts converge together. After the loop, `applyKinematicFriction` applies
Coulomb friction relative to the moving skin, and `applyContactVelocities` removes separating
velocity (inelastic contact).

- Distances are signed with exact face normals inside faces and smooth vertex normals on
  edges and vertices.
- Fabric pinched between two opposing surfaces (armpit, crotch) slides friction-free for a few
  substeps.
- A remembered contact triangle recovers particles that genuinely crossed the skin within a substep.
- `resolveSkinVertexContacts` (skin vertices pushing cloth faces) exists but is **off by default**:
  it reduces poke-through on bony skin but destabilised travelling locomotion in the stability matrix.

## Fabrics

`runtime/fabrics.ts`: silk, cotton jersey, cotton poplin, denim, wool melton, leather. Each sets
stretch / shear / bend compliance (XPBD, substep-independent), damping, friction, areal density
(particle mass) and half-thickness (collision offset and rendered outer face). Compliance is applied
per panel, so mixed-fabric outfits stay distinct.

## Testing

- Unit tests: `node:test` files next to the code (`*.test.ts`), including
  `kinematicBodyCollider.test.ts` (signed distance, substep interpolation, body-relative friction).
- **Stability matrix** (Cloth Lab → *Run all clips*, or `window.__clothLabQa.runStabilityMatrix`):
  steps every clip deterministically and reports whether the garment stayed on (fraction of
  particles within 6 cm of the skin), p99 edge stretch, render vertices inside the skin, and solver
  cost per step. `window.__clothLab` exposes the controller for automation.
