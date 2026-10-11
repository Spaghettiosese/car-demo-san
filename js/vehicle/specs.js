import * as THREE from 'three';
import { TIRES } from './tire.js';
import { table } from '../core/util.js';

// -----------------------------------------------------------------------------
// Bodies. Design space: metres, y = 0 is the ground at rest, z = 0 the middle of
// the car, +z forward, +x to the driver's (left) side.
// Curves are [z, y] (or [z, halfWidth]) keypoints; see carBuilder for the loft.
// -----------------------------------------------------------------------------
export const BODIES = {
  sedan: {
    name: 'Aurora Vento', kind: 'Sport sedan', L: 4.7, R: 0.33, axles: [1.42, -1.33],
    mass: 1480, comY: 0.52, frontWeight: 0.54, cdA: 0.66, springHz: [1.55, 1.65],
    top: [[-2.35, 0.78], [-2.31, 0.95], [-2.2, 1.02], [-1.8, 1.05], [-1.4, 1.065], [-0.95, 1.3], [-0.55, 1.43], [0, 1.46], [0.45, 1.44], [1.3, 0.99], [1.8, 0.92], [2.2, 0.84], [2.32, 0.76], [2.35, 0.64]],
    belt: [[-2.35, 0.76], [-2.3, 0.92], [-2.15, 0.99], [-1.4, 1.0], [0, 0.97], [1.3, 0.93], [2.0, 0.86], [2.28, 0.78], [2.35, 0.62]],
    bottom: [[-2.35, 0.45], [-2.28, 0.32], [-2.0, 0.26], [-1.6, 0.22], [1.7, 0.2], [2.1, 0.24], [2.3, 0.3], [2.35, 0.42]],
    hw: [[-2.35, 0.74], [-2.25, 0.86], [-1.9, 0.905], [-1.3, 0.92], [0, 0.915], [1.4, 0.915], [1.95, 0.89], [2.2, 0.83], [2.32, 0.74], [2.35, 0.66]],
    gh: [[-1.4, 0.8], [-0.6, 0.68], [0, 0.69], [0.45, 0.68], [1.3, 0.82]],
    zones: { cowl: 1.3, roofF: 0.45, roofR: -0.55, deck: -1.4 },
    doors: { FL: [0.04, 1.02], RL: [-0.92, -0.04] },
    sideGlass: [[-1.1, -0.06], [0.06, 1.1]],
    head: { y: 0.72, x0: 0.44, x1: 0.8, h: 0.12 },
    tail: { y: 0.9, x0: 0.42, x1: 0.84, h: 0.12 },
    seat: { x: 0.37, y: 1.15, z: -0.12 },
    defaults: { engine: 'v6', drivetrain: 'rwd', diff: 'lsd', gearTop: 72, final: null },
  },
  hatch: {
    name: 'Pico GTi', kind: 'Hot hatch', L: 4.1, R: 0.31, axles: [1.3, -1.25],
    mass: 1180, comY: 0.5, frontWeight: 0.61, cdA: 0.64, springHz: [1.7, 1.85],
    top: [[-2.05, 0.92], [-2.02, 1.08], [-1.96, 1.2], [-1.8, 1.38], [-1.55, 1.45], [0, 1.47], [0.35, 1.46], [1.15, 0.98], [1.6, 0.9], [1.95, 0.8], [2.05, 0.64]],
    belt: [[-2.05, 0.9], [-1.95, 1.0], [-1.5, 1.02], [0, 0.96], [1.15, 0.92], [1.9, 0.8], [2.05, 0.62]],
    bottom: [[-2.05, 0.45], [-1.95, 0.3], [-1.6, 0.22], [1.5, 0.2], [1.9, 0.26], [2.05, 0.42]],
    hw: [[-2.05, 0.8], [-1.9, 0.86], [-1.2, 0.88], [1.3, 0.88], [1.85, 0.84], [2.0, 0.76], [2.05, 0.68]],
    gh: [[-1.96, 0.76], [-1.5, 0.68], [0.35, 0.68], [1.15, 0.8]],
    zones: { cowl: 1.15, roofF: 0.35, roofR: -1.55, deck: -1.96 },
    doors: { FL: [-0.4, 0.92] },
    sideGlass: [[-1.75, -0.5], [-0.38, 0.95]],
    head: { y: 0.72, x0: 0.44, x1: 0.78, h: 0.11 },
    tail: { y: 1.02, x0: 0.5, x1: 0.8, h: 0.14 },
    seat: { x: 0.36, y: 1.13, z: -0.28 },
    defaults: { engine: 'i4', turbo: 'small', drivetrain: 'fwd', diff: 'open', gearTop: 64 },
  },
  muscle: {
    name: 'Brutus SS', kind: 'Muscle car', L: 4.85, R: 0.34, axles: [1.5, -1.3],
    mass: 1650, comY: 0.5, frontWeight: 0.55, cdA: 0.78, springHz: [1.5, 1.55],
    top: [[-2.425, 0.85], [-2.38, 1.0], [-2.1, 1.06], [-1.55, 1.07], [-0.9, 1.25], [-0.35, 1.34], [0.2, 1.35], [0.95, 1.0], [1.6, 0.97], [2.2, 0.92], [2.38, 0.86], [2.425, 0.7]],
    belt: [[-2.425, 0.83], [-2.35, 0.98], [-1.6, 1.0], [0, 0.95], [0.95, 0.93], [2.2, 0.9], [2.4, 0.84], [2.425, 0.68]],
    bottom: [[-2.425, 0.42], [-2.3, 0.28], [-1.9, 0.22], [1.8, 0.2], [2.25, 0.24], [2.425, 0.38]],
    hw: [[-2.425, 0.84], [-2.3, 0.94], [-1.3, 0.975], [0, 0.95], [1.5, 0.96], [2.2, 0.93], [2.4, 0.87], [2.425, 0.8]],
    gh: [[-1.55, 0.78], [-0.35, 0.66], [0.2, 0.67], [0.95, 0.8]],
    zones: { cowl: 0.95, roofF: 0.2, roofR: -0.35, deck: -1.55 },
    doors: { FL: [-0.6, 0.98] },
    sideGlass: [[-1.2, -0.62], [-0.58, 1.0]],
    head: { y: 0.76, x0: 0.5, x1: 0.84, h: 0.1 },
    tail: { y: 0.9, x0: 0.2, x1: 0.88, h: 0.1 },
    seat: { x: 0.38, y: 1.02, z: -0.3 },
    defaults: { engine: 'v8', drivetrain: 'rwd', diff: 'lsd', gearTop: 76 },
  },
  coupe: {
    name: 'Kaze RS', kind: 'Sports coupe', L: 4.45, R: 0.33, axles: [1.35, -1.25],
    mass: 1350, comY: 0.45, frontWeight: 0.52, cdA: 0.6, springHz: [1.95, 2.05],
    top: [[-2.225, 0.78], [-2.18, 0.94], [-1.95, 1.0], [-1.6, 1.01], [-1.0, 1.15], [-0.45, 1.24], [0.15, 1.25], [0.9, 0.92], [1.6, 0.8], [2.1, 0.7], [2.225, 0.56]],
    belt: [[-2.225, 0.76], [-2.15, 0.9], [-1.6, 0.95], [0, 0.88], [0.9, 0.85], [1.8, 0.76], [2.2, 0.62], [2.225, 0.54]],
    bottom: [[-2.225, 0.38], [-2.1, 0.24], [-1.8, 0.17], [1.8, 0.15], [2.15, 0.18], [2.225, 0.3]],
    hw: [[-2.225, 0.82], [-2.1, 0.92], [-1.25, 0.955], [-0.3, 0.9], [0.5, 0.9], [1.35, 0.945], [2.0, 0.88], [2.2, 0.78], [2.225, 0.7]],
    gh: [[-1.6, 0.76], [-0.45, 0.62], [0.15, 0.62], [0.9, 0.78]],
    zones: { cowl: 0.9, roofF: 0.15, roofR: -0.45, deck: -1.6 },
    doors: { FL: [-0.6, 0.96] },
    sideGlass: [[-1.25, -0.62], [-0.58, 0.95]],
    head: { y: 0.64, x0: 0.46, x1: 0.8, h: 0.08 },
    tail: { y: 0.86, x0: 0.25, x1: 0.85, h: 0.08 },
    seat: { x: 0.37, y: 0.92, z: -0.32 },
    defaults: { engine: 'i6', turbo: 'small', drivetrain: 'rwd', diff: 'lsd', gearTop: 78 },
  },
  suv: {
    name: 'Atlas 4x4', kind: 'SUV', L: 4.8, R: 0.38, axles: [1.45, -1.4],
    mass: 2150, comY: 0.72, frontWeight: 0.53, cdA: 1.05, springHz: [1.3, 1.4], travel: [0.2, 0.14],
    top: [[-2.4, 1.1], [-2.37, 1.3], [-2.33, 1.62], [-2.2, 1.78], [0, 1.82], [0.4, 1.81], [1.25, 1.2], [1.9, 1.12], [2.3, 1.05], [2.4, 0.9]],
    belt: [[-2.4, 1.08], [-2.3, 1.2], [0, 1.18], [1.25, 1.12], [2.2, 1.02], [2.4, 0.88]],
    bottom: [[-2.4, 0.55], [-2.25, 0.44], [-1.9, 0.38], [1.9, 0.38], [2.25, 0.44], [2.4, 0.55]],
    hw: [[-2.4, 0.86], [-2.3, 0.95], [0, 0.975], [2.2, 0.95], [2.35, 0.88], [2.4, 0.8]],
    gh: [[-2.33, 0.82], [-2.2, 0.8], [0.4, 0.8], [1.25, 0.88]],
    zones: { cowl: 1.25, roofF: 0.4, roofR: -2.2, deck: -2.33 },
    doors: { FL: [0.04, 1.0], RL: [-1.0, -0.04] },
    sideGlass: [[-2.15, -1.05], [-0.98, -0.06], [0.06, 1.1]],
    head: { y: 0.95, x0: 0.45, x1: 0.84, h: 0.13 },
    tail: { y: 1.2, x0: 0.6, x1: 0.9, h: 0.22 },
    seat: { x: 0.38, y: 1.45, z: -0.05 },
    defaults: { engine: 'v8', drivetrain: 'awd', diff: 'lsd', gearTop: 66, tire: 'offroad' },
  },
  pickup: {
    name: 'Hauler 2500', kind: 'Pickup', L: 5.2, R: 0.38, axles: [1.75, -1.55],
    mass: 2250, comY: 0.75, frontWeight: 0.57, cdA: 1.15, springHz: [1.35, 1.6], travel: [0.2, 0.14],
    top: [[-2.6, 1.22], [-2.55, 1.22], [-2.53, 0.9], [-0.97, 0.9], [-0.95, 1.25], [-0.9, 1.4], [-0.86, 1.86], [0, 1.88], [0.55, 1.87], [1.4, 1.25], [2.2, 1.18], [2.52, 1.1], [2.6, 0.95]],
    belt: [[-2.6, 1.22], [-0.9, 1.25], [0, 1.22], [1.4, 1.18], [2.4, 1.1], [2.6, 0.95]],
    bottom: [[-2.6, 0.62], [-2.45, 0.5], [-2.0, 0.42], [2.0, 0.42], [2.45, 0.5], [2.6, 0.62]],
    hw: [[-2.6, 0.93], [0, 0.97], [2.3, 0.95], [2.55, 0.88], [2.6, 0.8]],
    gh: [[-0.86, 0.82], [0.55, 0.8], [1.4, 0.88]],
    zones: { cowl: 1.4, roofF: 0.55, roofR: -0.86, deck: -0.95, bed: [-2.53, -0.97] },
    doors: { FL: [-0.08, 1.22], RL: [-0.86, -0.12] },
    sideGlass: [[-0.82, -0.14], [-0.06, 1.2]],
    head: { y: 1.0, x0: 0.45, x1: 0.86, h: 0.14 },
    tail: { y: 1.05, x0: 0.78, x1: 0.93, h: 0.3 },
    seat: { x: 0.4, y: 1.52, z: 0.12 },
    defaults: { engine: 'v8', drivetrain: 'awd', diff: 'locked', gearTop: 62, tire: 'offroad' },
  },
  van: {
    name: 'Porter Cargo', kind: 'Van', L: 5.0, R: 0.36, axles: [1.6, -1.5],
    mass: 2300, comY: 0.8, frontWeight: 0.52, cdA: 1.25, springHz: [1.4, 1.5], travel: [0.16, 0.12],
    top: [[-2.5, 1.9], [-2.45, 2.05], [-2.3, 2.1], [0.9, 2.1], [1.5, 1.35], [2.2, 1.15], [2.45, 1.05], [2.5, 0.9]],
    belt: [[-2.5, 1.15], [0, 1.15], [1.5, 1.12], [2.3, 1.0], [2.5, 0.88]],
    bottom: [[-2.5, 0.55], [-2.4, 0.42], [2.3, 0.42], [2.5, 0.55]],
    hw: [[-2.5, 0.95], [-2.4, 1.0], [2.2, 1.0], [2.45, 0.92], [2.5, 0.85]],
    gh: [[-2.45, 0.95], [0.9, 0.95], [1.5, 0.95]],
    zones: { cowl: 1.5, roofF: 0.9, roofR: -2.45, deck: -2.5 },
    doors: { FL: [0.3, 1.25] },
    sideGlass: [[0.32, 1.35]],
    head: { y: 0.95, x0: 0.5, x1: 0.88, h: 0.14 },
    tail: { y: 1.1, x0: 0.85, x1: 0.97, h: 0.35 },
    seat: { x: 0.42, y: 1.6, z: 0.7 },
    defaults: { engine: 'v6', drivetrain: 'rwd', diff: 'open', gearTop: 56 },
  },
};

