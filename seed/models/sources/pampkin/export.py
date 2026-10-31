"""Open pampkin.blend in Blender 4.0+, then run this file to export the pet."""
from pathlib import Path

import bpy

root = next(path for path in Path(bpy.data.filepath).parents if (path / 'ARCHITECTURE.md').exists())
rig = bpy.data.objects['Pampkin rig']
tracks = rig.animation_data.nla_tracks
muted = [track.mute for track in tracks]
try:
    for track in tracks:
        track.mute = False
    for obj in bpy.context.scene.objects:
        obj.select_set(obj == rig or obj.parent == rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=str(root / 'seed/models/pets/pampkin.glb'),
        export_format='GLB', use_selection=True, export_animations=True,
        export_nla_strips=True, export_force_sampling=True,
    )
finally:
    for track, mute in zip(tracks, muted):
        track.mute = mute
