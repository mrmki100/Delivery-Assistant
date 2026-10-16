# -*- mode: python ; coding: utf-8 -*-


a = Analysis(
    ['C:/Users/mrmki/Documents/antiGG repo/Delivery Assistant/Driver and update assistant/src/driver_update_assistant/client/main.py'],
    pathex=['C:/Users/mrmki/Documents/antiGG repo/Delivery Assistant/Driver and update assistant/src'],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['driver_update_assistant.server'],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='DriverUpdateAssistant-Client',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='DriverUpdateAssistant-Client',
)
