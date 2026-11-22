// Key rendering as 144x144 SVG (digital "dashboard" style).
'use strict';

const C = {
    bg: '#0b0d0f', frame: '#1c2126', label: '#8a949e',
    green: '#39ff88', ghost: '#12301f',
    amber: '#ffb020', ghostAmber: '#3a2a0c',
    red: '#ff3b3b', ghostRed: '#3a1212',
    dim: '#3c444c', white: '#ffffff', black: '#000000',
};
const MONO = "Consolas, 'Lucida Console', 'Courier New', monospace";
const SANS = "Segoe UI, Arial, sans-serif";

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function frame(inner) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
        `<rect x="0" y="0" width="144" height="144" rx="18" fill="${C.bg}"/>` +
        `<rect x="3" y="3" width="138" height="138" rx="16" fill="none" stroke="${C.frame}" stroke-width="2"/>` +
        inner + `</svg>`;
}

const label = (text) =>
    `<text x="72" y="28" font-family="${SANS}" font-size="17" font-weight="700" fill="${C.label}" text-anchor="middle" letter-spacing="1">${esc(text)}</text>`;
const unit = (text, y = 126) =>
    `<text x="72" y="${y}" font-family="${SANS}" font-size="17" fill="${C.label}" text-anchor="middle">${esc(text)}</text>`;

// Large digital value with faint "ghost" eights behind it, like an LCD.
function digits(value, { color = C.green, ghost = C.ghost, size = 54, y = 92, width = 3 } = {}) {
    const v = String(value);
    let g = v.replace(/[0-9]/g, '8');
    const digitsCount = (g.match(/8/g) || []).length;
    if (digitsCount < width) g = '8'.repeat(width - digitsCount) + g;
    const x = /[:]/.test(v) ? 72 + (v.length * size * 0.55) / 2 : 72 + (g.length * size * 0.55) / 2; // right-aligned, monospace font
    // no ghost digits for clocks: colon width differs between fonts
    const ghostSvg = /[:]/.test(v) ? '' : `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="700" fill="${ghost}" text-anchor="end">${esc(g)}</text>`;
    return ghostSvg +
        `<text x="${x}" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="700" fill="${color}" text-anchor="end">${esc(v)}</text>`;
}

const bigText = (text, color, size = 46, y = 90) =>
    `<text x="72" y="${y}" font-family="${MONO}" font-size="${size}" font-weight="700" fill="${color}" text-anchor="middle">${esc(text)}</text>`;

const toKmh = (ms) => Math.round(ms * 3.6);

// ---------------- keys ----------------

function speedLimit(t) {
    const kmh = t ? toKmh(t.speedLimit) : 0;
    if (!kmh) {
        return frame(`<circle cx="72" cy="72" r="54" fill="none" stroke="${C.dim}" stroke-width="10"/>` +
            bigText('—', C.dim, 44, 87));
    }
    const s = String(kmh);
    const size = s.length >= 3 ? 46 : 58;
    return frame(`<circle cx="72" cy="72" r="56" fill="${C.white}"/>` +
        `<circle cx="72" cy="72" r="50" fill="none" stroke="#e01b1b" stroke-width="12"/>` +
        `<text x="72" y="${72 + size * 0.36}" font-family="${SANS}" font-size="${size}" font-weight="800" fill="${C.black}" text-anchor="middle">${s}</text>`);
}

function fuel(t) {
    if (!t) return offline('FUEL');
    const liters = Math.round(t.fuel);
    const warn = t.fuelWarning;
    const color = warn ? C.red : C.green;
    const ghost = warn ? C.ghostRed : C.ghost;
    const pct = t.fuelCapacity > 0 ? Math.max(0, Math.min(1, t.fuel / t.fuelCapacity)) : null;
    let bar = '';
    if (pct !== null) {
        const segs = 10, w = 9, gap = 2, x0 = 72 - (segs * w + (segs - 1) * gap) / 2;
        const on = Math.round(pct * segs);
        for (let i = 0; i < segs; i++) {
            bar += `<rect x="${x0 + i * (w + gap)}" y="94" width="${w}" height="12" rx="1.5" fill="${i < on ? color : ghost}"/>`;
        }
    }
    const range = Math.round(t.fuelRange);
    return frame(label('FUEL') +
        digits(liters, { color, ghost, size: 46, y: 80, width: 3 }) +
        bar +
        unit(`≈ ${range} km`, 130));
}

