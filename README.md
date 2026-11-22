# ETS2 Dash v2 for Ajazz AKP03E

Euro Truck Simulator 2 / American Truck Simulator telemetry and controls.
**No key bindings are needed in the game**: the plugin controls the game directly through the SCS SDK.
The full guide with pictures is in `ETS2Dash-Guide.pdf`; page layouts are in the `images` folder.

## Installation

1. Close the game and Stream Dock (including the tray icon).
2. Copy `1_game_plugin/ets2dash.dll` to `...\Euro Truck Simulator 2\bin\win_x64\plugins\` (create `plugins` if needed).
3. Copy `2_streamdock_plugin/com.diy.ets2dash.sdPlugin` to the Stream Dock plugins folder
   (usually `%APPDATA%\HotSpot\StreamDock\plugins\`). Delete any older copy first.
4. Start Stream Dock, then the game (click OK in the “Advanced SDK features” dialog).

## Pages

| Page | 6 display keys | Encoders |
|---|---|---|
| 1 Driving | Speed Limit, Fuel, Cruise Control, Gear, Distance to Destination, Air Pressure | Cruise +/-, Retarder +/-, Wipers |
| 2 Status | Parking Brake, Engine Brake, Retarder, Differential Lock, Beacon, Lights | Cruise +/-, Retarder +/-, Wipers |
| 3 Trip | Delivery Time, Game Time, Trailer Damage, Fuel Consumption, Water Temperature, Oil Pressure | Cruise +/-, Retarder +/-, Wipers |
| 4 Trailer & Suspension | Trailer Coupling, Truck Lift Axle, Trailer Lift Axle, Trailer Axle Slide, Trailer Brake, Reset Suspension | Front, Rear and Trailer Suspension |
| 5 Cabin | Doors, Parking Camera, Cabin Light, Hazard Lights, Horn, (free) | Left Sun Shade, Right Sun Shade, Driver Window |

Spare encoder actions: Passenger Window, Trailer Axle Slide.
Physical buttons: Stream Dock’s built-in page switching (left — page 1, middle — back, right — next).

## Controls

- Keys with state (parking brake, beacon, diff lock, coupling, axles...) show the real game state; a press toggles it.
- **Lights**: short press — next light mode, hold over 0.5 s — high beam.
- **Retarder** key: each press +1 level, turns off after the maximum.
- **Trailer Brake** and **Horn** work while the key is held.
- Encoders: clockwise — up / more / close, counter-clockwise — down / less / open.
  Suspension, shades, windows and axle slide move while you turn. Pushing a suspension encoder resets the suspension.

## Troubleshooting

- “no game” on the keys: the DLL is not loaded — check the path.
- Values show but presses do nothing: check `Documents\Euro Truck Simulator 2\game.log.txt` for `[ets2dash]` lines.
- Plugin log: `...\com.diy.ets2dash.sdPlugin\plugin\log\plugin.log`.
- Communication: UDP `127.0.0.1:39421` (telemetry) and `127.0.0.1:39422` (commands), local only.

## Building the DLL

MinGW: `x86_64-w64-mingw32-g++ -O2 -shared -Isource/scs_sdk source/ets2dash.cpp -o ets2dash.dll -lws2_32 -static`
Visual Studio: x64 DLL project, include path `source/scs_sdk`, link `ws2_32.lib`.