// v2 bodies: a 60s classic, a mid-engine supercar, a box truck and a city bus
Object.assign(BODIES, {
  classic: {
    name: "Marquis '64", kind: 'Classic coupe', L: 4.9, R: 0.34, axles: [1.55, -1.35],
    mass: 1520, comY: 0.5, frontWeight: 0.56, cdA: 0.82, springHz: [1.2, 1.25], travel: [0.17, 0.12],
    top: [[-2.45, 0.82], [-2.4, 0.95], [-2.05, 1.0], [-1.2, 1.01], [-0.85, 1.27], [-0.3, 1.36], [0.25, 1.36], [0.85, 1.0], [1.7, 0.96], [2.3, 0.91], [2.42, 0.83], [2.45, 0.66]],
    belt: [[-2.45, 0.8], [-2.35, 0.93], [-1.3, 0.97], [0, 0.95], [0.85, 0.93], [2.3, 0.88], [2.45, 0.64]],
    bottom: [[-2.45, 0.46], [-2.3, 0.31], [-1.9, 0.27], [1.8, 0.25], [2.3, 0.31], [2.45, 0.45]],
    hw: [[-2.45, 0.84], [-2.3, 0.9], [-1.2, 0.925], [0, 0.905], [1.5, 0.915], [2.3, 0.88], [2.45, 0.8]],
    gh: [[-1.2, 0.8], [-0.3, 0.68], [0.25, 0.68], [0.85, 0.8]],
    zones: { cowl: 0.85, roofF: 0.25, roofR: -0.3, deck: -1.2 },
    doors: { FL: [-0.65, 0.98] },
    sideGlass: [[-1.1, -0.67], [-0.62, 0.95]],
    head: { y: 0.74, x0: 0.55, x1: 0.82, h: 0.1 },
    face: { lamps: 'round' },
    tail: { y: 0.88, x0: 0.3, x1: 0.85, h: 0.09 },
    seat: { x: 0.38, y: 1.0, z: -0.25 },
    defaults: { engine: 'v8', drivetrain: 'rwd', diff: 'open', gearTop: 58 },
  },
  supercar: {
    name: 'Vortex V12', kind: 'Supercar', L: 4.55, R: 0.34, axles: [1.38, -1.32],
    mass: 1420, comY: 0.4, frontWeight: 0.43, cdA: 0.56, springHz: [2.3, 2.45], travel: [0.1, 0.09],
    top: [[-2.275, 0.72], [-2.2, 0.95], [-1.8, 1.02], [-1.2, 1.05], [-0.6, 1.14], [-0.1, 1.17], [0.5, 1.1], [1.1, 0.82], [1.8, 0.66], [2.2, 0.55], [2.275, 0.45]],
    belt: [[-2.275, 0.7], [-2.1, 0.9], [-1.2, 0.92], [-0.1, 0.86], [0.5, 0.84], [1.6, 0.68], [2.2, 0.52], [2.275, 0.42]],
    bottom: [[-2.275, 0.32], [-2.1, 0.18], [-1.8, 0.13], [1.8, 0.12], [2.15, 0.15], [2.275, 0.25]],
    hw: [[-2.275, 0.88], [-2.0, 0.99], [-1.2, 1.0], [-0.4, 0.93], [0.5, 0.92], [1.3, 0.97], [1.9, 0.92], [2.2, 0.82], [2.275, 0.72]],
    gh: [[-1.2, 0.74], [-0.1, 0.58], [0.5, 0.6], [1.1, 0.74]],
    zones: { cowl: 1.1, roofF: 0.5, roofR: -0.1, deck: -1.2 },
    doors: { FL: [-0.55, 1.0] },
    sideGlass: [[-0.95, -0.58], [-0.52, 1.0]],
    head: { y: 0.58, x0: 0.5, x1: 0.84, h: 0.06 },
    face: { lamps: 'slim' },
    tail: { y: 0.82, x0: 0.2, x1: 0.9, h: 0.07 },
    seat: { x: 0.36, y: 0.84, z: -0.15 },
    defaults: { engine: 'v12', drivetrain: 'awd', diff: 'lsd', gearTop: 92, tire: 'sport' },
  },
  truck: {
    name: 'Titan Box 7', kind: 'Box truck', L: 7.2, R: 0.48, axles: [2.6, -2.2],
    mass: 6400, comY: 1.15, frontWeight: 0.45, cdA: 4.0, springHz: [1.35, 1.45], travel: [0.18, 0.15],
    top: [[-3.6, 3.2], [-3.55, 3.3], [1.9, 3.3], [1.95, 2.72], [2.1, 2.72], [2.95, 1.72], [3.3, 1.5], [3.5, 1.3], [3.6, 1.0]],
    belt: [[-3.6, 1.3], [1.95, 1.3], [2.3, 1.55], [2.95, 1.5], [3.3, 1.4], [3.6, 1.0]],
    bottom: [[-3.6, 0.88], [-3.5, 0.72], [3.4, 0.66], [3.6, 0.82]],
    hw: [[-3.6, 1.22], [1.9, 1.22], [2.0, 1.15], [3.4, 1.12], [3.6, 1.04]],
    gh: [[1.95, 0.95], [2.9, 0.92]],
    zones: { cowl: 2.95, roofF: 2.1, roofR: 1.95, deck: -3.55 },
    doors: { FL: [2.0, 2.95] },
    sideGlass: [[2.05, 2.85]],
    head: { y: 0.92, x0: 0.62, x1: 1.0, h: 0.18 },
    tail: { y: 1.0, x0: 0.95, x1: 1.15, h: 0.3 },
    seat: { x: 0.55, y: 2.15, z: 2.05 },
    defaults: { engine: 'diesel', drivetrain: 'rwd', diff: 'open', gearTop: 34, tire: 'offroad' },
  },
  bus: {
    name: 'MetroLiner 12', kind: 'City bus', L: 11.5, R: 0.5, axles: [3.6, -2.6],
    mass: 11500, comY: 1.2, frontWeight: 0.36, cdA: 6.4, springHz: [1.25, 1.3], travel: [0.16, 0.16],
    top: [[-5.75, 2.9], [-5.7, 3.05], [-5.4, 3.12], [5.4, 3.12], [5.5, 3.08], [5.75, 1.3]],
    belt: [[-5.75, 1.3], [5.4, 1.15], [5.75, 0.95]],
    bottom: [[-5.75, 0.78], [-5.6, 0.42], [5.5, 0.42], [5.75, 0.72]],
    hw: [[-5.75, 1.22], [-5.6, 1.27], [5.5, 1.27], [5.75, 1.2]],
    gh: [[-5.5, 0.98], [5.5, 0.98]],
    zones: { cowl: 5.8, roofF: 5.45, roofR: -5.4, deck: -5.6 },
    doors: { FL: [3.9, 5.0], RL: [-0.8, 0.5] },
    sideGlass: [[-5.3, -1.0], [-0.65, 0.35], [0.6, 3.7], [4.0, 5.62]],
    head: { y: 0.85, x0: 0.75, x1: 1.15, h: 0.16 },
    tail: { y: 1.25, x0: 1.05, x1: 1.22, h: 0.42 },
    seat: { x: 0.72, y: 1.95, z: 4.75 },
    defaults: { engine: 'diesel', drivetrain: 'rwd', diff: 'open', gearTop: 25, tire: 'street' },
  },
});

