import { COCKPIT } from "./cockpit";

export type CameraModeId = "follow" | "close" | "wide" | "driver" | "chase" | "drone";

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
  /** A true 3D view from behind the car (3D graphics); the classic 2D view uses the fields above. */
  behind?: boolean;
}

export const CAMERA_MODES: CameraMode[] = [
  // Behind the car looking down the road, like a racing game (3D). In 2D it plays like a tight follow cam.
  { id: "chase", name: "Chase cam (3D)", zoom: 1.3, speedZoom: true, lead: 0.25, maxLead: 3, lift: 0.8, rotate: false, stiffness: 5, angleStiffness: 5, focusX: 0.5, focusY: 0.5, cockpit: false, behind: true },
  // High aerial shot trailing behind and above (3D). In 2D it plays like the wide view.
  { id: "drone", name: "Drone (3D)", zoom: 0.6, speedZoom: true, lead: 0.55, maxLead: 8, lift: 2.2, rotate: false, stiffness: 3, angleStiffness: 5, focusX: 0.5, focusY: 0.5, cockpit: false, behind: true },
  { id: "follow", name: "Follow", zoom: 1, speedZoom: true, lead: 0.35, maxLead: 5, lift: 1.2, rotate: false, stiffness: 4, angleStiffness: 5, focusX: 0.5, focusY: 0.5, cockpit: false },
  { id: "close", name: "Close-up 3/4", zoom: 1.7, speedZoom: false, lead: 0.12, maxLead: 1.5, lift: 0.5, rotate: false, stiffness: 6, angleStiffness: 5, focusX: 0.5, focusY: 0.5, cockpit: false },
  { id: "wide", name: "Wide crane", zoom: 0.55, speedZoom: true, lead: 0.6, maxLead: 9, lift: 2.5, rotate: false, stiffness: 3, angleStiffness: 5, focusX: 0.5, focusY: 0.5, cockpit: false },
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
