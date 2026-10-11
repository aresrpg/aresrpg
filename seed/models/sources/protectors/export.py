import bpy
from pathlib import Path
OUTPUT=Path(bpy.data.filepath).resolve().parent
for family in ['miner','bricheton','gaia']:
    scene=bpy.data.scenes['Protector - '+family];bpy.context.window.scene=scene
    rig=bpy.data.objects['Protector_'+family+'_Rig'];rig.animation_data.action=None
    for o in scene.objects:o.select_set(o.name in ['Protector_'+family+'_Rig','Protector_'+family+'_Mesh'])
    bpy.context.view_layer.objects.active=rig
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT/('protector_'+family+'_base.glb')),
        export_format='GLB',use_selection=True,use_active_scene=True,export_animations=True,
        export_animation_mode='NLA_TRACKS',export_anim_single_armature=False,export_anim_slide_to_zero=True,
        export_optimize_animation_size=True,export_optimize_animation_keep_anim_armature=False,
        export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12,export_draco_generic_quantization=12,
        export_meshopt_compression_enable=False,export_materials='EXPORT')
    rig.animation_data.action=bpy.data.actions['PROTECTOR_'+family.upper()+'_IDLE'];scene.frame_set(1)