function cruise(t) {
    if (!t) return offline('CRUISE');
    const kmh = toKmh(t.cruise);
    if (!kmh) return frame(label('CRUISE') + bigText('OFF', C.dim, 44, 88) + unit('km/h'));
    return frame(label('CRUISE') + digits(kmh, { width: 3 }) + unit('km/h'));
}

function gear(t) {
    if (!t) return offline('GEAR');
    const g = t.gear;
    let text, color;
    if (g > 0) { text = String(g); color = C.green; }
    else if (g === 0) { text = 'N'; color = C.amber; }
    else { text = 'R' + (-g); color = C.red; }
    const size = text.length >= 2 ? 62 : 80;
    return frame(label('GEAR') + bigText(text, color, size, 112));
}

function distance(t) {
    if (!t) return offline('DISTANCE');
    const km = t.navDistance / 1000;
    if (t.navDistance <= 0) return frame(label('DISTANCE') + bigText('—', C.dim, 44, 88) + unit('km'));
    const v = km < 10 ? km.toFixed(1) : String(Math.round(km));
    return frame(label('DISTANCE') + digits(v, { width: 4, size: 46, y: 88 }) + unit('km'));
}

function airPressure(t) {
    if (!t) return offline('AIR');
    const bar = t.airPressure * 0.0689476;
    let color = C.green, ghost = C.ghost;
    if (t.airEmergency) { color = C.red; ghost = C.ghostRed; }
    else if (t.airWarning) { color = C.amber; ghost = C.ghostAmber; }
    return frame(label('AIR') + digits(bar.toFixed(1), { color, ghost, width: 3, size: 50 }) + unit('bar'));
}

function offline(name) {
    return frame(label(name) + bigText('— —', C.dim, 40, 88) + unit('no game', 126));
}

module.exports = { speedLimit, fuel, cruise, gear, distance, airPressure, offline };

// =====================================================================
//                 v2: indicators, Trip, Trailer and Cabin pages
// =====================================================================

const IDLE = '#c8d0d8';   // icon colour for command keys without game state
const BLUE = '#3d9bff';

function labelFit(text) {
    const size = Math.min(17, Math.floor(200 / Math.max(text.length, 1)));
    return `<text x="72" y="28" font-family="${SANS}" font-size="${size}" font-weight="700" fill="${C.label}" text-anchor="middle" letter-spacing="0.5">${esc(text)}</text>`;
}
const status = (text, color) =>
    `<text x="72" y="130" font-family="${SANS}" font-size="16" font-weight="700" fill="${color}" text-anchor="middle">${esc(text)}</text>`;

