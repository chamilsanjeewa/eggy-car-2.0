import { COCKPIT } from "./cockpit";

export type CameraModeId = "follow" | "close" | "wide" | "driver";

export interface CameraMode {
  id: CameraModeId;
  name: string;
  /** Zoom relative to the default fit-to-screen scale. */
  zoom: number;
  /** Zoom out a little as speed builds up. */
  speedZoom: boolean;
  /** How far ahead of the car to look, per m/s of speed (capped by `maxLead`). */
  lead: number;
  maxLead: number;
  /** Camera height above the car's center, in meters. */
  lift: number;
  /** Rotate the view with the car so the car stays level on screen. */
  rotate: boolean;
  /** How quickly the camera catches up (higher = snappier). */
  stiffness: number;
  /** How quickly the view rotation follows the car. */
  angleStiffness: number;
  /** Where the car appears on screen, as fractions of width/height. */
  focusX: number;
  focusY: number;
  /** Camera sits at the driver's eye with the cabin drawn around it. */
  cockpit: boolean;
}

export const CAMERA_MODES: CameraMode[] = [
  { id: "follow", name: "Follow", zoom: 1, speedZoom: true, lead: 0.35, maxLead: 5, lift: 1.2, rotate: false, stiffness: 4, angleStiffness: 5, focusX: 0.5, focusY: 0.5, cockpit: false },
  { id: "close", name: "Close-up", zoom: 1.7, speedZoom: false, lead: 0.12, maxLead: 1.5, lift: 0.5, rotate: false, stiffness: 6, angleStiffness: 5, focusX: 0.5, focusY: 0.5, cockpit: false },
  { id: "wide", name: "Wide", zoom: 0.55, speedZoom: true, lead: 0.6, maxLead: 9, lift: 2.5, rotate: false, stiffness: 3, angleStiffness: 5, focusX: 0.5, focusY: 0.5, cockpit: false },
  // Inside the cab: the camera is the driver's eye, rigidly attached to the truck.
  { id: "driver", name: "Driver view", zoom: 1.4, speedZoom: true, lead: 0, maxLead: 0, lift: 0, rotate: true, stiffness: 30, angleStiffness: 30, focusX: COCKPIT.eyeX, focusY: COCKPIT.eyeY, cockpit: true },
];

export function cameraModeById(id: string): CameraMode {
  return CAMERA_MODES.find((m) => m.id === id) ?? CAMERA_MODES[0];
}

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