export const PLAYER_BODIES = ['sedan', 'hatch', 'muscle', 'coupe', 'suv', 'pickup', 'van', 'classic', 'supercar', 'truck', 'bus'];

// -----------------------------------------------------------------------------
export const ENGINES = {
  i4: {
    name: '2.0L inline-4', type: 'ice', cylinders: 4, displacement: 2.0, sound: 'i4',
    torque: [[0, 0], [500, 70], [1000, 135], [2000, 170], [3000, 188], [4000, 198], [4800, 200], [5600, 196], [6400, 184], [7000, 166], [7600, 140]],
    idle: 850, redline: 7000, limiter: 7200, inertia: 0.13, friction: [9, 2.6], popiness: 0.8, mass: 120,
  },
  v6: {
    name: '3.5L V6', type: 'ice', cylinders: 6, displacement: 3.5, sound: 'v6',
    torque: [[0, 0], [500, 150], [1000, 250], [2000, 300], [3000, 330], [4000, 345], [4500, 350], [5500, 340], [6200, 318], [6800, 290], [7200, 250]],
    idle: 750, redline: 6800, limiter: 7000, inertia: 0.18, friction: [12, 3.5], popiness: 0.6, mass: 160,
  },
  v8: {
    name: '5.7L V8', type: 'ice', cylinders: 8, displacement: 5.7, sound: 'v8',
    torque: [[0, 0], [500, 280], [1000, 430], [2000, 500], [3000, 530], [4000, 540], [5000, 515], [5800, 480], [6400, 440], [6800, 380]],
    idle: 700, redline: 6400, limiter: 6600, inertia: 0.26, friction: [16, 5], popiness: 1.0, mass: 210,
  },
  i6: {
    name: '3.0L inline-6', type: 'ice', cylinders: 6, displacement: 3.0, sound: 'i6',
    torque: [[0, 0], [500, 150], [1000, 240], [2000, 285], [3000, 300], [4000, 310], [5000, 308], [6000, 295], [7000, 265], [7600, 230]],
    idle: 800, redline: 7200, limiter: 7400, inertia: 0.16, friction: [11, 3.2], popiness: 0.9, mass: 170,
  },
  v12: {
    name: '6.5L V12', type: 'ice', cylinders: 12, displacement: 6.5, sound: 'v12',
    torque: [[0, 0], [500, 260], [1000, 420], [2000, 560], [3000, 640], [4000, 690], [5000, 720], [6000, 715], [7000, 690], [8000, 640], [8700, 560]],
    idle: 950, redline: 8500, limiter: 8800, inertia: 0.2, friction: [18, 5], popiness: 0.9, mass: 260,
  },
  diesel: {
    name: '6.7L turbo-diesel', type: 'ice', cylinders: 6, displacement: 6.7, sound: 'diesel',
    torque: [[0, 0], [400, 420], [700, 820], [1000, 1150], [1300, 1300], [1700, 1300], [2100, 1150], [2500, 900], [2800, 650]],
    idle: 620, redline: 2600, limiter: 2800, inertia: 0.85, friction: [28, 9], popiness: 0.1, mass: 640,
  },
  ev: {
    name: 'Dual-motor electric', type: 'ev', sound: 'ev', maxTorque: 560, maxPower: 310000, maxRPM: 16000,
    idle: 0, redline: 16000, limiter: 16000, mass: 380,
  },
};

