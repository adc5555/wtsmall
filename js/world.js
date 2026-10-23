/* Thunder Skies - world, terrain, sky and cameras */
(function (global) {
  'use strict';
  const TS = global.TS = global.TS || {};
  const U = TS.Utils;

  class World {
    constructor(canvas) {
      this.canvas = canvas;
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x8fb2bf);
      this.scene.fog = new THREE.Fog(0x9ebfc7, 9000, 34000);
      this.renderer = new THREE.WebGLRenderer({
        canvas, antialias: true, alpha: false, powerPreference: 'high-performance'
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.renderer.shadowMap.enabled = false;
      this.camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, .5, 52000);
      this.camera.position.set(0, 3500, 30);
      this.camera.up.set(0, 1, 0);
      this.cameraShake = 0;
      this.shakeOffset = new THREE.Vector3();
      this.cameraTarget = new THREE.Vector3();
      this.camPos = new THREE.Vector3(0, 3500, 30);
      this.camLook = new THREE.Vector3(0, 3500, -80);
      this.camUp = new THREE.Vector3(0, 1, 0);
      this.displayGroup = new THREE.Group();
      this.scene.add(this.displayGroup);
      this.tmpV = new THREE.Vector3();
      this.tmpV2 = new THREE.Vector3();
      this.tmpQ = new THREE.Quaternion();
      this.tmpUp = new THREE.Vector3();
      this.tmpFwd = new THREE.Vector3();
      this.activeFightersGroup = new THREE.Group();
      this.scene.add(this.activeFightersGroup);
      this.build();
      this.bindResize();
    }

    bindResize() {
      window.addEventListener('resize', () => this.resize());
    }

    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    heightAt(x, z) {
      const r = Math.hypot(x, z);
      const island = 1 - U.smoothstep(10500, 18400, r);
      const broad = U.fbm2(x / 10500 + 2.1, z / 10500 - 1.7, 4);
      const detail = U.fbm2(x / 3300 - 4.2, z / 3300 + 3.1, 3);
      const ridge = 1 - Math.abs(U.fbm2(x / 4700 + 9.1, z / 4700 - 7.3, 3) * 2 - 1);
      let h = -55 + island * (160 + broad * 620 + ridge * 700 + detail * 140);
      // shallow bowl around centre for battle readability
      const center = 1 - U.smoothstep(1200, 5300, r);
      h = U.lerp(h, 300 + detail * 130, center * 0.2);
      return Math.max(-80, h);
    }

    groundHeight(x, z) {
      return Math.max(0, this.heightAt(x, z));
    }

    build() {
      this.buildSky();
      this.buildLights();
      this.buildTerrain();
      this.buildClouds();
    }

    buildSky() {
      const uniforms = {
        topColor: { value: new THREE.Color(0x3c77a0) },
        horizonColor: { value: new THREE.Color(0xbfd6d7) },
        lowerColor: { value: new THREE.Color(0x7c9fa6) },
        sunColor: { value: new THREE.Color(0xffe0a3) },
        sunDir: { value: new THREE.Vector3(.38, .3, -.87).normalize() }
      };
      const mat = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms,
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 horizonColor;
          uniform vec3 lowerColor;
          uniform vec3 sunColor;
          uniform vec3 sunDir;
          varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y, -0.12, 1.0);
            vec3 col;
            if (h < 0.0) col = mix(lowerColor, horizonColor, smoothstep(-0.12, 0.0, h));
            else col = mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.58));
            float sun = pow(max(dot(normalize(vDir), sunDir), 0.0), 230.0);
            float glow = pow(max(dot(normalize(vDir), sunDir), 0.0), 9.0);
            col += sunColor * (sun * 1.2 + glow * 0.16);
            gl_FragColor = vec4(col, 1.0);
          }
        `
      });
      const sky = new THREE.Mesh(new THREE.SphereGeometry(45000, 28, 18), mat);
      sky.frustumCulled = false;
      this.scene.add(sky);
    }

    buildLights() {
      const hemi = new THREE.HemisphereLight(0xc8e6ed, 0x354437, .95);
      this.scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xffe7bd, 2.2);
      sun.position.set(8000, 6000, -15000);
      this.scene.add(sun);
      this.sunLight = sun;
      const fill = new THREE.DirectionalLight(0x9dc8d8, .32);
      fill.position.set(-4000, 2500, 8000);
      this.scene.add(fill);
    }

    buildTerrain() {
      const size = 36000, seg = 170;
      const geo = new THREE.PlaneGeometry(size, size, seg, seg);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colors = [];
      const cLow = new THREE.Color(0x415d4a);
      const cGrass = new THREE.Color(0x586f4c);
      const cRock = new THREE.Color(0x707060);
      const cHigh = new THREE.Color(0xb6b7aa);
      const cSnow = new THREE.Color(0xe3e8e2);
      const cSand = new THREE.Color(0x9b9676);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const y = this.heightAt(x, z);
        pos.setY(i, y);
        let c;
        if (y < 2) c = cSand.clone();
        else if (y < 260) c = cLow.clone().lerp(cGrass, U.clamp(y / 250, 0, 1));
        else if (y < 640) c = cGrass.clone().lerp(cRock, (y - 260) / 380);
        else if (y < 1050) c = cRock.clone().lerp(cHigh, (y - 640) / 410);
        else c = cHigh.clone().lerp(cSnow, U.clamp((y - 1050) / 260, 0, 1));
        const shade = .82 + U.hash2(x * .013, z * .013) * .32;
        c.multiplyScalar(shade);
        colors.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true, flatShading: true, roughness: .98, metalness: 0
      });
      this.terrain = new THREE.Mesh(geo, mat);
      this.terrain.position.y = -.15;
      this.scene.add(this.terrain);

      const waterGeo = new THREE.PlaneGeometry(80000, 80000, 1, 1);
      waterGeo.rotateX(-Math.PI / 2);
      const waterMat = new THREE.MeshStandardMaterial({
        color: 0x1b4b57, roughness: .38, metalness: .24, transparent: true, opacity: .92
      });
      this.water = new THREE.Mesh(waterGeo, waterMat);
      this.water.position.y = 0;
      this.scene.add(this.water);

      // very small airfield-like mark gives scale on the terrain
      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(34, 380),
        new THREE.MeshStandardMaterial({ color: 0x3b3d37, roughness: 1 })
      );
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(900, Math.max(2, this.heightAt(900, 500) + 1), 500);
      this.scene.add(strip);
    }

    makeCloudTexture() {
      if (_cloudTex) return _cloudTex;
      const tex = U.makeCanvasTexture(128, (ctx, s) => {
        const grd = ctx.createRadialGradient(s / 2, s / 2, 3, s / 2, s / 2, s / 2);
        grd.addColorStop(0, 'rgba(255,255,255,0.92)');
        grd.addColorStop(.38, 'rgba(248,252,252,0.58)');
        grd.addColorStop(.76, 'rgba(232,242,245,0.16)');
        grd.addColorStop(1, 'rgba(220,235,240,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, s, s);
      });
      _cloudTex = tex;
      return tex;
    }

    buildClouds() {
      const tex = this.makeCloudTexture();
      this.cloudGroup = new THREE.Group();
      const materialBase = new THREE.SpriteMaterial({
        map: tex, color: 0xffffff, transparent: true, opacity: .5,
        depthWrite: false, fog: true
      });
      for (let i = 0; i < 34; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = U.rand(2500, 23000);
        const cx = Math.cos(angle) * radius;
        const cz = Math.sin(angle) * radius;
        const alt = U.rand(950, 3900);
        const puffs = U.randInt(3, 6);
        for (let j = 0; j < puffs; j++) {
          const sprite = new THREE.Sprite(materialBase.clone());
          const sc = U.rand(220, 620);
          sprite.scale.set(sc * U.rand(.8, 1.5), sc * U.rand(.4, .68), 1);
          sprite.position.set(
            cx + U.rand(-460, 460),
            alt + U.rand(-70, 90),
            cz + U.rand(-460, 460)
          );
          sprite.material.opacity = U.rand(.22, .48);
          this.cloudGroup.add(sprite);
        }
      }
      this.scene.add(this.cloudGroup);
    }

    getLosClear(from, to, steps = 8) {
      const d = this.tmpV.subVectors(to, from);
      const len = d.length();
      if (len < 50) return true;
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = from.x + d.x * t;
        const y = from.y + d.y * t;
        const z = from.z + d.z * t;
        if (y < this.heightAt(x, z) + 2) return false;
      }
      return true;
    }

    updateShowcase(aircraftGroup, dt, elapsed) {
      if (!aircraftGroup) return;
      aircraftGroup.position.set(0, 3200, 0);
      aircraftGroup.rotation.set(0, 0, 0);
      const angle = elapsed * .10;
      const r = 27;
      this.camPos.set(Math.sin(angle) * r, 3200 + 6.5, Math.cos(angle) * r);
      this.camLook.set(0, 3198 + Math.sin(elapsed * .2) * .8, 0);
      this.camUp.set(0, 1, 0);
      this.camera.position.copy(this.camPos);
      this.camera.up.copy(this.camUp);
      this.camera.lookAt(this.camLook);
      this.camera.fov = 44;
      this.camera.updateProjectionMatrix();
    }

    updateChase(fighter, dt, freeLook, inputLook, zooming) {
      if (!fighter) return;
      const q = fighter.quaternion;
      const fwd = this.tmpFwd.set(0, 0, -1).applyQuaternion(q);
      const camCfg = TS.CONFIG.getAircraft(fighter.aircraftId).camera;
      const speedNorm = U.clamp(fighter.speed / 340, 0, 1.3);
      const boost = fighter.throttle > 100 ? 1 : 0;
      const baseFov = 55 + speedNorm * 7 + boost * 2.5;
      // Right mouse toggles a ~5x spotting optic. It ramps smoothly and does not
      // alter the aircraft's flight controls directly.
      const desiredFov = zooming ? Math.max(9, baseFov / 5) : baseFov;
      this.camera.fov = U.damp(this.camera.fov, desiredFov, 6, dt);
      this.camera.updateProjectionMatrix();

      // Horizon-stable chase camera: position follows heading and pitch, but the
      // camera is NOT rolled by the aircraft. This is much easier to read than a
      // fully attached camera and mirrors the reference game's third-person view.
      const worldUp = new THREE.Vector3(0, 1, 0);
      const camRight = new THREE.Vector3().crossVectors(fwd, worldUp).normalize();
      const realUp = new THREE.Vector3().crossVectors(camRight, fwd).normalize();

      let desiredPos;
      let lookTarget;
      let cameraUp = realUp;
      if (freeLook) {
        // Orbit around the aircraft with a stable horizon. Mouse yaw/pitch
        // control the orbit angle; the camera itself no longer just swivels in place.
        const heading = Math.atan2(fwd.x, -fwd.z);
        const lookYaw = inputLook ? inputLook.yaw : 0;
        const lookPitch = inputLook ? inputLook.pitch : 0;
        const baseElevation = Math.atan2(camCfg.height, camCfg.distance);
        const elevation = U.clamp(baseElevation - lookPitch, -.35, 1.32);
        const azimuth = heading + Math.PI - lookYaw;
        const radius = Math.max(22, (fighter.cfg.model?.length || 12) * 1.25);
        const horizontal = Math.cos(elevation) * radius;
        desiredPos = this.tmpV2.copy(fighter.pos)
          .add(new THREE.Vector3(Math.sin(azimuth) * horizontal, Math.sin(elevation) * radius, -Math.cos(azimuth) * horizontal));
        lookTarget = fighter.pos.clone().addScaledVector(fwd, 1.5).add(new THREE.Vector3(0, 1.0, 0));
        cameraUp = worldUp;
      } else {
        desiredPos = this.tmpV2.copy(fighter.pos)
          .addScaledVector(fwd, -camCfg.distance)
          .addScaledVector(realUp, camCfg.height);
        lookTarget = new THREE.Vector3().copy(this.camPos).addScaledVector(fwd, 300);
        lookTarget.addScaledVector(fwd, camCfg.lookAhead * .45);
      }

      const ground = this.heightAt(desiredPos.x, desiredPos.z) + 4;
      if (desiredPos.y < ground) desiredPos.y = ground;
      // Keep the camera at a consistent distance while the aircraft moves fast:
      // carry the target's frame displacement before applying angular smoothing.
      const travel = new THREE.Vector3().subVectors(fighter.pos, fighter.prevPos);
      this.camPos.add(travel);
      this.camLook.add(travel);
      const sm = 1 - Math.exp(-18 * dt);
      this.camPos.lerp(desiredPos, sm);
      this.camLook.lerp(lookTarget, 1 - Math.exp(-16 * dt));

      let shake = this.cameraShake;
      if (shake > .001) {
        if (zooming) shake *= .2;
        this.shakeOffset.set(U.rand(-1, 1), U.rand(-1, 1), U.rand(-1, 1)).multiplyScalar(shake);
        this.cameraShake = Math.max(0, this.cameraShake - dt * 1.9);
      } else {
        this.shakeOffset.set(0, 0, 0);
        this.cameraShake = 0;
      }
      this.camera.position.copy(this.camPos).add(this.shakeOffset);
      this.camera.up.copy(cameraUp);
      this.camera.lookAt(this.camLook.clone().add(this.shakeOffset));
    }

    updateSpectator(fighter, dt, zooming) {
      if (!fighter) return;
      const q = fighter.quaternion;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const worldUp = new THREE.Vector3(0, 1, 0);
      const desiredPos = new THREE.Vector3().copy(fighter.pos)
        .addScaledVector(fwd, -30).addScaledVector(worldUp, 10);
      this.camPos.lerp(desiredPos, 1 - Math.exp(-4 * dt));
      this.camLook.lerp(new THREE.Vector3().copy(fighter.pos).addScaledVector(fwd, 55), 1 - Math.exp(-6 * dt));
      this.camera.position.copy(this.camPos);
      this.camera.up.copy(worldUp);
      this.camera.lookAt(this.camLook);
      this.camera.fov = U.damp(this.camera.fov, zooming ? 11.2 : 56, 4, dt);
      this.camera.updateProjectionMatrix();
    }

    addShake(amount) {
      this.cameraShake = Math.min(4, this.cameraShake + amount);
    }

    updateEffects(dt) {
      // clouds drift extremely slowly
      if (this.cloudGroup) {
        this.cloudGroup.position.x = Math.sin(performance.now() * .00001) * 80;
      }
    }

    render() {
      this.renderer.render(this.scene, this.camera);
    }
  }

  let _cloudTex = null;
  TS.World = World;
})(window);
