// ETS2 Dash v2 — Stream Dock plugin.
//  * Telemetry from ets2dash.dll: UDP 127.0.0.1:39421 (JSON).
//  * Commands to the game: UDP 127.0.0.1:39422 ("pulse <mix> <ms>", "down <mix>", "up <mix>", "release <mix>").
'use strict';

const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const r = require('./render');

const TELEMETRY_PORT = 39421;
const COMMAND_PORT = 39422;
const STALE_MS = 3000;
const TAP_MS = 70;          // how long a "press" lasts for the game
const STEP_GAP_MS = 140;    // gap between encoder steps (cruise, retarder...)
const HOLD_PER_TICK_MS = 160; // hold time per encoder click (suspension, shades...)
const LONG_PRESS_MS = 500;
const FLASH_MS = 350;

// ---------- log ----------
const logDir = path.join(__dirname, 'log');
try { fs.mkdirSync(logDir, { recursive: true }); } catch (_) {}
const logFile = path.join(logDir, 'plugin.log');
function log(...a) {
    try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')}\n`); } catch (_) {}
}
process.on('uncaughtException', e => log('uncaught', String(e && e.stack || e)));
process.on('unhandledRejection', e => log('unhandled', String(e && e.stack || e)));

// ---------- commands to the game ----------
const cmdSock = dgram.createSocket('udp4');
cmdSock.on('error', e => log('cmd udp error', String(e)));
function send(line) { cmdSock.send(Buffer.from(line), COMMAND_PORT, '127.0.0.1'); }
const tap = (mix) => send(`pulse ${mix} ${TAP_MS}`);
const down = (mix) => send(`down ${mix}`);
const up = (mix) => send(`up ${mix}`);

// step queue: fast rotation produces separate presses instead of one long one
const stepNext = {};
function step(mix, count) {
    const now = Date.now();
    for (let i = 0; i < count; i++) {
        const at = Math.max(now, stepNext[mix] || 0);
        stepNext[mix] = at + STEP_GAP_MS;
        setTimeout(() => tap(mix), at - now);
    }
}
// continuous functions: held while the encoder turns
function hold(mixOn, mixOff, ticks) {
    send(`release ${mixOff}`);
    send(`pulse ${mixOn} ${HOLD_PER_TICK_MS * ticks}`);
}

// ---------- telemetry ----------
let telemetry = null;
let lastPacket = 0;
const live = () => (telemetry && Date.now() - lastPacket < STALE_MS) ? telemetry : null;

// ---------- action definitions ----------
// render(t, flash) - image; press(t) - short press; holdMix - held while pressed;
// flash - highlight after press (for commands without game state).
const P = 'com.diy.ets2dash.';
const KEYS = {
    // page 1 - Driving
    speedlimit: { render: r.speedLimit },
    fuel: { render: r.fuel },
    cruise: { render: r.cruise, press: () => tap('cruiectrl') },
    gear: { render: r.gear },
    distance: { render: r.distance },
    airpressure: { render: r.airPressure },
    // page 2 - Status
    parkingbrake: { render: r.parkingBrake, press: () => tap('parkingbrake') },
    motorbrake: { render: r.motorBrake, press: () => tap('engbraketog') },
    retarder: {
        render: r.retarder,
        press: (t) => (t && t.retarderSteps && t.retarder >= t.retarderSteps) ? tap('retarder0') : tap('retarderup'),
    },
    difflock: { render: r.diffLock, press: () => tap('diflock') },
    beacon: { render: r.beacon, press: () => tap('beacon') },
    lights: { render: r.lights, press: () => tap('light'), longPress: () => tap('hblight') },
    // page 3 - Trip
    delivery: { render: r.delivery },
    gametime: { render: r.gameTime },
    trailerdamage: { render: r.trailerDamage },
    consumption: { render: r.consumption },
    watertemp: { render: r.waterTemp },
    oilpressure: { render: r.oilPressure },
    // page 4 - Trailer & suspension
    attach: { render: r.attach, press: () => tap('attach') },
    liftaxle: { render: r.liftAxle, press: () => tap('liftaxle') },
    trailerliftaxle: { render: r.trailerLiftAxle, press: () => tap('liftaxlet') },
    slideaxle: { render: r.slideAxle, press: () => tap('slideaxleman'), flash: true },
    trailerbrake: { render: r.trailerBrake, holdMix: 'trailerbrake' },
    suspreset: { render: r.suspReset, press: () => tap('suspreset'), flash: true },
    // page 5 - Cabin
    doors: { render: r.doors, press: () => tap('entrdoors'), flash: true },
    parkingcam: { render: r.parkingCam, press: () => tap('parking_cams'), flash: true },
    cabinlight: { render: r.cabinLight, press: () => tap('cabinlight'), flash: true },
    hazard: { render: r.hazard, press: () => tap('flasher4way') },
    horn: { render: r.horn, holdMix: 'horn' },
};

