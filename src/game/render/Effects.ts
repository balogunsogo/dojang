import * as THREE from 'three';

/**
 * Pooled impact effects (no allocation during play) and blob shadows used
 * when real-time shadows are disabled on low-end devices.
 */
export class Effects {
  readonly group = new THREE.Group();
  private flashes: { mesh: THREE.Mesh; life: number; max: number; scale: number }[] = [];
  private blobs: THREE.Mesh[] = [];
  private flashGeo = new THREE.RingGeometry(0.05, 0.16, 24);
  private flashMatHit = new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  private flashMatBlock = new THREE.MeshBasicMaterial({ color: '#9ec9ff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  private blobGeo = new THREE.CircleGeometry(0.42, 20);
  private blobMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.32, depthWrite: false });

  constructor(blobShadows: boolean) {
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(this.flashGeo, this.flashMatHit.clone());
      mesh.visible = false;
      mesh.renderOrder = 10;
      this.group.add(mesh);
      this.flashes.push({ mesh, life: 0, max: 1, scale: 1 });
    }
    if (blobShadows) {
      for (let i = 0; i < 2; i++) {
        const b = new THREE.Mesh(this.blobGeo, this.blobMat);
        b.rotation.x = -Math.PI / 2;
        b.position.y = 0.04;
        this.group.add(b);
        this.blobs.push(b);
      }
    }
  }

  spawn(pos: [number, number, number], kind: 'hit' | 'heavy' | 'block') {
    const f = this.flashes.reduce((a, b) => (a.life < b.life ? a : b));
    f.mesh.position.set(pos[0], pos[1], pos[2]);
    f.mesh.visible = true;
    f.max = f.life = kind === 'block' ? 0.16 : 0.24;
    f.scale = kind === 'heavy' ? 2.6 : kind === 'hit' ? 1.8 : 1.4;
    const mat = f.mesh.material as THREE.MeshBasicMaterial;
    mat.color.copy((kind === 'block' ? this.flashMatBlock : this.flashMatHit).color);
  }

  update(dt: number, camera: THREE.Camera, fighters: { x: number; z: number }[]) {
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const k = 1 - Math.max(0, f.life) / f.max;
      f.mesh.quaternion.copy(camera.quaternion);
      f.mesh.scale.setScalar(0.6 + k * f.scale);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      if (f.life <= 0) f.mesh.visible = false;
    }
    this.blobs.forEach((b, i) => {
      const f = fighters[i];
      if (f) b.position.set(f.x, 0.04, f.z);
    });
  }

  dispose() {
    this.flashGeo.dispose();
    this.blobGeo.dispose();
    this.blobMat.dispose();
    this.flashMatHit.dispose();
    this.flashMatBlock.dispose();
    for (const f of this.flashes) (f.mesh.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}