export const TURBOS = {
  none: null,
  small: { name: 'Small turbo', gain: 0.4, spoolStart: 1800, spoolFull: 3400, lag: 0.45 },
  big: { name: 'Big turbo', gain: 0.9, spoolStart: 3100, spoolFull: 5300, lag: 1.0 },
};

export const TUNE_STAGES = [1.0, 1.12, 1.25, 1.4];

export const GEARSETS = {
  6: [3.5, 2.1, 1.45, 1.1, 0.87, 0.71],
  5: [3.4, 2.05, 1.38, 1.0, 0.78],
  7: [3.8, 2.3, 1.6, 1.24, 1.0, 0.84, 0.68],
  4: [2.9, 1.75, 1.2, 0.92],
};

/** Each body has its own gearbox character (ratios before the final drive). */
export const BODY_GEARS = {
  sedan: [3.5, 2.1, 1.45, 1.1, 0.87, 0.71],
  hatch: [3.3, 2.15, 1.55, 1.2, 0.98, 0.82], // close ratio
  muscle: [2.97, 1.78, 1.3, 1.0, 0.74], // wide, torquey 5-speed
  coupe: [3.6, 2.3, 1.68, 1.3, 1.06, 0.87], // close ratio sports box
  suv: [4.1, 2.4, 1.55, 1.15, 0.86, 0.68], // low first for towing
  pickup: [4.4, 2.5, 1.55, 1.0, 0.76], // stump-puller first
  van: [3.9, 2.2, 1.42, 1.0, 0.8],
  classic: [2.9, 1.75, 1.2, 0.92], // 4-on-the-floor
  truck: [5.2, 3.1, 1.95, 1.4, 1.0, 0.78],
  supercar: [3.1, 2.15, 1.65, 1.32, 1.1, 0.94, 0.8], // 7-speed DCT
  bus: [3.4, 1.9, 1.3, 1.0, 0.75], // automatic city bus
};
/** Brake capacity relative to a car (big drums and air brakes on the heavy bodies). */
export const BODY_BRAKES = { truck: 0.66, bus: 0.6 };
export const BODY_TANKS = { sedan: 60, hatch: 45, muscle: 70, coupe: 55, suv: 80, pickup: 95, van: 80, classic: 50, truck: 120, supercar: 72, bus: 250 };