// --- pictograms (centred around 72,72; colour c) ---
const ICON = {
    parking: (c) => `<circle cx="72" cy="72" r="24" fill="none" stroke="${c}" stroke-width="6"/>` +
        `<path d="M40 50 A34 34 0 0 0 40 94 M104 50 A34 34 0 0 1 104 94" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>` +
        `<text x="72" y="84" font-family="${SANS}" font-size="32" font-weight="800" fill="${c}" text-anchor="middle">P</text>`,
    engineBrake: (c) => `<rect x="34" y="50" width="76" height="44" rx="10" fill="none" stroke="${c}" stroke-width="6"/>` +
        `<text x="72" y="83" font-family="${SANS}" font-size="28" font-weight="800" fill="${c}" text-anchor="middle">EB</text>`,
    diff: (c) => `<line x1="34" y1="72" x2="110" y2="72" stroke="${c}" stroke-width="6"/>` +
        `<rect x="24" y="50" width="12" height="44" rx="4" fill="${c}"/><rect x="108" y="50" width="12" height="44" rx="4" fill="${c}"/>` +
        `<circle cx="72" cy="72" r="15" fill="${C.bg}" stroke="${c}" stroke-width="5"/>` +
        `<path d="M64 64 L80 80 M80 64 L64 80" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`,
    beacon: (c) => `<path d="M46 96 H98 V88 H92 A20 20 0 0 0 52 88 H46 Z" fill="${c}"/>` +
        `<path d="M72 44 V54 M44 56 L51 63 M100 56 L93 63 M34 78 H43 M101 78 H110" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`,
    headlight: (c, mode) => {
        const beams = mode === 'high'
            ? 'M34 58 H62 M34 72 H62 M34 86 H62'
            : 'M34 54 L62 60 M34 70 L62 76 M34 86 L62 92';
        return `<path d="M72 48 Q110 48 110 72 Q110 96 72 96 Z" fill="${c}"/>` +
            `<path d="${beams}" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`;
    },
    hazard: (c) => `<path d="M72 40 L108 102 H36 Z" fill="none" stroke="${c}" stroke-width="7" stroke-linejoin="round"/>` +
        `<path d="M72 60 L91 92 H53 Z" fill="none" stroke="${c}" stroke-width="5" stroke-linejoin="round"/>`,
    trailer: (c) => `<rect x="44" y="48" width="66" height="36" rx="4" fill="none" stroke="${c}" stroke-width="6"/>` +
        `<circle cx="92" cy="94" r="9" fill="${c}"/><path d="M44 76 H26 V86" stroke="${c}" stroke-width="6" fill="none" stroke-linecap="round"/>`,
    liftAxle: (c) => `<circle cx="50" cy="90" r="13" fill="none" stroke="${c}" stroke-width="6"/>` +
        `<circle cx="94" cy="78" r="13" fill="none" stroke="${c}" stroke-width="6"/>` +
        `<path d="M94 58 V40 M84 50 L94 40 L104 50" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    slideAxle: (c) => `<circle cx="58" cy="86" r="12" fill="none" stroke="${c}" stroke-width="6"/>` +
        `<circle cx="86" cy="86" r="12" fill="none" stroke="${c}" stroke-width="6"/>` +
        `<path d="M40 54 H104 M50 44 L40 54 L50 64 M94 44 L104 54 L94 64" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
    trailerBrake: (c) => `<circle cx="72" cy="72" r="24" fill="none" stroke="${c}" stroke-width="6"/>` +
        `<path d="M40 50 A34 34 0 0 0 40 94 M104 50 A34 34 0 0 1 104 94" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>` +
        `<text x="72" y="83" font-family="${SANS}" font-size="30" font-weight="800" fill="${c}" text-anchor="middle">T</text>`,
    suspReset: (c) => `<path d="M72 40 V104 M60 52 L72 40 L84 52 M60 92 L72 104 L84 92" stroke="${c}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
        `<path d="M40 64 H56 M40 80 H56 M88 64 H104 M88 80 H104" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`,
    door: (c) => `<rect x="50" y="40" width="44" height="64" rx="4" fill="none" stroke="${c}" stroke-width="6"/>` +
        `<line x1="72" y1="40" x2="72" y2="104" stroke="${c}" stroke-width="4"/>` +
        `<path d="M64 74 H68 M76 74 H80" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`,
    camera: (c) => `<rect x="32" y="54" width="62" height="40" rx="8" fill="none" stroke="${c}" stroke-width="6"/>` +
        `<path d="M94 66 L114 54 V94 L94 82 Z" fill="${c}"/><circle cx="54" cy="74" r="8" fill="${c}"/>`,
    bulb: (c) => `<circle cx="72" cy="64" r="20" fill="none" stroke="${c}" stroke-width="6"/>` +
        `<path d="M62 88 H82 M64 98 H80" stroke="${c}" stroke-width="6" stroke-linecap="round"/>` +
        `<path d="M40 44 L46 50 M104 44 L98 50 M72 32 V38" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`,
    horn: (c) => `<path d="M38 64 H54 L90 44 V100 L54 80 H38 Z" fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round"/>` +
        `<path d="M100 58 Q108 72 100 86" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
};

// Indicator key: state comes from the game
function indicator(t, name, icon, active, onColor, onText = 'ON', offText = 'OFF') {
    if (!t) return offline(name);
    const c = active ? onColor : C.dim;
    return frame(labelFit(name) + icon(c) + status(active ? onText : offText, active ? onColor : C.dim));
}
// Command key: no state, only a highlight when pressed
function command(t, name, icon, flash, hint = '') {
    if (!t) return offline(name);
    const c = flash ? C.green : IDLE;
    return frame(labelFit(name) + icon(c) + status(flash ? '✓' : hint, flash ? C.green : C.label));
}

// --- page 2: Status ---
const parkingBrake = (t) => indicator(t, 'PARK BRAKE', ICON.parking, t && t.parkingBrake, C.red);
const motorBrake = (t) => indicator(t, 'ENGINE BRAKE', ICON.engineBrake, t && t.motorBrake, C.amber);
const diffLock = (t) => indicator(t, 'DIFF LOCK', ICON.diff, t && t.diffLock, C.amber);
const beacon = (t) => indicator(t, 'BEACON', ICON.beacon, t && t.beacon, C.amber);
const hazard = (t) => indicator(t, 'HAZARD', ICON.hazard, t && t.hazard, C.red);

function retarder(t) {
    if (!t) return offline('RETARDER');
    const steps = t.retarderSteps || 0;
    if (steps === 0) return frame(labelFit('RETARDER') + bigText('—', C.dim, 44, 86) + status('none', C.dim));
    const lvl = Math.min(t.retarder, steps);
    const color = lvl > 0 ? C.amber : C.dim;
    let segs = '';
    const w = Math.min(18, Math.floor(96 / steps) - 4), gap = 4;
    const x0 = 72 - (steps * w + (steps - 1) * gap) / 2;
    for (let i = 0; i < steps; i++)
        segs += `<rect x="${x0 + i * (w + gap)}" y="98" width="${w}" height="12" rx="2" fill="${i < lvl ? C.amber : C.ghostAmber}"/>`;
    return frame(labelFit('RETARDER') + bigText(`${lvl}/${steps}`, color, 44, 82) + segs +
        status(lvl > 0 ? 'ON' : 'OFF', color).replace('y="130"', 'y="133"'));
}

function lights(t) {
    if (!t) return offline('LIGHTS');
    let mode = 'off', text = 'OFF', c = C.dim;
    if (t.highBeam) { mode = 'high'; text = 'HIGH BEAM'; c = BLUE; }
    else if (t.lowBeam) { mode = 'low'; text = 'LOW BEAM'; c = C.green; }
    else if (t.lightParking) { mode = 'park'; text = 'PARKING'; c = C.green; }
    return frame(labelFit('LIGHTS') + ICON.headlight(c, mode) + status(text, c));
}

// --- page 3: Trip ---
const pad2 = (n) => String(n).padStart(2, '0');

function delivery(t) {
    if (!t) return offline('DELIVERY');
    if (!t.hasJob || !t.deliveryTime) return frame(labelFit('DELIVERY') + bigText('—', C.dim, 44, 86) + unit('no job'));
    const left = t.deliveryTime - t.gameTime; // minutes
    const late = left < 0;
    const m = Math.abs(left);
    const v = `${Math.floor(m / 60)}:${pad2(m % 60)}`;
    const color = late ? C.red : (left < 60 ? C.amber : C.green);
    const ghost = late ? C.ghostRed : (left < 60 ? C.ghostAmber : C.ghost);
    return frame(labelFit('DELIVERY') + digits(late ? '-' + v : v, { color, ghost, size: 42, y: 88, width: 3 }) +
        unit(late ? 'late' : 'remaining'));
}

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
function gameTime(t) {
    if (!t) return offline('GAME TIME');
    const gt = t.gameTime;
    const v = `${pad2(Math.floor(gt / 60) % 24)}:${pad2(gt % 60)}`;
    return frame(labelFit('GAME TIME') + digits(v, { size: 42, y: 88, width: 4 }) + unit(DAYS[Math.floor(gt / 1440) % 7]));
}

function trailerDamage(t) {
    if (!t) return offline('TRAILER');
    if (!t.trailerConnected) return frame(labelFit('TRAILER') + bigText('—', C.dim, 44, 86) + unit('no trailer'));
    const wear = Math.max(t.trlWearBody, t.trlWearChassis, t.trlWearWheels);
    const pct = Math.round(wear * 100);
    const cargo = Math.round((t.cargoDamage || 0) * 100);
    const worst = Math.max(pct, cargo);
    const color = worst >= 30 ? C.red : worst >= 10 ? C.amber : C.green;
    const ghost = worst >= 30 ? C.ghostRed : worst >= 10 ? C.ghostAmber : C.ghost;
    return frame(labelFit('TRAILER') + digits(pct + '%', { color, ghost, size: 44, y: 86, width: 2 }) + unit(`cargo ${cargo}%`));
}

function consumption(t) {
    if (!t) return offline('CONSUMPTION');
    const v = t.fuelAvg > 0 ? (t.fuelAvg * 100).toFixed(1) : '—';
    if (v === '—') return frame(labelFit('CONSUMPTION') + bigText('—', C.dim, 44, 86) + unit('L/100 km'));
    return frame(labelFit('CONSUMPTION') + digits(v, { size: 46, y: 88, width: 3 }) + unit('L/100 km'));
}

function waterTemp(t) {
    if (!t) return offline('WATER TEMP');
    const w = t.waterWarning;
    return frame(labelFit('WATER TEMP') + digits(Math.round(t.waterTemp), { color: w ? C.red : C.green, ghost: w ? C.ghostRed : C.ghost, width: 3 }) + unit('°C'));
}

function oilPressure(t) {
    if (!t) return offline('OIL PRESSURE');
    const w = t.oilWarning;
    const bar = (t.oilPressure * 0.0689476).toFixed(1);
    return frame(labelFit('OIL PRESSURE') + digits(bar, { color: w ? C.red : C.green, ghost: w ? C.ghostRed : C.ghost, width: 3, size: 50 }) + unit('bar'));
}

// --- page 4: Trailer & suspension ---
const attach = (t) => indicator(t, 'COUPLING', ICON.trailer, t && t.trailerConnected, C.green, 'ATTACHED', 'DETACHED');
const liftAxle = (t) => indicator(t, 'TRUCK AXLE', ICON.liftAxle, t && t.liftAxle, C.amber, 'RAISED', 'LOWERED');
const trailerLiftAxle = (t) => indicator(t, 'TRAILER AXLE', ICON.liftAxle, t && t.trailerLiftAxle, C.amber, 'RAISED', 'LOWERED');
const slideAxle = (t, f) => command(t, 'AXLE SLIDE', ICON.slideAxle, f, 'manual');
const trailerBrake = (t, f) => command(t, 'TRAILER BRAKE', ICON.trailerBrake, f, 'hold');
const suspReset = (t, f) => command(t, 'SUSPENSION', ICON.suspReset, f, 'reset');

// --- page 5: Cabin ---
const doors = (t, f) => command(t, 'DOORS', ICON.door, f);
const parkingCam = (t, f) => command(t, 'CAMERA', ICON.camera, f);
const cabinLight = (t, f) => command(t, 'CABIN', ICON.bulb, f, 'light');
const horn = (t, f) => command(t, 'HORN', ICON.horn, f, 'hold');

Object.assign(module.exports, {
    parkingBrake, motorBrake, retarder, diffLock, beacon, lights, hazard,
    delivery, gameTime, trailerDamage, consumption, waterTemp, oilPressure,
    attach, liftAxle, trailerLiftAxle, slideAxle, trailerBrake, suspReset,
    doors, parkingCam, cabinLight, horn, ICON,
});
