/** Help panel: quick Python reference for the simulated CTE API (see docs/specs/). */
const API: [string, [string, string][]][] = [
  ["Arm — actions", [
    ["arm.move_to(x, y, z, wait=True)", "Move the TCP to x, y, z (mm)"],
    ["arm.move_inc(x, y, z, wait=True)", "Move relative to the current position (mm)"],
    ["arm.move_end_effector_to(yaw, roll, pitch, wait=True)", "Absolute tool orientation (°)"],
    ["arm.move_end_effector_inc(yaw, roll, pitch, wait=True)", "Relative tool orientation (°)"],
  ]],
  ["Arm — settings", [
    ["arm.set_speed(percent)", "1–100, default 50"],
    ["arm.set_end_effector_type(Arm.MAGNET | Arm.PEN)", "Changes the TCP"],
    ["arm.set_end_effector_magnet(True | False)", "Engage / release"],
    ["arm.set_pen_offset(mm)", "Top of pen tool → marker tip"],
    ["arm.set_control_stop()", "Stop now; no more moves until restart"],
    ["arm.set_timeout(t, MSEC)", "Give up on a move after t"],
  ]],
  ["Arm — sensing", [
    ["arm.get_x() / get_y() / get_z()", "TCP position (mm)"],
    ["arm.get_yaw() / get_roll() / get_pitch()", "Tool orientation (°)"],
    ["arm.is_done()", "False while moving"],
    ["arm.can_arm_reach_to(x, y, z)", "Reachability check"],
    ["arm.can_end_effector_reach_to(yaw, roll, pitch)", "Orientation check"],
    ["arm.control_stopped(callback)", "Run callback on control stop"],
  ]],
  ["Signal Tower", [
    ["tower = SignalTower(Ports.PORT1)", ""],
    ["tower.set_color(SignalTower.RED, SignalTower.ON)", "Colors: RED GREEN BLUE YELLOW WHITE ALL · ON OFF BLINK"],
    ["tower.set_colors(r, y, g, b, w)", "Set every LED at once"],
    ["tower.pressed(callback) / released(callback)", "Bumper events"],
    ["tower.pressing()", "Is the bumper held?"],
  ]],
  ["Brain & control", [
    ["print(value)", "Print Console"],
    ["wait(time, MSEC | SECONDS)", "Pause (simulated time)"],
    ["brain.timer_time(MSEC) / brain.timer_reset()", "Project timer"],
    ["timer_event(callback, ms)", "Call later"],
    ["Thread(function) / thread.stop()", "Run code in parallel"],
    ["brain.program_stop()", "End the project"],
  ]],
  ["Tile", [
    ["Location n → (x, y)", "x = ((n-1)//6 - 1)·50, y = ((n-1)%6 - 1)·50 · location 36 = (200, 200)"],
    ["Safe position", "(120, 0, 100)"],
  ]],
];

export function renderHelp(root: HTMLElement): void {
  root.innerHTML =
    API.map(([title, rows]) => `
      <section class="card tp-section"><h4>${title}</h4>
        ${rows.map(([sig, d]) => `<div class="help-row"><code>${sig}</code>${d ? `<span>${d}</span>` : ""}</div>`).join("")}
      </section>`).join("") +
    `<p class="hint panel-foot">Full reference: <a href="https://api.vex.com/cte/home/python/index.html" target="_blank" rel="noopener">api.vex.com — CTE Python</a></p>`;
}