export const PAINT_PRESETS = [
  '#b01e23', '#e8e8ea', '#101114', '#1f4fa8', '#f2b90c', '#2b7a3c', '#ff6a13', '#6b6f76',
  '#6d1b7b', '#0fa3b1', '#c8a26b', '#3b2a1e', '#ff3fa4', '#8fd14f', '#27313d', '#d9d4c7',
];

export const DEFAULT_CONFIG = {
  body: 'sedan',
  paint: '#b01e23',
  finish: 'metallic',
  accent: '#141414',
  livery: 'none',
  wheelStyle: 'fivespoke',
  wheelColor: '#c9ccd1',
  wheelSize: 18,
  tire: 'sport',
  engine: 'v6',
  turbo: 'none',
  tune: 0,
  gearbox: 'auto',
  drivetrain: 'rwd',
  diff: 'lsd',
  brakeBias: 0.64,
  rideHeight: 0,
  springs: 1.0,
  dampers: 1.0,
  antiRoll: 1.0,
  spoiler: 'none',
  underglow: 'none',
  tint: 0.35,
  antilag: false,
  headlights: 'xenon',
  horn: 'dual',
  plate: 'SAN 42',
  exhaust: 'sport',
  abs: true,
  tcs: true,
  esc: true,
  weightReduction: 0,
  // v2 tuning
  tirePressure: 2.2, // bar
  camber: -1.0, // degrees (front and rear)
  toe: 0, // degrees, + = toe-in
  finalMul: 1, // final drive multiplier
  gearSpacing: 1, // <1 closer ratios, >1 wider
  lsdPreload: 0.5,
  boost: 1, // turbo boost controller
  brakeKit: false,
  rollCage: false,
  tireWidth: 0, // -1 narrow, 0 stock, +1 wide
  wheelOffset: 0, // spacers, m
  bodyKit: 'stock', // stock | sport | aero
  hoodScoop: false,
  flares: false,
  wheelStyleInterior: 'stock',
  seats: 'stock', // stock | bucket
  gauges: 'analog', // analog | digital
  interiorColor: '#2b2521',
  raceNumber: '',
  twoTone: 'none', // none | roof | lower
  smokedTails: false,
  exhaustTip: 'round', // round | dual | quad | square
  underglowMode: 'steady', // steady | pulse | rainbow
  caliperColor: '#c0392b',
};

