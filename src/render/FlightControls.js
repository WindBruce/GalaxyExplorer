/**
 * Flight controls: an approachable 6DOF-lite space flight model plus the
 * first/third person camera rig.
 *
 * Deliberately arcade: inertial drift with light damping, so the ship feels
 * heavy but always controllable - the priority is exploration, not aerobatics.
 */
import * as THREE from '../../vendor/three.module.js';

export class FlightControls {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {THREE.Object3D} ship
   */
  constructor(camera, ship) {
    this.camera = camera;
    this.ship = ship;
    this.mode = 'third'; // 'first' | 'third'
    this.velocity = new THREE.Vector3();
    this.angularVel = new THREE.Vector3();
    this.maxSpeed = 220;
    this.boostSpeed = 520;
    this.accel = 130;
    this.damping = 0.99;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.autoLevel = true;

    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._quat = new THREE.Quaternion();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._camTarget = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._tmp = new THREE.Vector3();

    this.thrustLevel = 0;
    this.rollLevel = 0;
  }

  toggleCamera() {
    this.mode = this.mode === 'first' ? 'third' : 'first';
    return this.mode;
  }

  get speed() {
    return this.velocity.length();
  }

  /** @param {number} dt seconds @param {import('./Input.js').Input} input @param {number} thrustScale from engine stats */
  update(dt, input, thrustScale = 1) {
    const ship = this.ship;

    // --- Orientation -----------------------------------------------------
    let yaw = 0;
    let pitch = 0;
    let roll = 0;
    if (input) {
      if (input.pointerLocked || input.buttons.size || true) {
        yaw = -input.mouseDX * this.sensitivity;
        pitch = -input.mouseDY * this.sensitivity * (this.invertY ? -1 : 1);
      }
      if (input.isDown('KeyA')) yaw += 1.1 * dt;
      if (input.isDown('KeyD')) yaw -= 1.1 * dt;
      if (input.isDown('KeyQ')) roll += 1.6 * dt;
      if (input.isDown('KeyE')) roll -= 1.6 * dt;
      if (input.isDown('ArrowLeft')) yaw += 1.1 * dt;
      if (input.isDown('ArrowRight')) yaw -= 1.1 * dt;
      if (input.isDown('ArrowUp')) pitch -= 1.1 * dt;
      if (input.isDown('ArrowDown')) pitch += 1.1 * dt;
    }

    this._euler.setFromQuaternion(ship.quaternion, 'YXZ');
    this._euler.y += yaw;
    this._euler.x = THREE.MathUtils.clamp(this._euler.x + pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    if (this.autoLevel && roll === 0) {
      this._euler.z *= Math.pow(0.06, dt);
    } else {
      this._euler.z = THREE.MathUtils.clamp(this._euler.z + roll, -Math.PI, Math.PI);
    }
    ship.quaternion.setFromEuler(this._euler);

    // --- Translation -----------------------------------------------------
    this._forward.set(0, 0, -1).applyQuaternion(ship.quaternion);
    this._right.set(1, 0, 0).applyQuaternion(ship.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(ship.quaternion);

    const boost = input?.isDown('ShiftLeft') || input?.isDown('ShiftRight');
    const maxSpeed = (boost ? this.boostSpeed : this.maxSpeed) * (0.6 + 0.4 * thrustScale);
    const accel = this.accel * thrustScale * (boost ? 2.4 : 1);

    const wish = new THREE.Vector3();
    if (input) {
      if (input.isDown('KeyW')) wish.add(this._forward);
      if (input.isDown('KeyS')) wish.sub(this._forward);
      if (input.isDown('KeyR')) wish.add(this._up);
      if (input.isDown('KeyF')) wish.sub(this._up);
    }
    if (wish.lengthSq() > 0) {
      wish.normalize().multiplyScalar(accel * dt);
      this.velocity.add(wish);
    }
    this.thrustLevel = THREE.MathUtils.lerp(this.thrustLevel, wish.length() > 0 ? (boost ? 1 : 0.65) : 0, dt * 6);

    // Brake / full stop.
    if (input?.isDown('Space')) {
      this.velocity.multiplyScalar(Math.pow(0.02, dt));
    }
    if (input?.justPressed('KeyX')) {
      this.velocity.set(0, 0, 0);
    }

    // Damping + speed clamp.
    this.velocity.multiplyScalar(Math.pow(this.damping, dt * 60));
    const speed = this.velocity.length();
    if (speed > maxSpeed) this.velocity.multiplyScalar(maxSpeed / speed);

    ship.position.addScaledVector(this.velocity, dt);
    this.rollLevel = THREE.MathUtils.lerp(this.rollLevel, Math.abs(this._euler.z) > 0.02 ? Math.sign(this._euler.z) : 0, dt * 4);

    this._updateCamera(dt, boost);
    return { speed, boost, maxSpeed };
  }

  _updateCamera(dt, boost) {
    const ship = this.ship;
    if (this.mode === 'first') {
      this._camPos.set(0, 0.85, -1.4).applyQuaternion(ship.quaternion).add(ship.position);
      this.camera.position.lerp(this._camPos, Math.min(1, dt * 30));
      this._camTarget.copy(ship.position).addScaledVector(this._forward, 100);
      this.camera.lookAt(this._camTarget);
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, boost ? 82 : 70, Math.min(1, dt * 5));
      this.camera.updateProjectionMatrix();
    } else {
      const dist = 15 + this.speed * 0.012;
      this._camPos.copy(ship.position)
        .addScaledVector(this._forward, -dist)
        .addScaledVector(this._up, 4.5);
      this.camera.position.lerp(this._camPos, Math.min(1, dt * 4.5));
      this._camTarget.copy(ship.position).addScaledVector(this._forward, 12);
      this.camera.lookAt(this._camTarget);
      this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, 60, Math.min(1, dt * 5));
      this.camera.updateProjectionMatrix();
    }
  }

