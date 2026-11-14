/**
 * Tutorial hint for L01: a small drawn sign over the one tile to turn, two
 * fingertips meeting (pinch) inside a clockwise arrow, the same ring the gaze
 * dwell draws. No text, so it needs no translation. It turns to face the head
 * every frame and never takes pointer or gaze hits.
 */
import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Object3D,
  type Vector3,
} from '@iwsdk/core';
import { PALETTE } from '../theme/index.ts';

/** Sign size and height over the tile center, m. Design value. */
const HINT_SIZE = 0.045;
const HINT_LIFT = 0.055;
/** Canvas pixels. Design value. */
const HINT_PX = 256;

function draw(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const s = HINT_PX;
  const c = s / 2;
  ctx.clearRect(0, 0, s, s);
  // Dark disc with a light rim.
  ctx.fillStyle = PALETTE.panelBg;
  ctx.strokeStyle = PALETTE.panelText;
  ctx.lineWidth = s * 0.035;
  ctx.beginPath();
  ctx.arc(c, c, s * 0.46, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Clockwise arrow around the middle.
  const r = s * 0.3;
  const a0 = -Math.PI * 0.85;
  const a1 = Math.PI * 0.55;
  ctx.strokeStyle = PALETTE.panelAccent;
  ctx.lineWidth = s * 0.06;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(c, c, r, a0, a1);
  ctx.stroke();
  const tipX = c + Math.cos(a1) * r;
  const tipY = c + Math.sin(a1) * r;
  // Arrow head pointing along the clockwise tangent at a1.
  const tx = -Math.sin(a1);
  const ty = Math.cos(a1);
  const nx = Math.cos(a1);
  const ny = Math.sin(a1);
  const h = s * 0.1;
  ctx.fillStyle = PALETTE.panelAccent;
  ctx.beginPath();
  ctx.moveTo(tipX + tx * h, tipY + ty * h);
  ctx.lineTo(tipX - tx * h * 0.2 + nx * h * 0.8, tipY - ty * h * 0.2 + ny * h * 0.8);
  ctx.lineTo(tipX - tx * h * 0.2 - nx * h * 0.8, tipY - ty * h * 0.2 - ny * h * 0.8);
  ctx.closePath();
  ctx.fill();
  // Thumb and index tips meeting in the middle.
  ctx.fillStyle = PALETTE.panelText;
  for (const dx of [-0.06, 0.06]) {
    ctx.beginPath();
    ctx.arc(c + dx * s, c, s * 0.065, 0, Math.PI * 2);
    ctx.fill();
  }
}

export class TutorialHint {
  readonly mesh: Mesh;
  private readonly texture: CanvasTexture | null;
  private readonly material: MeshBasicMaterial;
  private readonly geometry = new PlaneGeometry(HINT_SIZE, HINT_SIZE);

  constructor() {
    let texture: CanvasTexture | null = null;
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = HINT_PX;
      canvas.height = HINT_PX;
      draw(canvas);
      texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
    }
    this.texture = texture;
    this.material = new MeshBasicMaterial({
      map: texture,
      transparent: true,
      toneMapped: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.name = 'tutorial-hint';
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
    // Never a pointer or gaze target: the tile under it keeps every hit.
    this.mesh.raycast = () => {};
  }

  addTo(parent: Object3D): void {
    parent.add(this.mesh);
  }

  show(at: { x: number; y: number; z: number }): void {
    this.mesh.position.set(at.x, at.y + HINT_LIFT, at.z);
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  /** Turns the sign toward the head. */
  face(head: Vector3): void {
    if (this.mesh.visible) {
      this.mesh.lookAt(head);
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.texture?.dispose();
  }
}