export function configForBody(body, base = DEFAULT_CONFIG) {
  const b = BODIES[body];
  const d = b.defaults;
  return {
    ...base,
    body,
    engine: d.engine,
    turbo: d.turbo || 'none',
    drivetrain: d.drivetrain,
    diff: d.diff,
    tire: d.tire || base.tire,
  };
}

/** Physics tuning from a customisation config. */
export function buildTuning(cfg) {
  const body = BODIES[cfg.body] || BODIES.sedan;
  const eng = ENGINES[cfg.engine] || ENGINES.v6;
  const tire = TIRES[cfg.tire] || TIRES.street;
  const g = 9.81;
  const L = body.L;
  const hwMax = Math.max(...body.hw.map((p) => p[1]));
  const W = hwMax * 2;
  const H = Math.max(...body.top.map((p) => p[1]));
  const [zF, zR] = body.axles;
  const WB = zF - zR;
  const R = body.R * (tire.offroad ? 1.04 : 1);

  const mass = body.mass + (eng.mass - 160) - cfg.weightReduction * 120 + (cfg.spoiler === 'gt' ? 12 : 0) + (cfg.rollCage ? 35 : 0) + (cfg.seats === 'bucket' ? -15 : 0);
  const frontWeight = body.frontWeight + (eng.mass - 160) / 4000 - (cfg.drivetrain === 'fwd' ? -0.02 : 0);
  const com = new THREE.Vector3(0, body.comY + cfg.rideHeight * 0.8, zR + frontWeight * WB);
  const inertia = new THREE.Vector3(
    (mass / 12) * (H * H + L * L) * 0.82,
    (mass / 12) * (W * W + L * L) * 0.88,
    (mass / 12) * (W * W + H * H) * 0.7,
  );

  const travel = body.travel || [0.14, 0.1];
  const tireW = tire.width + (cfg.wheelSize - 17) * 0.008 + (cfg.tireWidth || 0) * 0.02;
  const rimR = cfg.wheelSize * 0.0254 * 0.5;
  const wheels = [];
  for (const [id, front, left] of [['FL', true, true], ['FR', true, false], ['RL', false, true], ['RR', false, false]]) {
    const z = front ? zF : zR;
    const hwAt = table(body.hw, z);
    const track = hwAt * 2 - tireW - 0.07 + (cfg.wheelOffset || 0) * 2 + (cfg.flares ? 0.05 : 0);
    const x = (left ? 1 : -1) * track * 0.5;
    const axleLoad = mass * g * (front ? frontWeight : 1 - frontWeight);
    const cornerMass = (axleLoad / g) * 0.5;
    const hz = body.springHz[front ? 0 : 1] * Math.sqrt(cfg.springs);
    const k = cornerMass * (2 * Math.PI * hz) ** 2;
    const crit = 2 * Math.sqrt(k * cornerMass);
    const x0 = (cornerMass * g) / k;
    const sStatic = 0.24 + cfg.rideHeight;
    let share = 0;
    if (cfg.drivetrain === 'fwd') share = front ? 0.5 : 0;
    else if (cfg.drivetrain === 'rwd') share = front ? 0 : 0.5;
    else share = front ? 0.2 : 0.3;
    wheels.push({
      id, front, left,
      steer: front,
      share,
      center: new THREE.Vector3(x, R, z), // design space, at rest
      radius: R,
      rimRadius: rimR,
      width: tireW,
      sStatic,
      L0: sStatic + x0,
      sMax: sStatic + travel[0],
      sMin: sStatic - travel[1],
      k,
      cBump: crit * 0.3 * cfg.dampers,
      cRebound: crit * 0.5 * cfg.dampers,
      inertia: 1.0 + cfg.wheelSize * 0.03,
      brake: front ? cfg.brakeBias * 0.5 : (1 - cfg.brakeBias) * 0.5,
    });
  }
  const kF = wheels[0].k, kR = wheels[2].k;

  const base = BODY_GEARS[cfg.body] || GEARSETS[6];
  // gear spacing keeps first gear and spreads/tightens the rest
  const sp = cfg.gearSpacing || 1;
  const gears = base.map((g) => base[0] * Math.pow(g / base[0], sp));
  const topSpeed = body.defaults.gearTop * (cfg.engine === body.defaults.engine ? 1 : eng === ENGINES.v8 ? 1.06 : eng === ENGINES.i4 ? 0.9 : 1);
  let final;
  const rpmToW = (2 * Math.PI) / 60;
  if (eng.type === 'ev') final = (eng.maxRPM * rpmToW * R) / 72;
  else final = (eng.redline * rpmToW * R) / (topSpeed * base[base.length - 1]);
  final *= cfg.finalMul || 1;
  const turbo = eng.type === 'ev' ? null : TURBOS[cfg.turbo] || null;
  const peakTorque = eng.type === 'ev' ? eng.maxTorque : Math.max(...eng.torque.map((p) => p[1]));
  const powertrain = {
    ...eng,
    gears,
    reverse: 3.3,
    final,
    efficiency: 0.9,
    shiftTime: cfg.gearbox === 'manual' ? 0.15 : 0.2,
    clutchMax: peakTorque * (turbo ? 1 + turbo.gain : 1) * 1.5 * TUNE_STAGES[cfg.tune],
    turbo: turbo ? { ...turbo, gain: turbo.gain * (cfg.boost || 1) } : null,
    tune: TUNE_STAGES[cfg.tune] || 1,
    peakTorque,
    antilag: !!cfg.antilag,
    auto: cfg.gearbox !== 'manual',
    tank: BODY_TANKS[cfg.body] || 55,
    battery: 75,
    carb: cfg.body === 'classic' && eng.type !== 'ev',
    launch: ['coupe', 'supercar', 'muscle'].includes(cfg.body) || cfg.tune >= 2 || eng.type === 'ev',
    launchRPM: eng.type === 'ev' ? 0 : Math.round(eng.redline * 0.58),
  };

  // heavy vehicles can't brake like a car: about 0.6 g for the truck, 0.55 g for the bus
  const brakeTorque = mass * g * 1.35 * R * 1.25 * (cfg.brakeKit ? 1.22 : 1) * (BODY_BRAKES[cfg.body] ?? 1);
  const kit = cfg.bodyKit === 'aero' ? 0.25 : cfg.bodyKit === 'sport' ? 0.1 : 0;
  const clA = (cfg.spoiler === 'gt' ? 0.9 : cfg.spoiler === 'wing' ? 0.55 : cfg.spoiler === 'lip' ? 0.2 : 0.05) + kit;
  return {
    body,
    bodyId: cfg.body,
    mass,
    inertia,
    com,
    dims: { L, W, H, WB, zF, zR },
    wheels,
    antiRoll: [kF * 0.45 * cfg.antiRoll, kR * 0.3 * cfg.antiRoll],
    maxSteer: body.kind === 'City bus' || body.kind === 'Box truck' ? 0.62 : body.kind === 'SUV' || body.kind === 'Pickup' || body.kind === 'Van' ? 0.56 : 0.6,
    brakes: { max: brakeTorque, handbrake: 1900, fadeStart: cfg.brakeKit ? 0.78 : 0.55 },
    aero: { cdA: body.cdA + (cfg.spoiler === 'gt' ? 0.08 : cfg.spoiler === 'wing' ? 0.05 : 0) + kit * 0.12 + (cfg.flares ? 0.02 : 0), clA, balance: cfg.spoiler === 'none' ? (kit ? 0.55 : 0.5) : 0.35 },
    tire,
    powertrain,
    diff: cfg.diff,
    lsdPreload: cfg.lsdPreload ?? 0.5,
    assists: { abs: cfg.abs, tcs: cfg.tcs, esc: cfg.esc },
    rollCenter: 0.12,
    alignment: { pressure: cfg.tirePressure ?? 2.2, camber: cfg.camber ?? -1, toe: cfg.toe ?? 0 },
    rollCage: !!cfg.rollCage,
  };
}

