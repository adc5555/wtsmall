"""Thunder Skies smoke test.

Run with:  python tests/smoke_test.py
Requires Playwright + Chromium (the environment already provides them).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
URL = ROOT.joinpath("index.html").as_uri() + "?test=1"

CHECKS = []


def check(name, condition, detail=""):
    CHECKS.append((name, bool(condition), detail))
    print(("PASS " if condition else "FAIL ") + name + (("  " + str(detail)) if detail and not condition else ""))


def wait_state(page, state, timeout=15000):
    page.wait_for_function(
        "s => window.__thunder && window.__thunder.snapshot().state === s",
        arg=state,
        timeout=timeout,
    )


def wait_battle(page):
    page.wait_for_function(
        "() => window.__thunder && ['battle','spectating','result'].includes(window.__thunder.snapshot().state)",
        timeout=20000,
    )


def main():
    errors = []
    console_errors = []
    requests = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
        )
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("request", lambda r: requests.append(r.url))
        page.goto(URL, wait_until="load")
        page.wait_for_timeout(700)

        check("canvas boots", page.locator("#scene").is_visible())
        check("hangar shown", "active" in (page.locator("#menu").get_attribute("class") or ""))
        snap = page.evaluate("() => window.__thunder.snapshot()")
        check("initial state hangar", snap["state"] == "hangar")

        # ---- key rebinding and persistence ---------------------------------
        page.locator("#openSettingsBtn").click()
        page.wait_for_timeout(120)
        page.locator('.binding-key[data-action="pitchUp"]').click()
        page.keyboard.press("KeyR")
        page.wait_for_timeout(120)
        rebound = page.evaluate("() => TS.Settings.get('pitchUp')")
        check("key rebinding applies", rebound == "KeyR", rebound)
        page.locator("#saveSettingsBtn").click()
        page.reload(wait_until="load")
        page.wait_for_timeout(500)
        persisted = page.evaluate("() => TS.Settings.get('pitchUp')")
        check("key rebinding persists", persisted == "KeyR", persisted)
        # restore defaults for the remaining tests
        page.evaluate("() => { TS.Settings.resetBindings(); }")

        # ---- start an 8v8 F-4E battle --------------------------------------
        page.evaluate("() => window.__thunder.startBattle('f4e', 8)")
        page.evaluate("() => window.__thunder.skipCountdown()")
        wait_battle(page)
        page.wait_for_timeout(400)
        snap = page.evaluate("() => window.__thunder.snapshot()")
        check("8v8 teams spawn", snap["alive"] == {"blue": 8, "red": 8}, snap["alive"])
        check("all aircraft are F-4E", all(f["aircraftId"] == "f4e" for f in snap["fighters"]))
        check("radar has contacts", len(snap["radarContacts"]) > 0, len(snap["radarContacts"]))
        check("F-4E missiles loaded", snap["player"]["missiles"] == {"ir": 4, "sarh": 2}, snap["player"]["missiles"])
        cm_total = snap["player"]["flares"] + snap["player"]["chaff"]
        check("countermeasure total is 60", cm_total == 60, cm_total)
        check("no run-time cross-origin requests", all(u.startswith("file:") for u in requests),
              [u for u in requests if not u.startswith("file:")][:3])

        # Horizontal mouse aim now auto-banks (bounded), while vertical aim alone
        # must not roll. The chase camera must remain horizon-stable during the bank.
        page.evaluate("() => { const g=window.__tsGame; g.player.orientFromYaw(0); window.__thunder.setAim(.55, 0); }")
        page.wait_for_timeout(800)
        bank = page.evaluate("() => window.__tsGame.player.getBankAngle()")
        cam_up = page.evaluate(
            "() => { const c=window.__tsGame.world.camera; return {x:new THREE.Vector3(0,1,0).applyQuaternion(c.quaternion).x, y:new THREE.Vector3(0,1,0).applyQuaternion(c.quaternion).y}; }"
        )
        check("mouse aim auto-banks", bank > .12 and bank < 1.0, bank)
        check("chase camera does not roll", abs(cam_up["x"]) < .12 and cam_up["y"] > .8, cam_up)
        # The aim point must remain a world direction and converge toward the nose.
        aim_before = page.evaluate("() => window.__thunder.snapshot()['aimDir']")
        page.wait_for_timeout(1200)
        aim_after = page.evaluate("() => window.__thunder.snapshot()['aimDir']")
        same_world_aim = (abs(aim_before["x"] - aim_after["x"]) + abs(aim_before["y"] - aim_after["y"]) + abs(aim_before["z"] - aim_after["z"])) < .02
        check("mouse aim target is world-stable", same_world_aim, (aim_before, aim_after))
        aim_ndc = page.evaluate(
            """() => {
              const g=window.__tsGame,p=g.player,c=g.world.camera;
              const world=p.pos.clone().addScaledVector(g.aimDir,1200);
              const v=world.project(c);
              return {x:v.x, y:v.y};
            }"""
        )
        check("mouse aim marker recenters as nose aligns", abs(aim_ndc["x"]) < .3 and abs(aim_ndc["y"]) < .4, aim_ndc)
        page.evaluate(
            """() => {
              const g=window.__tsGame;
              g.player.orientFromYaw(0);
              g.player.rate = {pitch:0, yaw:0, roll:0};
              g.aimDir.copy(g.player.forward);
            }"""
        )
        page.wait_for_timeout(600)
        page.evaluate("() => window.__thunder.setAim(0, .7)")
        page.wait_for_timeout(900)
        bank_down = page.evaluate("() => Math.abs(window.__tsGame.player.getBankAngle())")
        check("nose-down mouse aim does not spin", bank_down < .2, bank_down)
        page.evaluate("() => window.__thunder.setAim(0, 0)")

        # Repeated throttle taps and OS key-repeat must not leave keys stuck.
        page.evaluate("() => { window.__tsGame.player.throttle = 50; window.__tsGame.input.clearHeld(); }")
        page.wait_for_timeout(250)
        page.keyboard.press("Shift")
        page.wait_for_timeout(300)
        t1 = page.evaluate("() => window.__tsGame.player.throttle")
        page.keyboard.press("Shift")
        page.wait_for_timeout(300)
        t2 = page.evaluate("() => window.__tsGame.player.throttle")
        check("repeated throttle taps work", t1 > 50 and t2 > t1, (t1, t2))
        page.evaluate(
            """() => {
              window.dispatchEvent(new KeyboardEvent('keydown', {code:'ShiftLeft', key:'Shift', bubbles:true, repeat:false}));
              for (let i = 0; i < 8; i++) window.dispatchEvent(new KeyboardEvent('keydown', {code:'ShiftLeft', key:'Shift', bubbles:true, repeat:true}));
            }"""
        )
        page.wait_for_timeout(250)
        page.evaluate("() => window.dispatchEvent(new KeyboardEvent('keyup', {code:'ShiftLeft', key:'Shift', bubbles:true}))")
        page.wait_for_timeout(200)
        stuck = page.evaluate("() => window.__tsGame.input.isDown('throttleUp')")
        t3 = page.evaluate("() => window.__tsGame.player.throttle")
        page.wait_for_timeout(450)
        t4 = page.evaluate("() => window.__tsGame.player.throttle")
        check("throttle key repeat does not stick", not stuck and abs(t4 - t3) < 1.5, (stuck, t3, t4))

        # ---- zoom vs missile binding ---------------------------------------
        fov0 = page.evaluate("() => window.__tsGame.world.camera.fov")
        counts0 = page.evaluate("() => window.__tsGame.player.missileCounts")
        page.mouse.down(button="right")
        page.mouse.up(button="right")
        page.wait_for_timeout(900)
        fov1 = page.evaluate("() => window.__tsGame.world.camera.fov")
        zoomed = page.evaluate("() => window.__tsGame.zoomActive")
        counts1 = page.evaluate("() => window.__tsGame.player.missileCounts")
        check("right click toggles ~5x zoom", zoomed and fov0 / max(fov1, .1) > 3.5, (fov0, fov1, zoomed))
        check("right click stays zoomed after release", zoomed)
        check("zoom click does not fire", counts0 == counts1, (counts0, counts1))
        page.mouse.down(button="right")
        page.mouse.up(button="right")
        page.wait_for_timeout(600)
        fov2 = page.evaluate("() => window.__tsGame.world.camera.fov")
        zoom_off = page.evaluate("() => !window.__tsGame.zoomActive")
        check("second click restores view", zoom_off and fov2 > fov1 * 2, (fov1, fov2, zoom_off))

        # Free look must orbit the camera around the airframe, not swivel in place.
        before_orbit = page.evaluate(
            """() => {
              const g=window.__tsGame, p=g.player, c=g.world.camera;
              const v=new THREE.Vector3().subVectors(c.position,p.pos);
              return {dist:v.length(), x:v.x, z:v.z};
            }"""
        )
        page.keyboard.down("c")
        page.wait_for_timeout(250)
        page.evaluate("() => { window.__tsGame.input.look.yaw = 1.1; window.__tsGame.input.look.pitch = .2; }")
        page.wait_for_timeout(800)
        orbit = page.evaluate(
            """() => {
              const g=window.__tsGame, p=g.player, c=g.world.camera;
              const v=new THREE.Vector3().subVectors(c.position,p.pos);
              return {dist:v.length(), x:v.x, z:v.z};
            }"""
        )
        page.keyboard.up("c")
        page.wait_for_timeout(800)
        after_orbit = page.evaluate(
            """() => {
              const g=window.__tsGame, p=g.player, c=g.world.camera;
              const v=new THREE.Vector3().subVectors(c.position,p.pos);
              return {dist:v.length(), x:v.x, z:v.z};
            }"""
        )
        def hnorm(v):
            import math
            l = math.hypot(v["x"], v["z"]) or 1
            return v["x"] / l, v["z"] / l
        b = hnorm(before_orbit)
        o = hnorm(orbit)
        dot = abs(b[0] * o[0] + b[1] * o[1])
        check("free look orbits the camera", orbit["dist"] > 15 and dot < .75, (before_orbit, orbit, dot))
        a = hnorm(after_orbit)
        return_dot = abs(b[0] * a[0] + b[1] * a[1])
        check("free look returns to chase", return_dot > .86, (before_orbit, after_orbit, return_dot))

        # ---- modular damage -------------------------------------------------
        red_alive0 = page.evaluate("() => window.__tsGame.aliveCount('red')")
        killed = page.evaluate("() => window.__thunder.hitFighter('red-2','leftWing',9999,'blue-1')")
        page.wait_for_timeout(150)
        red_alive1 = page.evaluate("() => window.__tsGame.aliveCount('red')")
        check("detached wing removes aircraft", red_alive1 == red_alive0 - 1, (red_alive0, red_alive1, killed))
        engine_damage = page.evaluate("() => window.__thunder.hitFighter('red-3','engine',40,'blue-1')")
        check("engine module takes damage", engine_damage["modules"]["engine"] < 1,
              engine_damage["modules"]["engine"])

        # ---- IR missile launch and powered/coasting phases ------------------
        page.evaluate(
            """() => {
              const g = window.__tsGame, p = g.player, t = g.fighters.find(f => f.id === 'red-1');
              p.pos.set(0, 3400, 0); p.prevPos.copy(p.pos); p.orientFromYaw(0);
              p.model.group.position.copy(p.pos); p.model.group.quaternion.copy(p.quaternion);
              p.speed = 300; p.throttle = 100;
              t.pos.set(0, 3400, -1900); t.prevPos.copy(t.pos); t.orientFromYaw(0);
              t.model.group.position.copy(t.pos); t.model.group.quaternion.copy(t.quaternion);
              t.speed = 230; t.throttle = 80; t.flares = 0; t.chaff = 0;
              t.ai.target = null; t.ai.decisionTimer = 999; t.ai.desired = t.forward.clone();
              window.__thunder.forceTarget('red-1');
            }"""
        )
        page.wait_for_timeout(300)
        page.keyboard.press("1")
        page.keyboard.press("Space")
        page.wait_for_timeout(200)
        snap = page.evaluate("() => window.__thunder.snapshot()")
        check("space launches IR missile", snap["player"]["missiles"]["ir"] == 3,
              snap["player"]["missiles"])
        player_missiles = [m for m in snap["missiles"] if m["owner"] == "blue-1"]
        check("missile entity exists", len(player_missiles) >= 1, player_missiles)
        if player_missiles:
            check("missile starts powered", player_missiles[0]["phase"] in ("launch", "boost", "sustain"),
                  player_missiles[0]["phase"])

        # Give the missile a few seconds to demonstrate coasting/hit.
        saw_coast = False
        for _ in range(16):
            page.wait_for_timeout(250)
            snap = page.evaluate("() => window.__thunder.snapshot()")
            msl = [m for m in snap["missiles"] if m["owner"] == "blue-1"]
            if any(m["phase"] == "coast" for m in msl):
                saw_coast = True
            if not msl:
                break
        check("missile reaches the coast phase", saw_coast)

        # ---- 38 km radar and clutter ---------------------------------------
        radar = page.evaluate(
            """() => {
              const g = window.__tsGame, p = g.player, t = g.fighters.find(f => f.id === 'red-4');
              p.pos.set(0, 5000, 0); p.prevPos.copy(p.pos); p.orientFromYaw(0);
              t.pos.set(0, 5200, -34000); t.prevPos.copy(t.pos); t.orientFromYaw(0);
              t.ai.target = null; t.ai.decisionTimer = 999; t.ai.desired = t.forward.clone();
              t.model.group.position.copy(t.pos);
              TS.Radar.scan(p, g);
              const far = (p.radar.contacts || []).filter(c => c.fighter.id === 'red-4').map(c => ({ dist: c.dist, clutter: c.clutter }));
              const ground = g.world.heightAt(0, -10000);
              t.pos.set(0, ground + 180, -10000); t.prevPos.copy(t.pos);
              TS.Radar.scan(p, g);
              const low = (p.radar.contacts || []).filter(c => c.fighter.id === 'red-4').map(c => ({ dist: c.dist, clutter: c.clutter }));
              return { far, low };
            }"""
        )
        check("radar sees a 34 km contact", any(not c["clutter"] for c in radar["far"]), radar["far"])
        check("ground clutter hides low target", any(c["clutter"] for c in radar["low"]), radar["low"])

        # ---- player death, spectating, team result --------------------------
        page.evaluate("() => window.__thunder.killFighter('blue-1','red-1')")
        page.wait_for_function(
            "() => window.__thunder.snapshot().state === 'spectating'", timeout=5000
        )
        snap = page.evaluate("() => window.__thunder.snapshot()")
        check("player death enters spectator", snap["state"] == "spectating")
        check("spectator follows an ally", snap["hudSubject"] not in (None, "blue-1"), snap["hudSubject"])
        page.evaluate("() => window.__thunder.killTeam('red')")
        page.wait_for_function(
            "() => window.__thunder.snapshot().state === 'result'", timeout=5000
        )
        check("team victory shows result", "active" in (page.locator("#result").get_attribute("class") or ""))
        check("victory result title", "胜利" in page.locator("#resultTitle").inner_text())

        # ---- 12v12 spawn size ----------------------------------------------
        page.locator("#resultAgainBtn").click()
        page.wait_for_timeout(300)
        page.evaluate("() => window.__thunder.startBattle('f4e', 12)")
        page.evaluate("() => window.__thunder.skipCountdown()")
        wait_battle(page)
        page.wait_for_timeout(250)
        snap = page.evaluate("() => window.__thunder.snapshot()")
        check("12v12 teams spawn", snap["alive"] == {"blue": 12, "red": 12}, snap["alive"])
        check("12v12 has 24 aircraft", len(snap["fighters"]) == 24, len(snap["fighters"]))

        # ---- engine altitude and overheat logic ----------------------------
        engine = page.evaluate(
            """() => {
              const p = window.__tsGame.player;
              const y = p.pos.y;
              p.throttle = 100; p.spool = 1;
              p.pos.y = 500; p.updateEngine(1 / 60); const low = p.enginePower;
              p.pos.y = 10000; p.updateEngine(1 / 60); const high = p.enginePower;
              p.pos.y = y;
              p.throttle = 110;
              p.boostSeconds = p.cfg.engine.maxBoostTime + .2;
              p.heat = 130;
              const before = p.modules.engine;
              for (let i = 0; i < 180; i++) p.updateEngine(1 / 60);
              return { low, high, before, after: p.modules.engine, temp: p.heat, over: p.boostExceeded };
            }"""
        )
        check("engine power varies with altitude", engine["high"] < engine["low"], engine)
        check("engine output drops at altitude", engine["low"] > 60 and engine["high"] < engine["low"] * .8, engine)
        check("boost overheat damages engine", engine["after"] < engine["before"] and engine["over"], engine)

        # Gun-only tier also starts cleanly.
        page.evaluate("() => window.__thunder.startBattle('p51', 8)")
        page.evaluate("() => window.__thunder.skipCountdown()")
        wait_battle(page)
        page.wait_for_timeout(250)
        snap = page.evaluate("() => window.__thunder.snapshot()")
        check("prop battle starts", snap["alive"] == {"blue": 8, "red": 8}, snap["alive"])
        check("prop battle has no RWR panel", page.locator(".rwr-panel").get_attribute("class")
              and "hidden" in page.locator(".rwr-panel").get_attribute("class"))

        check("no page errors", not errors, errors[:4])
        check("no console errors", not console_errors, console_errors[:4])

        browser.close()

    failed = [x for x in CHECKS if not x[1]]
    print("\n%d checks, %d failed" % (len(CHECKS), len(failed)))
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
