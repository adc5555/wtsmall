/* Thunder Skies - procedural low-poly aircraft models */
(function (global) {
  'use strict';
  const TS = global.TS = global.TS || {};
  const U = TS.Utils;

  const _texCache = {};

  function material(color, opts = {}) {
    return new THREE.MeshStandardMaterial(Object.assign({
      color, metalness: 0.36, roughness: 0.55, flatShading: true
    }, opts));
  }

  function addMesh(parent, geo, mat, pos = [0, 0, 0], rot = [0, 0, 0]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.set(rot[0], rot[1], rot[2]);
    parent.add(m);
    return m;
  }

  // A tapered wing prism, planform in local X/Z. side = -1 left, +1 right.
  function wingGeometry(side, span, rootChord, tipChord, sweep, thickness, leadingZ = 0.3) {
    const rootX = side * 0.62;
    const tipX = side * span;
    const zLeadRoot = leadingZ;
    const zTrailRoot = leadingZ + rootChord;
    const zLeadTip = leadingZ + sweep;
    const zTrailTip = zLeadTip + tipChord;
    const yt = thickness * .5, yb = -thickness * .5;
    const pts = [
      [rootX, yt, zLeadRoot], [rootX, yt, zTrailRoot], [tipX, yt, zTrailTip], [tipX, yt, zLeadTip],
      [rootX, yb, zLeadRoot], [rootX, yb, zTrailRoot], [tipX, yb, zTrailTip], [tipX, yb, zLeadTip]
    ];
    const pos = [];
    pts.forEach(p => pos.push(...p));
    const idx = [
      0, 1, 2, 0, 2, 3,
      4, 6, 5, 4, 7, 6,
      0, 3, 7, 0, 7, 4,
      1, 5, 6, 1, 6, 2,
      0, 4, 5, 0, 5, 1,
      3, 2, 6, 3, 6, 7
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  function addWing(root, side, cfg) {
    const group = new THREE.Group();
    const geo = wingGeometry(side, cfg.span, cfg.rootChord, cfg.tipChord, cfg.sweep, cfg.thickness, cfg.leadingZ == null ? 0.2 : cfg.leadingZ);
    const mesh = new THREE.Mesh(geo, cfg.mat);
    group.add(mesh);
    // tip stripe
    if (cfg.accent) {
      const sx = (cfg.span - 0.55) * side;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.42, cfg.thickness + .055, Math.max(.28, cfg.tipChord * .6)), cfg.accent);
      stripe.position.set(sx, 0, (cfg.leadingZ == null ? 0.2 : cfg.leadingZ) + cfg.sweep + cfg.tipChord * .4);
      group.add(stripe);
    }
    root.add(group);
    return group;
  }

  function addFin(root, mat, accent, height, chord, z, yBase = 0) {
    const g = new THREE.Group();
    // vertical fin as a slanted thin box
    const fin = new THREE.Mesh(new THREE.BoxGeometry(.14, height, chord), mat);
    fin.position.set(0, yBase + height * .5, z);
    fin.rotation.x = -.22;
    g.add(fin);
    if (accent) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(.155, height * .22, chord * .82), accent);
      stripe.position.set(0, yBase + height * .65, z + .01);
      stripe.rotation.x = -.22;
      g.add(stripe);
    }
    root.add(g);
    return g;
  }

  function addCanopy(root, mat, scale, pos) {
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat);
    canopy.scale.set(scale[0], scale[1], scale[2]);
    canopy.position.set(pos[0], pos[1], pos[2]);
    root.add(canopy);
    return canopy;
  }

  function addJetNozzle(root, x, y, z, radius) {
    const dark = material(0x202827, { metalness: .7, roughness: .35 });
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(radius * .95, radius, .8, 10, 1, true), dark);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(x, y, z);
    root.add(nozzle);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius * .86, 12), new THREE.MeshBasicMaterial({ color: 0x0d1211 }));
    disc.rotation.y = Math.PI;
    disc.position.set(x, y, z + .01);
    root.add(disc);
    return nozzle;
  }

  function createFlame(x, y, z, length, color) {
    const geo = new THREE.ConeGeometry(.28, length, 8, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: .7, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2; // cone points +Z, tail
    mesh.position.set(x, y, z + length * .3);
    mesh.visible = false;
    return mesh;
  }

  function missileMesh(kind, accent) {
    const group = new THREE.Group();
    const bodyColor = kind === 'ir' ? 0xc8cec4 : 0xdadfe2;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(.11, .11, 2.45, 7),
      material(bodyColor, { metalness: .45, roughness: .38 })
    );
    body.rotation.x = Math.PI / 2;
    body.position.z = 0;
    group.add(body);
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(.11, .48, 7),
      material(0xbfc5be, { metalness: .5, roughness: .3 })
    );
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -1.42;
    group.add(nose);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(.115, .115, .25, 7),
      new THREE.MeshStandardMaterial({ color: kind === 'ir' ? 0xb8653c : 0x7c8f5c, metalness: .3, roughness: .6 })
    );
    band.rotation.x = Math.PI / 2;
    band.position.z = .55;
    group.add(band);
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(.025, .36, .45), material(0x7d8780));
      fin.position.z = 1.05;
      fin.rotation.z = i * Math.PI / 2;
      group.add(fin);
    }
    const glow = createFlame(0, 0, 1.35, .8, kind === 'ir' ? 0xffb15d : 0xffd579);
    glow.visible = false;
    group.add(glow);
    group.userData = { kind, glow, body };
    return group;
  }

  function createAircraftModel(aircraftId, team) {
    const cfg = TS.CONFIG.getAircraft(aircraftId);
    const teamColor = TS.CONFIG.teamColor(team);
    const accent = new THREE.MeshBasicMaterial({ color: teamColor });
    const isRed = team === 'red';
    const base = new THREE.Color(cfg.colors.fuselage);
    if (isRed) base.offsetHSL(-.012, -.05, -.035);
    const matBody = material(base.getHex());
    const matWing = material(new THREE.Color(cfg.colors.wing).getHex());
    const matDark = material(new THREE.Color(cfg.colors.accent).getHex());
    const matCanopy = material(cfg.colors.canopy, { metalness: .5, roughness: .22, transparent: true, opacity: .76 });
    const root = new THREE.Group();
    const fuselageGroup = new THREE.Group();
    root.add(fuselageGroup);
    const leftWingGroup = new THREE.Group();
    const rightWingGroup = new THREE.Group();
    const tailGroup = new THREE.Group();
    root.add(leftWingGroup, rightWingGroup, tailGroup);

    const model = {
      group: root,
      root,
      parts: {
        fuselage: fuselageGroup,
        leftWing: leftWingGroup,
        rightWing: rightWingGroup,
        tail: tailGroup,
        prop: null,
        propDisc: null,
        flames: [],
        missiles: { ir: [], sarh: [] },
        smokeOffsets: []
      },
      team
    };

    if (aircraftId === 'p51') {
      addMesh(fuselageGroup, new THREE.CylinderGeometry(.58, .64, 6.2, 10), matBody, [0, 0, .3], [Math.PI / 2, 0, 0]);
      addMesh(fuselageGroup, new THREE.ConeGeometry(.62, 2.25, 10), matBody, [0, 0, -3.9], [-Math.PI / 2, 0, 0]);
      addMesh(fuselageGroup, new THREE.CylinderGeometry(.13, .58, 2.5, 10), matBody, [0, 0, 4.55], [Math.PI / 2, 0, 0]);
      addMesh(fuselageGroup, new THREE.BoxGeometry(1.0, .45, 2.4), matDark, [0, -.48, -1.15]);
      addMesh(fuselageGroup, new THREE.BoxGeometry(.75, .32, .8), matDark, [0, -.46, -2.3]);
      addCanopy(fuselageGroup, matCanopy, [.62, .48, 1.25], [0, .55, -.8]);
      addMesh(fuselageGroup, new THREE.BoxGeometry(9.0, .04, .15), accent, [0, .58, 1.7]);
      // prop spinner / blades
      const prop = new THREE.Group();
      prop.position.set(0, 0, -5.0);
      addMesh(prop, new THREE.ConeGeometry(.26, .85, 8), matDark, [0, 0, -.15], [-Math.PI / 2, 0, 0]);
      const bladeMat = material(0x1a2120, { roughness: .8, metalness: .2 });
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(.16, 2.55, .06), bladeMat);
        blade.rotation.z = i * Math.PI * 2 / 3;
        prop.add(blade);
      }
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(2.1, 24),
        new THREE.MeshBasicMaterial({ color: 0x1d2525, transparent: true, opacity: .09, side: THREE.DoubleSide, depthWrite: false })
      );
      disc.position.z = -.0;
      prop.add(disc);
      root.add(prop);
      model.parts.prop = prop;
      model.parts.propDisc = disc;
      model.parts.smokeOffsets.push(new THREE.Vector3(0, .1, 2.5), new THREE.Vector3(0, 0, -1.1));

      addWing(leftWingGroup, -1, {
        mat: matWing, accent, span: 5.65, rootChord: 2.6, tipChord: 1.35, sweep: .2, thickness: .16, leadingZ: .2
      });
      addWing(rightWingGroup, 1, {
        mat: matWing, accent, span: 5.65, rootChord: 2.6, tipChord: 1.35, sweep: .2, thickness: .16, leadingZ: .2
      });
      // horizontal stabilizers
      addWing(tailGroup, -1, { mat: matWing, span: 2.3, rootChord: 1.08, tipChord: .55, sweep: .28, thickness: .11, leadingZ: 3.9 });
      addWing(tailGroup, 1, { mat: matWing, span: 2.3, rootChord: 1.08, tipChord: .55, sweep: .28, thickness: .11, leadingZ: 3.9 });
      addFin(tailGroup, matWing, accent, 1.55, 1.1, 4.38, .15);
      addMesh(tailGroup, new THREE.BoxGeometry(.12, .08, 1.2), accent, [0, 1.62, 4.34]);
    } else if (aircraftId === 'mig15') {
      addMesh(fuselageGroup, new THREE.CylinderGeometry(.64, .7, 7.0, 10), matBody, [0, 0, .25], [Math.PI / 2, 0, 0]);
      const nose = addMesh(fuselageGroup, new THREE.CylinderGeometry(.58, .7, 1.5, 10, 1, true), matDark, [0, 0, -3.75], [Math.PI / 2, 0, 0]);
      addMesh(fuselageGroup, new THREE.CircleGeometry(.56, 12), new THREE.MeshBasicMaterial({ color: 0x081011 }), [0, 0, -4.51], [0, 0, 0]);
      addMesh(fuselageGroup, new THREE.ConeGeometry(.16, .8, 8), matDark, [0, 0, -4.32], [-Math.PI / 2, 0, 0]);
      addMesh(fuselageGroup, new THREE.CylinderGeometry(.13, .55, 2.3, 10), matBody, [0, 0, 4.9], [Math.PI / 2, 0, 0]);
      addCanopy(fuselageGroup, matCanopy, [.55, .48, 1.05], [0, .55, -.6]);
      addJetNozzle(fuselageGroup, 0, 0, 6.1, .45);
      addMesh(fuselageGroup, new THREE.BoxGeometry(7.2, .045, .14), accent, [0, .58, 1.9]);
      const flame = createFlame(0, 0, 6.1, 2.2, 0xffa663);
      fuselageGroup.add(flame);
      model.parts.flames.push(flame);
      model.parts.smokeOffsets.push(new THREE.Vector3(0, 0, 4.2), new THREE.Vector3(0, 0, -1.7));

      addWing(leftWingGroup, -1, {
        mat: matWing, accent, span: 5.1, rootChord: 3.0, tipChord: .92, sweep: 1.7, thickness: .14, leadingZ: -.4
      });
      addWing(rightWingGroup, 1, {
        mat: matWing, accent, span: 5.1, rootChord: 3.0, tipChord: .92, sweep: 1.7, thickness: .14, leadingZ: -.4
      });
      addWing(tailGroup, -1, { mat: matWing, span: 2.35, rootChord: 1.25, tipChord: .45, sweep: .55, thickness: .1, leadingZ: 4.4 });
      addWing(tailGroup, 1, { mat: matWing, span: 2.35, rootChord: 1.25, tipChord: .45, sweep: .55, thickness: .1, leadingZ: 4.4 });
      addFin(tailGroup, matWing, accent, 1.7, 1.0, 4.8, .2);
      addMesh(tailGroup, new THREE.BoxGeometry(.12, .07, 1.0), accent, [0, 1.78, 4.8]);
    } else {
      // F-4E
      addMesh(fuselageGroup, new THREE.CylinderGeometry(.72, .9, 12.7, 12), matBody, [0, 0, .6], [Math.PI / 2, 0, 0]);
      addMesh(fuselageGroup, new THREE.ConeGeometry(.74, 2.3, 12), matBody, [0, 0, -7.15], [-Math.PI / 2, 0, 0]);
      addMesh(fuselageGroup, new THREE.CylinderGeometry(.2, .85, 2.0, 12), matBody, [0, 0, 8.0], [Math.PI / 2, 0, 0]);
      const intakeMat = material(0x353f3b, { metalness: .6, roughness: .35 });
      addMesh(fuselageGroup, new THREE.BoxGeometry(.52, .85, 2.4), intakeMat, [-.95, -.12, -3.35]);
      addMesh(fuselageGroup, new THREE.BoxGeometry(.52, .85, 2.4), intakeMat, [.95, -.12, -3.35]);
      // intake mouths
      addMesh(fuselageGroup, new THREE.BoxGeometry(.43, .72, .08), new THREE.MeshBasicMaterial({ color: 0x081011 }), [-.95, -.12, -4.55]);
      addMesh(fuselageGroup, new THREE.BoxGeometry(.43, .72, .08), new THREE.MeshBasicMaterial({ color: 0x081011 }), [.95, -.12, -4.55]);
      addCanopy(fuselageGroup, matCanopy, [.7, .55, 1.8], [0, .72, -.3]);
      addMesh(fuselageGroup, new THREE.BoxGeometry(9.2, .06, .16), accent, [0, .78, 1.5]);
      addJetNozzle(fuselageGroup, -.55, 0, 9.0, .4);
      addJetNozzle(fuselageGroup, .55, 0, 9.0, .4);
      const f1 = createFlame(-.55, 0, 9.0, 2.8, 0x8bd5ff);
      const f2 = createFlame(.55, 0, 9.0, 2.8, 0x8bd5ff);
      fuselageGroup.add(f1, f2);
      model.parts.flames.push(f1, f2);
      model.parts.smokeOffsets.push(new THREE.Vector3(0, .1, 6.5), new THREE.Vector3(-.55, 0, 7.5));

      addWing(leftWingGroup, -1, {
        mat: matWing, accent, span: 5.7, rootChord: 4.0, tipChord: 1.3, sweep: 1.55, thickness: .17, leadingZ: -1.2
      });
      addWing(rightWingGroup, 1, {
        mat: matWing, accent, span: 5.7, rootChord: 4.0, tipChord: 1.3, sweep: 1.55, thickness: .17, leadingZ: -1.2
      });
      addWing(tailGroup, -1, { mat: matWing, span: 2.75, rootChord: 1.7, tipChord: .62, sweep: .76, thickness: .11, leadingZ: 6.3 });
      addWing(tailGroup, 1, { mat: matWing, span: 2.75, rootChord: 1.7, tipChord: .62, sweep: .76, thickness: .11, leadingZ: 6.3 });
      addFin(tailGroup, matWing, accent, 2.15, 1.55, 7.1, .18);
      addMesh(tailGroup, new THREE.BoxGeometry(.12, .08, 1.4), accent, [0, 2.23, 7.05]);
      // pylons + missiles
      const hardpoints = {
        ir: [[-4.0, -.5, 1.2], [4.0, -.5, 1.2], [-4.0, -.5, 2.5], [4.0, -.5, 2.5]],
        sarh: [[-2.55, -.7, .5], [2.55, -.7, .5]]
      };
      for (const kind of ['ir', 'sarh']) {
        hardpoints[kind].forEach(([x, y, z]) => {
          const pylon = new THREE.Mesh(new THREE.BoxGeometry(.12, .32, .65), matDark);
          pylon.position.set(x, y + .28, z);
          fuselageGroup.add(pylon);
          const msl = missileMesh(kind, accent);
          msl.position.set(x, y, z);
          fuselageGroup.add(msl);
          model.parts.missiles[kind].push(msl);
        });
      }
      // wingtip nav lights
      const lightMatBlue = new THREE.MeshBasicMaterial({ color: 0x6ff0ff });
      const lightMatRed = new THREE.MeshBasicMaterial({ color: 0xff6d5b });
      const l1 = new THREE.Mesh(new THREE.SphereGeometry(.09, 6, 4), lightMatBlue); l1.position.set(-5.7, .04, -1.0);
      const l2 = new THREE.Mesh(new THREE.SphereGeometry(.09, 6, 4), lightMatRed); l2.position.set(5.7, .04, -1.0);
      root.add(l1, l2);
    }

    // team accent around rear fuselage
    const band = new THREE.Mesh(new THREE.CylinderGeometry(.755, .755, .18, 12, 1, true), accent);
    band.rotation.x = Math.PI / 2;
    band.position.set(0, 0, aircraftId === 'f4e' ? 4.2 : (aircraftId === 'mig15' ? 3.8 : 3.2));
    fuselageGroup.add(band);

    root.traverse(o => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        o.frustumCulled = true;
      }
    });
    root.userData = { aircraftId, team, model };
    return model;
  }

  function updateAircraftVisual(model, state, dt) {
    if (!model) return;
    const parts = model.parts;
    if (state.propSpin != null && parts.prop) {
      parts.prop.rotation.z += state.propSpin * dt;
      if (parts.propDisc) parts.propDisc.rotation.z += state.propSpin * dt;
    }
    if (parts.flames.length) {
      const boost = state.boostActive ? 1 : 0;
      const base = 0.35 + (state.throttle || 0) / 100 * 0.55;
      parts.flames.forEach((flame, i) => {
        flame.visible = (state.alive !== false) && (state.throttle || 0) > 2;
        const flicker = 0.78 + Math.random() * 0.34;
        flame.scale.set(
          (0.7 + base * .55) * flicker,
          (0.7 + base * .55) * flicker,
          (boost ? 1.55 : 0.6 + base * .5) * flicker
        );
        flame.material.opacity = flame.visible ? (boost ? .82 : .42) : 0;
      });
    }
    if (parts.leftWing) parts.leftWing.visible = !state.leftWingDestroyed;
    if (parts.rightWing) parts.rightWing.visible = !state.rightWingDestroyed;
    if (parts.tail) parts.tail.visible = !state.tailDestroyed;
    if (state.missiles) {
      for (const kind of ['ir', 'sarh']) {
        const meshes = parts.missiles[kind];
        if (!meshes) continue;
        const remaining = state.missiles[kind];
        meshes.forEach((m, i) => {
          m.visible = i < remaining;
        });
      }
    }
  }

  function createMissileEntityMesh(kind) {
    return missileMesh(kind, null);
  }

  TS.Models = { createAircraftModel, createMissileEntityMesh, updateAircraftVisual, missileMesh };
})(window);