/** Rough performance numbers for the garage screen. */
export function estimateStats(cfg) {
  const t = buildTuning(cfg);
  const p = t.powertrain;
  let peakPower = 0;
  let peakTq = 0;
  const boost = p.turbo ? 1 + p.turbo.gain : 1;
  for (let rpm = 1000; rpm <= (p.type === 'ev' ? p.maxRPM : p.redline); rpm += 100) {
    let tq;
    if (p.type === 'ev') tq = Math.min(p.maxTorque, p.maxPower / ((rpm * 2 * Math.PI) / 60));
    else tq = table(p.torque, rpm) * (p.turbo ? 1 + p.turbo.gain * Math.min(1, Math.max(0, (rpm - p.turbo.spoolStart) / (p.turbo.spoolFull - p.turbo.spoolStart))) : 1);
    tq *= p.tune;
    peakTq = Math.max(peakTq, tq);
    peakPower = Math.max(peakPower, (tq * rpm * 2 * Math.PI) / 60);
  }
  const hp = peakPower / 745.7;
  const pw = peakPower / t.mass; // W/kg
  const grip = t.tire.mu * (t.powertrain && cfg.drivetrain === 'awd' ? 1.1 : 1);
  const zeroTo100 = Math.max(2.3, 1.2 + 470 / pw / Math.sqrt(grip)) * (cfg.gearbox === 'manual' ? 1.02 : 1);
  const vmax = Math.cbrt(peakPower / (0.5 * 1.225 * t.aero.cdA)) * 3.6 * 0.9;
  return { hp: Math.round(hp), torque: Math.round(peakTq * boost / boost), mass: Math.round(t.mass), zeroTo100: zeroTo100.toFixed(1), vmax: Math.round(vmax), boost };
}