// Encoders: clockwise (+) / counter-clockwise (-) rotation, push.
// mode 'step' - each click is a separate press; 'hold' - held while turning.
const KNOBS = {
    k_cruise:      { mode: 'step', cw: 'cruiectrlinc', ccw: 'cruiectrldec', push: 'cruiectrl' },
    k_retarder:    { mode: 'step', cw: 'retarderup',   ccw: 'retarderdown', push: 'engbraketog' },
    k_wipers:      { mode: 'step', cw: 'wipers',       ccw: 'wipersback',   push: null },
    k_frontsusp:   { mode: 'hold', cw: 'frontsuspup',  ccw: 'frontsuspdwn', push: 'suspreset' },
    k_rearsusp:    { mode: 'hold', cw: 'rearsuspup',   ccw: 'rearsuspdwn',  push: 'suspreset' },
    k_trailersusp: { mode: 'hold', cw: 'trlrsuspup',   ccw: 'trlrsuspdwn',  push: 'suspreset' },
    k_slideaxle:   { mode: 'hold', cw: 'slideaxlefwd', ccw: 'slideaxlebwd', push: 'slideaxleman' },
    k_lshade:      { mode: 'hold', cw: 'winlshadeup',  ccw: 'winlshadedwn', push: null },
    k_rshade:      { mode: 'hold', cw: 'winrshadeup',  ccw: 'winrshadedwn', push: null },
    k_lwindow:     { mode: 'hold', cw: 'lwinclose',    ccw: 'lwinopen',     push: null },
    k_rwindow:     { mode: 'hold', cw: 'rwinclose',    ccw: 'rwinopen',     push: null },
};

const keyOf = (action) => action && action.startsWith(P) ? action.slice(P.length) : null;

// ---------- per-key state on the device ----------
const contexts = new Map(); // context -> { key, lastSvg, flashUntil, downAt }

function draw(context, force = false) {
    const c = contexts.get(context);
    if (!c) return;
    const def = KEYS[c.key];
    if (!def || !def.render) return;
    const flash = Date.now() < c.flashUntil;
    let svg;
    try { svg = def.render(live(), flash); } catch (e) { log('render error', c.key, String(e)); return; }
    if (!force && svg === c.lastSvg) return;
    c.lastSvg = svg;
    if (ws.readyState === WebSocket.OPEN) {
        const image = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
        ws.send(JSON.stringify({ event: 'setImage', context, payload: { image, target: 0 } }));
    }
}
const drawAll = () => { for (const ctx of contexts.keys()) draw(ctx); };

function doFlash(context) {
    const c = contexts.get(context);
    if (!c) return;
    c.flashUntil = Date.now() + FLASH_MS;
    draw(context);
    setTimeout(() => draw(context), FLASH_MS + 20);
}

// ---------- Stream Dock event handling ----------
function onKeyDown(context, key) {
    const def = KEYS[key];
    const c = contexts.get(context);
    if (!def || !c) return;
    if (def.holdMix) { down(def.holdMix); c.flashUntil = Infinity; draw(context); return; }
    c.downAt = Date.now();
    if (!def.longPress && def.press) { def.press(live()); if (def.flash) doFlash(context); }
}
function onKeyUp(context, key) {
    const def = KEYS[key];
    const c = contexts.get(context);
    if (!def || !c) return;
    if (def.holdMix) { up(def.holdMix); c.flashUntil = 0; draw(context); return; }
    if (def.longPress) {
        const long = Date.now() - (c.downAt || 0) >= LONG_PRESS_MS;
        (long ? def.longPress : def.press)(live());
    }
}
function onDialRotate(key, ticks) {
    const k = KNOBS[key];
    if (!k || !ticks) return;
    const n = Math.abs(ticks);
    const mix = ticks > 0 ? k.cw : k.ccw;
    if (k.mode === 'step') step(mix, n);
    else hold(mix, ticks > 0 ? k.ccw : k.cw, n);
}
function onDialPush(key) {
    const k = KNOBS[key];
    if (k && k.push) tap(k.push);
}

// ---------- WebSocket to Stream Dock ----------
const arg = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const port = arg('-port') || process.argv[3];
const pluginUUID = arg('-pluginUUID') || process.argv[5];
const registerEvent = arg('-registerEvent') || process.argv[7];

const ws = new WebSocket('ws://127.0.0.1:' + port);
ws.on('open', () => { ws.send(JSON.stringify({ event: registerEvent, uuid: pluginUUID })); log('registered'); });
ws.on('close', () => process.exit(0));
ws.on('error', e => log('ws error', String(e)));
ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    const { event, action, context, payload } = msg;
    const key = keyOf(action);
    if (!key) return;
    const isKnob = !!KNOBS[key];
    switch (event) {
        case 'willAppear':
            if (KEYS[key]) { contexts.set(context, { key, lastSvg: null, flashUntil: 0, downAt: 0 }); draw(context, true); }
            break;
        case 'willDisappear':
            contexts.delete(context);
            break;
        case 'keyDown':
            if (isKnob) onDialPush(key); else onKeyDown(context, key);
            break;
        case 'keyUp':
            if (!isKnob) onKeyUp(context, key);
            break;
        case 'dialDown':
            onDialPush(key);
            break;
        case 'dialRotate':
            onDialRotate(key, payload && payload.ticks);
            break;
    }
});

// ---------- UDP telemetry from the game ----------
const udp = dgram.createSocket('udp4');
udp.on('message', buf => {
    try { telemetry = JSON.parse(buf.toString('utf8')); lastPacket = Date.now(); drawAll(); }
    catch (e) { log('bad packet', String(e)); }
});
udp.on('error', e => log('udp error', String(e)));
udp.bind(TELEMETRY_PORT, '127.0.0.1', () => log('listening udp', TELEMETRY_PORT));

setInterval(drawAll, 1000);
