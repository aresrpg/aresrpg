# Pixel foliage cluster

Generated with the built-in imagegen tool using the owner's Hytale-like foliage screenshot as a style reference. Original generated PNG: `canopy_cluster_source.png`. The source image has genuine alpha and is retained unchanged.

The engine consumes only `canopy_cluster.json`: 32×32 grayscale/alpha samples and their mean visible luminance. It colors existing foliage atlas layers using the authored biome palette. The canopy geometry is now a closed blocky volume; the former coarse card-silhouette rectangles are no longer generated.

Regenerate the data with `python3 scripts/bake_canopy_texture.py` (Python and Pillow). Verify with `python3 scripts/bake_canopy_texture.py --check`.