  /** Snap the camera behind the ship (used after scene changes). */
  reset(position) {
    if (position) this.ship.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.ship.quaternion.identity();
    this.camera.position.copy(this.ship.position).add(new THREE.Vector3(0, 5, 18));
    this.camera.lookAt(this.ship.position);
  }
}

/**
 * On-foot character controls (planetary surface).
 */
export class CharacterControls {
  constructor(camera, character) {
    this.camera = camera;
    this.character = character;
    this.mode = 'third';
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.sensitivity = 0.0024;
    this.walkSpeed = 9;
    this.sprintSpeed = 17;
    this.jumpSpeed = 9.5;
    this.gravity = 22;
    this.grounded = true;
    this.height = 1.7;
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
  }

  toggleCamera() {
    this.mode = this.mode === 'first' ? 'third' : 'first';
    return this.mode;
  }

  /** @returns {{speed:number, grounded:boolean}} */
  update(dt, input, groundHeight = 0) {
    // Look.
    if (input) {
      this.yaw -= input.mouseDX * this.sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch - input.mouseDY * this.sensitivity, -1.35, 1.35);
    }

    this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const speed = (input?.isDown('ShiftLeft') || input?.isDown('ShiftRight')) ? this.sprintSpeed : this.walkSpeed;
    const wish = new THREE.Vector3();
    if (input) {
      if (input.isDown('KeyW')) wish.add(this._forward);
      if (input.isDown('KeyS')) wish.sub(this._forward);
      if (input.isDown('KeyA')) wish.sub(this._right);
      if (input.isDown('KeyD')) wish.add(this._right);
    }
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, wish.x, Math.min(1, dt * 12));
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, wish.z, Math.min(1, dt * 12));

    // Jump + gravity.
    if (input?.justPressed('Space') && this.grounded) {
      this.velocity.y = this.jumpSpeed;
      this.grounded = false;
    }
    this.velocity.y -= this.gravity * dt;

    this.character.position.addScaledVector(this.velocity, dt);
    const feet = this.character.position.y;
    if (feet <= groundHeight) {
      this.character.position.y = groundHeight;
      this.velocity.y = 0;
      this.grounded = true;
    }

    this.character.rotation.y = this.yaw;

    // Camera.
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    if (this.mode === 'first') {
      this.camera.position.set(
        this.character.position.x,
        this.character.position.y + this.height,
        this.character.position.z
      );
    } else {
      this._camPos.set(
        this.character.position.x - Math.sin(this.yaw) * Math.cos(this.pitch) * 7,
        this.character.position.y + this.height + 2.4 + Math.sin(this.pitch) * 4,
        this.character.position.z - Math.cos(this.yaw) * Math.cos(this.pitch) * 7
      );
      this.camera.position.lerp(this._camPos, Math.min(1, dt * 9));
      const minY = groundHeight + 0.8;
      if (this.camera.position.y < minY) this.camera.position.y = minY;
    }
    return { speed: Math.hypot(this.velocity.x, this.velocity.z), grounded: this.grounded };
  }
}
