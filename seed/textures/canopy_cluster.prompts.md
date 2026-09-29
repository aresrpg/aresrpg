# Pixel foliage cluster

Generated with the built-in imagegen tool using the owner's Hytale-like foliage screenshot as a style reference. Original generated PNG: `canopy_cluster_source.png`. The source image has genuine alpha and is retained unchanged.

The engine consumes only `canopy_cluster.json`: 32×32 grayscale/alpha samples and their mean visible luminance. It colors existing foliage atlas layers using the authored biome palette. The canopy geometry is now a closed blocky volume; the former coarse card-silhouette rectangles are no longer generated. The original generation prompt below records the texture’s provenance.

Regenerate the data with `python3 scripts/bake_canopy_texture.py` (Python and Pillow). Verify with `python3 scripts/bake_canopy_texture.py --check`.

## Generation prompt

Create ONE production game texture, not a scene or 3D preview. Use the attached image ONLY as style reference: Hytale-like compact pixel-textured foliage cluster with block-stepped lobed edges. Output a flat front-facing 2D foliage CARD, square canvas, genuine transparent background (no checkerboard drawn). Dense roughly square irregular leafy tuft filling 90% of canvas, overlapping small broad pixel leaf shapes, stepped chunky silhouette with little tufts on all four edges and a few tiny internal gaps. Fine coherent pixel-art shading and blocky leafy mottling. IMPORTANT use ONLY neutral grayscale tones (medium gray to pale gray with dark gray crevices), so the engine can tint to authored biome greens. No green baked in. Surface reads as dense voxel-game foliage, not individual realistic botanical leaves, not triangles or diamonds, no visible thick stems. Consistent low-resolution 32x32 pixel-art design enlarged crisply, nearest-neighbor hard pixel edges. Flat ambient lighting with modest depth in crevices, no directional cast shadow, no glossy highlights. No text, watermark, border, perspective, cube, crossed planes, or background. This is the texture to apply to three intersecting foliage planes.
